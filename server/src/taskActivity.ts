import { adfToCommentText, commentToAdf } from "./adf.js";
import { badRequest } from "./errors.js";
import type { JiraClient } from "./jiraClient.js";

/**
 * What the task detail adds on top of the schedule: the conversation (comments)
 * and the history (changelog). Both live only in Jira — no table of ours — for
 * the same reason the timesheet has none: a second copy would disagree with the
 * one people already read in Jira.
 *
 * Mentions travel as `@[Name](accountId)` in the text this API speaks, which
 * `commentToAdf` turns into a real ADF mention node. Jira, not this app, then
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
    private readonly accountId: string
  ) {}

  private toComment(c: any): TaskComment {
    return {
      id: String(c.id),
      authorAccountId: c.author?.accountId ?? null,
      authorName: c.author?.displayName ?? "Không rõ",
      authorAvatarUrl: c.author?.avatarUrls?.["24x24"] ?? null,
      text: adfToCommentText(c.body),
      created: c.created,
      updated: c.updated ?? c.created,
      mine: !!c.author?.accountId && c.author.accountId === this.accountId,
    };
  }

  /** Newest first, as Jira's own issue view lists them. */
  async listComments(key: string): Promise<TaskComment[]> {
    return (await this.jira.getComments(key)).map((c) => this.toComment(c));
  }

  async addComment(key: string, text: string): Promise<TaskComment> {
    return this.toComment(await this.jira.addComment(key, commentToAdf(this.checked(text))));
  }

  async updateComment(key: string, commentId: string, text: string): Promise<TaskComment> {
    return this.toComment(await this.jira.updateComment(key, commentId, commentToAdf(this.checked(text))));
  }

  async deleteComment(key: string, commentId: string): Promise<void> {
    await this.jira.deleteComment(key, commentId);
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
