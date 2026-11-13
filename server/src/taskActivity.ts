import { adfToRich, richToAdf, type AdfToRichOptions } from "./adf.js";
import { attachmentMatcher, mediaForWrite } from "./richMedia.js";
import { badRequest } from "./errors.js";
import type { JiraClient } from "./jiraClient.js";
import { cachedDetail, forgetDetail, type DetailStore } from "./detailCache.js";

/**
 * What the task detail adds on top of the schedule: the conversation (comments)
 * and the history (changelog). Jira owns both. Comments are also kept in Postgres
 * (detailCache.ts) so one person's read serves the next, under the same permission
 * gate as the issue copy; a comment restricted to a group or role is never kept,
 * and the history is always read from Jira.
 *
 * A comment travels as the small Markdown of richText.ts (headings, lists, code, quotes, pictures);
 * adf.ts turns it into Jira's ADF and back. Mentions travel as `@[Name](accountId)`, which
 * `richToAdf` turns into a real ADF mention node. Jira, not this app, then
 * notifies the person: it does so for any comment written through its API, so no
 * notification code exists here.
 */

export interface TaskComment {
  id: string;
  authorAccountId: string | null;
  authorName: string;
  authorAvatarUrl: string | null;
  text: string;
  created: string;
  /** Different from `created` once edited. */
  updated: string;
  /** Written by the signed-in user — the only ones Jira lets them edit or delete. */
  mine: boolean;
  /** Restricted to a group or role in Jira. Present (true) only then; such a comment is never kept in the copy. */
  restricted?: boolean;
}

/** Where comments are kept between readers; absent = every read goes to Jira. */
export interface CommentCache {
  store: DetailStore;
  cloudId: string;
  projectKey: string;
}

export interface ActivityChange {
  /** Jira's own field name ("status", "assignee", "Start date"…); the client translates it. */
  field: string;
  from: string | null;
  to: string | null;
}

export interface ActivityEntry {
  id: string;
  authorName: string;
  authorAccountId: string | null;
  created: string;
  changes: ActivityChange[];
}

const MAX_COMMENT_CHARS = 30_000;
/** A pasted description can be pages long; the history only needs to show it changed. */
const MAX_VALUE_CHARS = 240;
/** Jira pages the changelog at 100, oldest first; the cap only guards a runaway loop. */
const MAX_CHANGELOG_PAGES = 30;

const TIME_FIELDS = new Set(["timeoriginalestimate", "timeestimate", "timespent"]);

function clip(v: string | null): string | null {
  if (v === null) return null;
  return v.length > MAX_VALUE_CHARS ? `${v.slice(0, MAX_VALUE_CHARS)}…` : v;
}

function hours(seconds: string | null): string | null {
  if (seconds === null) return null;
  const n = Number(seconds);
  return Number.isFinite(n) ? `${Math.round((n / 3600) * 10) / 10}h` : seconds;
}

export class TaskActivity {
  constructor(
    private readonly jira: JiraClient,
    private readonly accountId: string,
    private readonly cache?: CommentCache
  ) {}

  private toComment(c: any, media?: AdfToRichOptions["attachmentOf"]): TaskComment {
    return {
      id: String(c.id),
      authorAccountId: c.author?.accountId ?? null,
      authorName: c.author?.displayName ?? "Không rõ",
      authorAvatarUrl: c.author?.avatarUrls?.["24x24"] ?? null,
      text: adfToRich(c.body, { attachmentOf: media }),
      created: c.created,
      updated: c.updated ?? c.created,
      mine: !!c.author?.accountId && c.author.accountId === this.accountId,
      ...(c.visibility ? { restricted: true } : {}),
    };
  }

  /** Newest first, as Jira's own issue view lists them. */
  async listComments(key: string): Promise<TaskComment[]> {
    const read = async () => {
      const raw = await this.jira.getComments(key);
      // Pictures are matched to the issue's attachments once for the whole list.
      const media = await attachmentMatcher(this.jira, key, raw.map((c) => c.body));
      return raw.map((c) => this.toComment(c, media));
    };
    const cache = this.cache;
    if (!cache) return read();
    return cachedDetail<TaskComment[]>(
      cache.store,
      { cloudId: cache.cloudId, projectKey: cache.projectKey, accountId: this.accountId, key },
      "comments",
      read,
      {
        // `mine` is about the reader, so it is not stored; a restricted comment is not stored at all.
        split: (list) => ({
          data: list.filter((c) => !c.restricted).map((c) => ({ ...c, mine: false })),
          restricted: list.some((c) => c.restricted),
        }),
        join: (data) => (data as TaskComment[]).map((c) => ({ ...c, mine: !!c.authorAccountId && c.authorAccountId === this.accountId })),
      }
    );
  }

  /** This app wrote to the issue's comments: what is held about them is no longer true. */
  private async forget(key: string): Promise<void> {
    if (this.cache) await forgetDetail(this.cache.store, this.cache.cloudId, key, ["comments"]);
  }

  /** The comment as ADF, its pictures resolved to the files Jira holds. */
  private async toAdf(key: string, text: string) {
    const body = this.checked(text);
    return richToAdf(body, { media: await mediaForWrite(this.jira, key, body) });
  }

  /** The answer as the panel shows it: the pictures this app just wrote are matched back to their files. */
  private async answer(key: string, c: any): Promise<TaskComment> {
    return this.toComment(c, await attachmentMatcher(this.jira, key, [c.body]));
  }

  async addComment(key: string, text: string): Promise<TaskComment> {
    const created = await this.answer(key, await this.jira.addComment(key, await this.toAdf(key, text)));
    await this.forget(key);
    return created;
  }

  async updateComment(key: string, commentId: string, text: string): Promise<TaskComment> {
    const updated = await this.answer(key, await this.jira.updateComment(key, commentId, await this.toAdf(key, text)));
    await this.forget(key);
    return updated;
  }

  async deleteComment(key: string, commentId: string): Promise<void> {
    await this.jira.deleteComment(key, commentId);
    await this.forget(key);
  }

  private checked(text: string): string {
    const t = text.trim();
    if (!t) throw badRequest("Bình luận không được để trống.");
    if (t.length > MAX_COMMENT_CHARS) throw badRequest("Bình luận quá dài.");
    return t;
  }

  /** Newest first. Entries that changed nothing a person would read (rank, worklog ids) are dropped. */
  async listActivity(key: string): Promise<ActivityEntry[]> {
    const raw: any[] = [];
    for (let page = 0, startAt = 0; page < MAX_CHANGELOG_PAGES; page++) {
      const res = await this.jira.getChangelog(key, startAt);
      const values = res.values ?? [];
      raw.push(...values);
      if (res.isLast !== false || values.length === 0) break;
      startAt += values.length;
    }
    return raw
      .map((h): ActivityEntry => ({
        id: String(h.id),
        authorName: h.author?.displayName ?? "Hệ thống",
        authorAccountId: h.author?.accountId ?? null,
        created: h.created,
        changes: (h.items ?? [])
          .filter((i: any) => i.field !== "Rank" && i.field !== "WorklogId" && i.field !== "RemoteIssueLink")
          .map((i: any): ActivityChange => {
            const time = TIME_FIELDS.has(String(i.field).toLowerCase());
            // `i.toString` is Jira's field name AND Object.prototype.toString, so an
            // item without it would read the function; only strings count.
            const str = (v: unknown) => (typeof v === "string" ? v : null);
            const from = str(i.fromString) ?? str(i.from);
            const to = str(i.toString) ?? str(i.to);
            return {
              field: String(i.field),
              from: clip(time ? hours(from) : from),
              to: clip(time ? hours(to) : to),
            };
          }),
      }))
      .filter((e) => e.changes.length > 0)
      .reverse();
  }
}
