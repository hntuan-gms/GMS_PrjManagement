import { badRequest } from "./errors.js";
import { JiraApiError, type JiraClient } from "./jiraClient.js";

/**
 * The parts of a task Jira owns outright and this app only shows or forwards:
 * components and versions (their option lists), issue links, watchers, and "which
 * issues match this JQL". No table of ours — a copy would disagree with Jira.
 *
 * Links are Jira's own and sit NEXT TO the FS/SS/FF/SF dependencies, never inside
 * them: a Jira "blocks" link has no type or lag in our sense and does not move a
 * bar, so showing it as a dependency would promise scheduling behaviour it does
 * not have. It is information, and the edit modal says so.
 */

export interface IssueLinkView {
  id: string;
  /** Jira's link type name ("Blocks"). */
  typeName: string;
  /** Whether the viewed issue is the subject of the text ("blocks", outward) or its object ("is blocked by", inward). */
  direction: "outward" | "inward";
  /** The text to show: "blocks" / "is blocked by". */
  label: string;
  key: string;
  summary: string;
  status: string;
  statusCategory: "new" | "indeterminate" | "done";
  issueType: string;
}

export interface LinkType {
  id: string;
  name: string;
  inward: string;
  outward: string;
}

export interface WatcherView {
  isWatching: boolean;
  count: number;
  /** Empty when Jira will not list watchers to this user (it needs a permission most people lack). */
  watchers: Array<{ accountId: string; displayName: string; avatarUrl: string | null }>;
  /** True when the list above is what Jira would show, false when it only gave the count. */
  listed: boolean;
}

export const MAX_JQL_KEYS = 1000;
const MAX_JQL_CHARS = 2000;

const category = (key: unknown): "new" | "indeterminate" | "done" =>
  key === "done" ? "done" : key === "indeterminate" ? "indeterminate" : "new";

/** Jira link records → what the modal draws. Pure, and the one place direction is decided. */
export function toLinkViews(raw: any[]): IssueLinkView[] {
  const out: IssueLinkView[] = [];
  for (const l of raw ?? []) {
    if (!l) continue;
    const outward = !!l.outwardIssue;
    const other = l.outwardIssue ?? l.inwardIssue;
    if (!other?.key) continue;
    out.push({
      id: String(l.id),
      typeName: String(l.type?.name ?? ""),
      direction: outward ? "outward" : "inward",
      label: String((outward ? l.type?.outward : l.type?.inward) ?? l.type?.name ?? ""),
      key: String(other.key),
      summary: String(other.fields?.summary ?? ""),
      status: String(other.fields?.status?.name ?? ""),
      statusCategory: category(other.fields?.status?.statusCategory?.key),
      issueType: String(other.fields?.issuetype?.name ?? ""),
    });
  }
  return out;
}

/**
 * A JQL as typed → the query actually sent. A trailing ORDER BY means nothing to a
 * filter (the screen keeps its own order) and cannot sit inside the parentheses the
 * project scope needs, so it is cut — only when it really is trailing: an
 * "order by" inside a quoted string or parentheses is left alone.
 */
export function scopeJql(projectKey: string, raw: string): string {
  const core = raw.trim().replace(/\border\s+by\s+[^()"']*$/i, "").trim();
  return core ? `project = ${projectKey} AND (${core})` : `project = ${projectKey}`;
}

const KEY = /^[A-Z][A-Z0-9_]*-\d+$/;

export class TaskExtras {
  private readonly ownKey: RegExp;

  constructor(
    private readonly jira: JiraClient,
    private readonly who: { projectKey: string; accountId: string }
  ) {
    this.ownKey = new RegExp(`^${who.projectKey}-\\d+$`);
  }

  private own(key: string): string {
    if (!this.ownKey.test(key)) throw badRequest(`Chỉ thao tác được với công việc của dự án ${this.who.projectKey}.`);
    return key;
  }

  /* -------------------------------------------------- option lists */

  async components(): Promise<Array<{ id: string; name: string }>> {
    return (await this.jira.getProjectComponents(this.who.projectKey)).map((c) => ({ id: c.id, name: c.name }));
  }

  async versions(): Promise<Array<{ id: string; name: string; released: boolean; archived: boolean; releaseDate: string | null; startDate: string | null }>> {
    return (await this.jira.getProjectVersions(this.who.projectKey)).map((v) => ({
      id: v.id,
      name: v.name,
      released: !!v.released,
      archived: !!v.archived,
      releaseDate: v.releaseDate ?? null,
      startDate: v.startDate ?? null,
    }));
  }

  /* -------------------------------------------------- issue links */

  async linkTypes(): Promise<LinkType[]> {
    return this.jira.getIssueLinkTypes();
  }

  async links(key: string): Promise<IssueLinkView[]> {
    return toLinkViews(await this.jira.getIssueLinks(this.own(key)));
  }

  /**
   * `direction` is the viewed issue's side: "outward" = it is the subject of the
   * type's outward text ("this blocks OTHER"). The other issue may be in another
   * project — Jira allows that for links, unlike for our own dependencies.
   */
  async addLink(key: string, input: { typeName: string; otherKey: string; direction: "outward" | "inward" }): Promise<IssueLinkView[]> {
    this.own(key);
    const other = String(input.otherKey ?? "").trim().toUpperCase();
    if (!KEY.test(other)) throw badRequest("Mã công việc cần liên kết không hợp lệ (ví dụ ABC-12).");
    if (other === key) throw badRequest("Không liên kết một công việc với chính nó.");
    if (input.direction !== "outward" && input.direction !== "inward") throw badRequest("Chiều liên kết không hợp lệ.");
    const types = await this.jira.getIssueLinkTypes();
    const type = types.find((t) => t.name === input.typeName);
    if (!type) throw badRequest(`Không có loại liên kết "${input.typeName}".`);
    // The outward text ("blocks") is said of the OUTWARD issue.
    const [inwardKey, outwardKey] = input.direction === "outward" ? [other, key] : [key, other];
    try {
      await this.jira.createIssueLink(type.name, inwardKey, outwardKey);
    } catch (err) {
      if (err instanceof JiraApiError && (err.status === 400 || err.status === 404)) {
        throw badRequest(`Jira không tạo được liên kết: ${err.summary || "không tìm thấy công việc kia, hoặc bạn không có quyền liên kết."}`);
      }
      throw err;
    }
    return this.links(key);
  }

  /** Only a link that really belongs to this issue: the id alone is not enough to delete by. */
  async removeLink(key: string, linkId: string): Promise<IssueLinkView[]> {
    const current = await this.links(key);
    if (!current.some((l) => l.id === linkId)) throw badRequest("Liên kết này không thuộc công việc đang mở.");
    await this.jira.deleteIssueLink(linkId);
    return current.filter((l) => l.id !== linkId);
  }

  /* -------------------------------------------------- watchers */

  async watchers(key: string): Promise<WatcherView> {
    const w = await this.jira.getWatchers(this.own(key));
    const listed = Array.isArray(w.watchers);
    return {
      isWatching: !!w.isWatching,
      count: Number(w.watchCount ?? 0),
      listed,
      watchers: (w.watchers ?? []).map((u: any) => ({
        accountId: String(u.accountId),
        displayName: String(u.displayName ?? "Không rõ"),
        avatarUrl: u.avatarUrls?.["24x24"] ?? null,
      })),
    };
  }

  /** Only ever the signed-in user: adding someone else needs an admin permission this app never asks for. */
  async setWatching(key: string, watching: boolean): Promise<WatcherView> {
    this.own(key);
    if (watching) await this.jira.addWatcher(key, this.who.accountId);
    else await this.jira.removeWatcher(key, this.who.accountId);
    return this.watchers(key);
  }

  /* -------------------------------------------------- JQL */

  /**
   * Which of this project's issues match a JQL the user typed. The string goes to
   * Jira unparsed — we write no JQL parser — and runs with the USER's token, so
   * Jira applies their permissions and reports syntax errors in its own words.
   * Results are cut to this project's keys: the query is scoped, but a clever
   * closing parenthesis could widen it, and a key from elsewhere means nothing here.
   */
  async jqlKeys(raw: string): Promise<{ keys: string[]; truncated: boolean }> {
    const jql = String(raw ?? "").trim();
    if (!jql) throw badRequest("Chưa nhập JQL.");
    if (jql.length > MAX_JQL_CHARS) throw badRequest(`JQL quá dài (tối đa ${MAX_JQL_CHARS} ký tự).`);
    try {
      const { keys, truncated } = await this.jira.searchKeys(scopeJql(this.who.projectKey, jql), MAX_JQL_KEYS);
      return { keys: keys.filter((k) => this.ownKey.test(k)), truncated };
    } catch (err) {
      if (err instanceof JiraApiError && err.status === 400) {
        throw badRequest(`JQL không hợp lệ: ${err.summary || err.message}`);
      }
      throw err;
    }
  }
}
