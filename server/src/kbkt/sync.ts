import { adfComparable } from "../adf.js";
import { JiraApiError, type JiraClient } from "../jiraClient.js";
import {
  applyFieldMap,
  autoFieldMap,
  FIELD_SOURCES,
  resolveTargets,
  sameFieldValue,
  type FieldTarget,
  type JiraFieldMeta,
  type MappedKind,
} from "./fields.js";
import { label, type KbktWorkbook } from "./parse.js";
import type { KbktSettings, SpecKind } from "./settings.js";
import { buildSpecs, storyKeyFromFileName, type Spec } from "./specs.js";

/**
 * Brings Jira in line with one KBKT workbook — the `Sync` class of
 * jira_sync.py, run as the signed-in user instead of a personal API token.
 *
 * Same contract as the script: a dry run (`apply: false`) logs exactly what an
 * apply would do and writes nothing; issues are found by label, so applying the
 * same file twice changes nothing the second time, and re-applying after an
 * interrupted run carries on where it stopped. The Excel file is the source of
 * truth for summary, description, priority and status.
 *
 * Two departures, both deliberate:
 *   - **Scoped to the session's project.** The script followed an existing
 *     Story into whatever project it lived in; every write in this app is
 *     confined to the project the user picked, so a Story key from another
 *     project is an error that names the project to switch to.
 *   - **Batched.** Cloud Run cuts a request at 300 s and a workbook can hold a
 *     hundred-plus test cases. New sub-issues go through Jira's bulk create
 *     (50 per call), transitions are fetched once per (issue type, status)
 *     rather than once per issue, and the remaining per-issue calls run a few
 *     at a time.
 */

export type LogAction =
  | "INFO"
  | "WARN"
  | "ERROR"
  | "SKIP"
  | "CREATE"
  | "UPDATE"
  | "MOVE"
  | "NO-MOVE"
  | "LINK"
  | "ATTACH";

export interface LogLine {
  action: LogAction;
  message: string;
}

export interface SyncOptions {
  apply: boolean;
  /** Sync even when many test-case summaries changed (rows probably shifted). */
  force: boolean;
  /** Epic for a new Story: an issue key, or an Epic's exact name. */
  epicRef: string | null;
  /**
   * The Story the test cases go under: a key → that issue (it must exist);
   * null → always a new Story; undefined → the key in the file name
   * ("AI-33_…"), or a new Story when there is none or it doesn't exist — the
   * script's behaviour.
   */
  storyKey?: string | null;
  /** Due date for new issues of the kinds in settings.dueDateOn. */
  dueDate: string | null;
  signal?: AbortSignal;
}

export interface SyncResult {
  code: string;
  title: string;
  /** The Story the test cases went under ("new:…" in a dry run). */
  storyKey: string | null;
  stats: Partial<Record<LogAction, number>>;
  /** Statuses the workflow had no transition for — the project's workflow needs them. */
  noTransition: Array<{ from: string; to: string; count: number }>;
}

/** More changed test summaries than this → rows were probably inserted/deleted and ids shifted. */
const DRIFT_LIMIT = 3;
const CHUNK = 50;
const CONCURRENCY = 4;
const SEARCH_FIELDS = ["summary", "description", "labels", "status", "issuetype", "priority", "parent", "issuelinks", "attachment"];

export class SyncAborted extends Error {}

interface IssueType {
  id: string;
  name: string;
  subtask: boolean;
  hierarchyLevel?: number;
}

/** Jira hierarchy level: 1 = Epic, 0 = Story/Task/Bug, -1 = sub-task. */
function hierarchy(t: { name?: string; subtask?: boolean; hierarchyLevel?: number }): number {
  if (typeof t.hierarchyLevel === "number") return t.hierarchyLevel;
  return t.subtask ? -1 : (t.name ?? "").toLowerCase() === "epic" ? 1 : 0;
}

function short(s: string, n = 70): string {
  const one = s.replace(/\n/g, " ");
  return one.length <= n ? one : one.slice(0, n - 1) + "…";
}

function jqlString(s: string): string {
  return `"${s.replace(/["\\]/g, "")}"`;
}

function errorText(err: unknown): string {
  if (err instanceof JiraApiError) return err.summary || `Jira trả về lỗi ${err.status}`;
  return (err as Error).message;
}

/** Runs `fn` over `items`, at most `n` at a time. */
async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

export class KbktSync {
  private stats: Partial<Record<LogAction, number>> = {};
  private noTransition = new Map<string, number>();
  private types: IssueType[] | null = null;
  private epics = new Map<string, { key: string; fields: any }>();
  /** Transitions are a property of the workflow step, not the issue: cached per type + status. */
  private transitions = new Map<string, Promise<Array<{ id: string; name: string; to?: { name: string } }>>>();
  /** Per kind: section key → the custom field it is written to (kbkt/fields.ts). */
  private fieldTargets = new Map<MappedKind, Map<string, FieldTarget>>();
  private opts!: SyncOptions;

  constructor(
    private readonly jira: JiraClient,
    private readonly projectKey: string,
    private readonly settings: KbktSettings,
    private readonly emit: (line: LogLine) => void
  ) {}

  private log(action: LogAction, message: string): void {
    this.stats[action] = (this.stats[action] ?? 0) + 1;
    this.emit({ action, message });
  }

  private checkAbort(): void {
    if (this.opts.signal?.aborted) throw new SyncAborted("Đã dừng.");
  }

  /**
   * One Jira call whose failure is reported and skipped rather than ending the
   * run — the script's `call()`. Two things still end it: a 401 (the session is
   * dead and every later call would fail the same way) and a stop request.
   */
  private async call<T>(what: string, fn: () => Promise<T>): Promise<T | null> {
    this.checkAbort();
    try {
      return await fn();
    } catch (err) {
      if (err instanceof JiraApiError && err.status === 401 && !err.scopeProblem && !err.configRefused) throw err;
      if (err instanceof SyncAborted) throw err;
      this.log("ERROR", `${what}: ${errorText(err)}`);
      return null;
    }
  }

  private done(wb: KbktWorkbook, storyKey: string | null): SyncResult {
    return {
      code: wb.code,
      title: wb.title,
      storyKey,
      stats: this.stats,
      noTransition: [...this.noTransition].map(([k, count]) => {
        const [from, to] = k.split("\u0000");
        return { from, to, count };
      }),
    };
  }

  async run(wb: KbktWorkbook, fileName: string, opts: SyncOptions): Promise<SyncResult> {
    this.opts = opts;
    this.stats = {};
    this.noTransition.clear();
    const { specs, links, warns } = buildSpecs(wb, fileName, this.settings);
    for (const w of warns) this.log("WARN", w);
    const top = specs[0];
    const storyId = top.id;
    const oldEpic = label("epic-" + wb.code);
    let ref = opts.epicRef?.trim() || null;

    // The existing issue that holds this workbook's test cases, if there is one.
    const explicitStory = typeof opts.storyKey === "string";
    const storyKey =
      opts.storyKey === undefined ? storyKeyFromFileName(fileName) : (opts.storyKey?.trim().toUpperCase() || null);
    let own: { key: string; fields: any } | null = null;
    if (storyKey) {
      const project = storyKey.replace(/-\d+$/, "");
      if (project !== this.projectKey) {
        this.log(
          "ERROR",
          `${storyKey} thuộc dự án ${project}, không phải dự án đang mở (${this.projectKey}). ` +
            `Hãy chuyển sang dự án ${project} rồi nhập lại, hoặc chọn Story khác.`
        );
        return this.done(wb, null);
      }
      try {
        own = await this.jira.getIssue(storyKey, ["issuetype", "summary", "project", "parent"]);
      } catch (err) {
        if (err instanceof JiraApiError && err.status === 401) throw err;
        if (!(err instanceof JiraApiError && err.status === 404) || explicitStory) {
          this.log("ERROR", `Không đọc được ${storyKey}: ${errorText(err)}`);
          return this.done(wb, null);
        }
        // "AI-33_…" in the file name but no AI-33 in Jira: a new Story, named after it.
      }
      if (own && hierarchy(own.fields.issuetype ?? {}) !== 0) {
        this.log(
          "ERROR",
          `${own.key} là ${own.fields.issuetype?.name} — cần một Story (hoặc issue cùng cấp) để chứa các test case của file này.`
        );
        return this.done(wb, null);
      }
    }
    const ownEpic: string | null = own?.fields.parent?.key ?? null;

    const names: Record<SpecKind, string> = { story: "", test: "", bug: "" };
    try {
      names.story = await this.resolveType(this.settings.issueTypes.story, false);
      names.test = await this.resolveType(this.settings.issueTypes.test, true);
      names.bug = await this.resolveType(this.settings.issueTypes.bug, true);
    } catch (err) {
      if (err instanceof JiraApiError && err.status === 401) throw err;
      this.log("ERROR", errorText(err));
      return this.done(wb, null);
    }
    for (const s of specs) s.type = names[s.kind];

    // Parts with a field of their own on this project's screens leave the
    // description. Resolved before the search, which must also read those
    // fields to tell whether an existing issue already says the same.
    const warned = new Set<string>();
    const warnOnce = (message: string) => {
      if (warned.has(message)) return;
      warned.add(message);
      this.log("WARN", message);
    };
    this.fieldTargets.clear();
    for (const kind of ["test", "bug"] as const) {
      const targets = await this.resolveFields(kind, names[kind], warnOnce);
      this.fieldTargets.set(kind, targets);
      for (const s of specs) if (s.kind === kind && !s.onlyStatus) applyFieldMap(s, targets, warnOnce);
    }
    const fieldIds = [...new Set([...this.fieldTargets.values()].flatMap((t) => [...t.values()].map((x) => x.id)))];

    const existing = await this.findExisting(wb.code, new Set([...specs.map((s) => s.id), oldEpic]), fieldIds);
    if (!ref && !own && existing.has(storyId)) {
      // Synced before: stay under the same Epic.
      ref = existing.get(storyId)!.fields.parent?.key ?? null;
      if (ref) this.log("INFO", `Dùng Epic ${ref} từ lần đồng bộ trước.`);
    }
    if (!ref && !own) {
      this.log(
        "ERROR",
        `Không có issue ${storyKey ?? "Story"} trong Jira và chưa chọn Epic — hãy chọn Epic để tạo Story mới cho file này.`
      );
      return this.done(wb, null);
    }

    let parent: string | null = null;
    let what: string;
    if (!ref) {
      what = ownEpic ? `Epic ${ownEpic}` : "không thuộc Epic nào";
    } else {
      try {
        const epic = await this.findEpic(ref);
        parent = epic.key;
        what = `${epic.key} "${short(epic.fields.summary ?? "", 50)}"`;
      } catch (err) {
        if (err instanceof JiraApiError && err.status === 401) throw err;
        this.log("ERROR", errorText(err));
        return this.done(wb, null);
      }
    }

    if (own) {
      this.log(
        "INFO",
        `Story có sẵn ${own.key} "${short(own.fields.summary ?? "", 50)}" (${what}): test case → ${names.test}, lỗi → ${names.bug}.`
      );
      // A fact, not a to-do: the dialog never moves an existing Story into an Epic.
      if (!ref && !ownEpic) this.log("INFO", `${own.key} chưa thuộc Epic nào; Story giữ nguyên vị trí.`);
      if (existing.has(storyId)) {
        this.log(
          "WARN",
          `Story ${existing.get(storyId)!.key} do lần đồng bộ trước tạo không còn được dùng (các issue con chuyển sang ${own.key}) — hãy xoá nó trong Jira.`
        );
      }
    } else {
      this.log("INFO", `Trong ${what}: tạo ${names.story} mới, test case → ${names.test}, lỗi → ${names.bug}.`);
    }
    if (existing.has(oldEpic)) {
      this.log("WARN", `Epic ${existing.get(oldEpic)!.key} từ phiên bản cũ của công cụ không còn được dùng — xoá trong Jira nếu không cần.`);
    }

    const wrong = (own ? specs.slice(1) : specs).filter(
      (s) => existing.has(s.id) && existing.get(s.id)!.fields.issuetype?.name !== s.type
    );
    if (wrong.length > 0) {
      const w = existing.get(wrong[0].id)!;
      this.log(
        "ERROR",
        `${wrong.length} issue đã có trong Jira mang loại khác (ví dụ ${w.key} là ${w.fields.issuetype?.name}, cần là ${wrong[0].type}): ` +
          `chúng được đồng bộ trước đây với cấu hình loại issue khác, và API của Jira không đổi được loại. ` +
          `Hãy xoá (hoặc Move trong Jira) rồi nhập lại. Chưa thay đổi gì cho file này.`
      );
      return this.done(wb, null);
    }

    const drift = specs.filter(
      (s) => s.kind === "test" && existing.has(s.id) && (existing.get(s.id)!.fields.summary ?? "").trim() !== s.summary
    );
    if (drift.length > DRIFT_LIMIT && !opts.force) {
      this.log(
        "SKIP",
        `${drift.length} test case đổi tên (${drift.slice(0, 5).map((s) => s.id).join(", ")} …) — có thể đã chèn/xoá dòng làm lệch mã. ` +
          `Kiểm tra lại, rồi chạy với tuỳ chọn "Bỏ qua kiểm tra lệch dòng".`
      );
      return this.done(wb, null);
    }

    // The Story first: every other issue is its child.
    let topKey: string | null;
    if (own) {
      topKey = own.key;
      if (parent && parent !== ownEpic) {
        this.log("UPDATE", `story ${topKey}: Epic ${ownEpic ?? "(không có)"} → ${parent}`);
        if (opts.apply) await this.call(`Cập nhật ${topKey}`, () => this.jira.updateIssueFields(topKey!, { parent: { key: parent } }));
      }
    } else {
      const cur = existing.get(top.id);
      topKey = cur ? await this.update(top, cur, parent) : await this.createOne(top, parent);
    }
    if (!topKey) {
      this.log("ERROR", `Không tạo được ${top.type} cho file này — không tạo gì thêm.`);
      return this.done(wb, null);
    }

    const keys = new Map<string, string>();
    const subs = specs.slice(1);
    await pool(
      subs.filter((s) => existing.has(s.id)),
      CONCURRENCY,
      async (s) => {
        const key = await this.update(s, existing.get(s.id)!, topKey);
        if (key) keys.set(s.id, key);
      }
    );
    for (const [id, key] of await this.createMany(subs.filter((s) => !existing.has(s.id)), topKey)) keys.set(id, key);

    // Screenshots are large: two uploads at a time is plenty.
    await pool(
      subs.filter((s) => s.images?.length && keys.has(s.id)),
      2,
      (s) => this.syncImages(s, keys.get(s.id)!, existing.get(s.id))
    );

    const linkType = this.settings.linkType;
    const toLink = links.filter(([a, b]) => {
      const ka = keys.get(a);
      const kb = keys.get(b);
      if (!ka || !kb) return false;
      const links: any[] = existing.get(a)?.fields.issuelinks ?? [];
      return !links.some((l) => (l.inwardIssue ?? l.outwardIssue ?? {}).key === kb);
    });
    await pool(toLink, CONCURRENCY, async ([a, b]) => {
      const ka = keys.get(a)!;
      const kb = keys.get(b)!;
      this.log("LINK", `${ka} ↔ ${kb} (${linkType})`);
      if (opts.apply) await this.call(`Liên kết ${ka} ${kb}`, () => this.jira.createIssueLink(linkType, ka, kb));
    });

    return this.done(wb, topKey);
  }

  /* ------------------------------------------------------------- lookups */

  /**
   * Reads the create screen of a test-case / bug issue type and settles where
   * each section goes: the project's saved map, or by field name when it has
   * none. A screen that cannot be read leaves everything in the description,
   * as before — the import still works, just without the fields.
   */
  private async resolveFields(
    kind: MappedKind,
    typeName: string,
    warnOnce: (message: string) => void
  ): Promise<Map<string, FieldTarget>> {
    const type = this.types?.find((t) => t.name === typeName);
    if (!type) return new Map();
    let meta: JiraFieldMeta[];
    try {
      meta = await this.jira.getCreateMetaFields(this.projectKey, type.id);
    } catch (err) {
      if (err instanceof JiraApiError && err.status === 401 && !err.scopeProblem && !err.configRefused) throw err;
      warnOnce(`Không đọc được các trường của ${typeName} (${errorText(err)}) — mọi nội dung để trong Mô tả.`);
      return new Map();
    }
    const map = this.settings.fieldMap?.[kind] ?? autoFieldMap(kind, meta);
    const targets = resolveTargets(kind, map, meta, typeName, warnOnce);
    if (targets.size > 0) {
      const labels = new Map(FIELD_SOURCES[kind].map((s) => [s.key, s.label]));
      this.log(
        "INFO",
        `${typeName}: ` + [...targets].map(([key, t]) => `${labels.get(key)} → ${t.name}`).join("; ") + "; phần còn lại để trong Mô tả."
      );
    }
    return targets;
  }

  private fieldTarget(kind: SpecKind, id: string): FieldTarget | undefined {
    if (kind === "story") return undefined;
    return [...(this.fieldTargets.get(kind)?.values() ?? [])].find((t) => t.id === id);
  }

  private async findExisting(code: string, ids: Set<string>, extraFields: string[]): Promise<Map<string, any>> {
    const existing = new Map<string, any>();
    const jql = `project = ${jqlString(this.projectKey)} AND labels = ${jqlString(label("kbkt-" + code))}`;
    for (const issue of await this.jira.searchIssues(jql, [...SEARCH_FIELDS, ...extraFields])) {
      for (const l of (issue.fields?.labels ?? []) as string[]) {
        if (!ids.has(l)) continue;
        if (existing.has(l)) {
          this.log("WARN", `Nhãn ${l} có trên cả ${existing.get(l).key} và ${issue.key} — dùng ${existing.get(l).key}.`);
        } else {
          existing.set(l, issue);
        }
      }
    }
    return existing;
  }

  /** An Epic by key ("GPM-12") or by exact name ("AI-1"). */
  private async findEpic(ref: string): Promise<{ key: string; fields: any }> {
    const cached = this.epics.get(ref);
    if (cached) return cached;
    let hits: Array<{ key: string; fields: any }>;
    if (new RegExp(`^${this.projectKey}-\\d+$`, "i").test(ref)) {
      try {
        hits = [await this.jira.getIssue(ref.toUpperCase(), ["issuetype", "summary"])];
      } catch (err) {
        if (err instanceof JiraApiError && err.status === 404) throw new Error(`Không có issue ${ref.toUpperCase()} trong dự án ${this.projectKey}.`);
        throw err;
      }
    } else {
      const want = ref.trim().toLowerCase();
      // An exact-phrase text search (`summary ~ "\"AI-1\""`), then an exact match below.
      const phrase = ref.replace(/["\\]/g, "");
      const jql = `project = ${jqlString(this.projectKey)} AND summary ~ "\\"${phrase}\\""`;
      hits = (await this.jira.searchIssues(jql, ["issuetype", "summary"])).filter((i) => {
        const s = String(i.fields?.summary ?? "").trim().toLowerCase();
        return s === want || s.startsWith(want + " ");
      });
    }
    const epics = hits.filter((i) => hierarchy(i.fields?.issuetype ?? {}) >= 1);
    if (epics.length !== 1) {
      const found = hits.map((i) => `${i.key} (${i.fields?.issuetype?.name}) "${short(i.fields?.summary ?? "", 40)}"`).join(", ");
      throw new Error(
        `Epic "${ref}": ` +
          (epics.length > 1
            ? `có ${epics.length} Epic trùng tên: ${found}`
            : hits.length > 0
              ? `không phải Epic: ${found}`
              : `không có Epic nào với mã hoặc tên này trong dự án ${this.projectKey}`)
      );
    }
    this.epics.set(ref, epics[0]);
    return epics[0];
  }

  /** The project's exact spelling of an issue type; "Subtask" also matches "Sub-task". */
  private async resolveType(name: string, subtask: boolean): Promise<string> {
    this.types ??= await this.jira.getProjectIssueTypes(this.projectKey);
    const k = (s: string) => s.toLowerCase().replace(/[\s_-]/g, "");
    const cands = this.types.filter((t) => !!t.subtask === subtask).map((t) => t.name);
    const hit = cands.find((c) => k(c) === k(name));
    if (hit) return hit;
    throw new Error(
      `Loại issue "${name}" không có trong dự án ${this.projectKey}. ` +
        `Các loại ${subtask ? "sub-task" : "thường"} hiện có: ${[...cands].sort().join(", ") || "(không có)"}. Sửa trong "Cấu hình dự án".`
    );
  }

  /* ------------------------------------------------------------- writes */

  private createFields(spec: Spec, parentKey: string | null): Record<string, unknown> {
    const fields: Record<string, unknown> = {
      project: { key: this.projectKey },
      issuetype: { name: spec.type },
      summary: spec.summary,
      description: spec.description,
      labels: [...spec.labels].sort(),
    };
    if (parentKey && !parentKey.startsWith("new:")) fields.parent = { key: parentKey };
    if (spec.priority) fields.priority = { name: spec.priority };
    for (const [id, value] of Object.entries(spec.fields ?? {})) if (value !== null && value !== undefined) fields[id] = value;
    // Only on create, so a date someone changed in Jira is kept.
    if (this.opts.dueDate && this.settings.dueDateOn.includes(spec.kind)) fields.duedate = this.opts.dueDate;
    return fields;
  }

  private tag(spec: Spec): string {
    return `${spec.kind} ${spec.id}`;
  }

  /** Logs the CREATE line; false when the spec is not to be created at all. */
  private announceCreate(spec: Spec): boolean {
    if (spec.skipIfNew) {
      if (!spec.onlyStatus) this.log("SKIP", `${this.tag(spec)}: không tạo (lỗi đã đóng / rút lại) — ${short(spec.summary)}`);
      return false;
    }
    this.log("CREATE", `${this.tag(spec)} [${spec.type}] ${short(spec.summary)}${spec.status ? ` → ${spec.status}` : ""}`);
    return true;
  }

  /**
   * Through the bulk endpoint with a single element, not jiraClient.createIssue:
   * that one wraps a plain-text description, and this description is already
   * sectioned ADF.
   */
  private async createOne(spec: Spec, parentKey: string | null): Promise<string | null> {
    if (!this.announceCreate(spec)) return null;
    if (!this.opts.apply) return "new:" + spec.id;
    const [result] = (await this.call(`Tạo ${spec.id}`, () =>
      this.jira.bulkCreateIssues([{ fields: this.createFields(spec, parentKey) }])
    )) ?? [null];
    if (!result) return null;
    if ("error" in result) {
      this.log("ERROR", `Tạo ${spec.id}: ${result.error}`);
      return null;
    }
    this.emit({ action: "INFO", message: `${this.tag(spec)} = ${result.key}` });
    if (spec.status) {
      const issue = await this.call(`Trạng thái ${result.key}`, () => this.jira.getIssue(result.key, ["status"]));
      await this.move(result.key, spec.type, issue?.fields?.status?.name ?? null, spec.status, this.tag(spec));
    }
    return result.key;
  }

  /**
   * New sub-issues, 50 per call. After creating, the starting status of each
   * issue type is read once (a workflow has one create transition, so every
   * new issue of a type starts in the same status) and each issue is moved
   * from there.
   */
  private async createMany(specs: Spec[], parentKey: string): Promise<Map<string, string>> {
    const keys = new Map<string, string>();
    const todo = specs.filter((s) => this.announceCreate(s));
    if (!this.opts.apply || parentKey.startsWith("new:")) {
      for (const s of todo) keys.set(s.id, "new:" + s.id);
      return keys;
    }

    const created: Array<{ spec: Spec; key: string }> = [];
    for (let i = 0; i < todo.length; i += CHUNK) {
      const batch = todo.slice(i, i + CHUNK);
      const results = await this.call(`Tạo ${batch.length} issue`, () =>
        this.jira.bulkCreateIssues(batch.map((s) => ({ fields: this.createFields(s, parentKey) })))
      );
      if (!results) continue;
      results.forEach((r, j) => {
        if ("key" in r) {
          keys.set(batch[j].id, r.key);
          created.push({ spec: batch[j], key: r.key });
          this.emit({ action: "INFO", message: `${this.tag(batch[j])} = ${r.key}` });
        } else {
          this.log("ERROR", `Tạo ${batch[j].id}: ${r.error}`);
        }
      });
    }

    const initial = new Map<string, Promise<string | null>>();
    const startStatus = (type: string, key: string) => {
      if (!initial.has(type)) {
        initial.set(
          type,
          this.call(`Trạng thái ${key}`, () => this.jira.getIssue(key, ["status"])).then((i) => i?.fields?.status?.name ?? null)
        );
      }
      return initial.get(type)!;
    };
    await pool(created, CONCURRENCY, async ({ spec, key }) => {
      await this.move(key, spec.type, await startStatus(spec.type, key), spec.status, this.tag(spec));
    });
    return keys;
  }

  /** Update one existing issue's fields (unless onlyStatus) and move it; returns its key. */
  private async update(spec: Spec, cur: any, parentKey: string | null): Promise<string> {
    const key: string = cur.key;
    const f = cur.fields ?? {};
    if (!spec.onlyStatus) {
      const fields: Record<string, unknown> = {};
      if (String(f.summary ?? "").trim() !== spec.summary) fields.summary = spec.summary;
      if (adfComparable(f.description) !== adfComparable(spec.description)) fields.description = spec.description;
      if (spec.priority && f.priority?.name !== spec.priority) fields.priority = { name: spec.priority };
      if (parentKey && !parentKey.startsWith("new:") && f.parent?.key !== parentKey) fields.parent = { key: parentKey };
      // Custom fields: an empty cell clears the field (null), like any other Excel-owned value.
      const fieldNames = new Map<string, string>();
      for (const [id, value] of Object.entries(spec.fields ?? {})) {
        const target = this.fieldTarget(spec.kind, id);
        if (!target || sameFieldValue(target, f[id], value)) continue;
        fields[id] = value ?? null;
        fieldNames.set(id, target.name);
      }
      const have = new Set<string>(f.labels ?? []);
      const want = new Set(spec.labels);
      const ops = [
        ...[...want].filter((l) => !have.has(l)).sort().map((l) => ({ add: l })),
        ...[...have].filter((l) => l.startsWith("result-") && !want.has(l)).sort().map((l) => ({ remove: l })),
      ];
      // A custom field is logged by its name, not "customfield_10050".
      const changed = [...Object.keys(fields).map((k) => fieldNames.get(k) ?? k).sort(), ...(ops.length ? ["labels"] : [])];
      if (changed.length > 0) {
        this.log("UPDATE", `${this.tag(spec)} ${key} [${changed.join(", ")}]`);
        if (this.opts.apply) {
          await this.call(`Cập nhật ${key}`, () =>
            this.jira.updateIssue(key, {
              ...(Object.keys(fields).length ? { fields } : {}),
              ...(ops.length ? { update: { labels: ops } } : {}),
            })
          );
        }
      }
    }
    await this.move(key, f.issuetype?.name ?? spec.type, f.status?.name ?? null, spec.status, this.tag(spec));
    return key;
  }

  /** One transition to `target`, if the workflow offers it from where the issue is now. */
  private async move(key: string, type: string, current: string | null, target: string | null, tag: string): Promise<void> {
    if (!target || !current) return;
    if (current.toLowerCase() === target.toLowerCase()) return;
    const cacheKey = `${type}\u0000${current.toLowerCase()}`;
    if (!this.transitions.has(cacheKey)) {
      this.transitions.set(cacheKey, this.call(`Bước chuyển của ${key}`, () => this.jira.getTransitions(key)).then((t) => t ?? []));
    }
    const transitions = await this.transitions.get(cacheKey)!;
    const t = transitions.find((x) => (x.to?.name ?? "").toLowerCase() === target.toLowerCase());
    if (!t) {
      const k = `${current}\u0000${target}`;
      this.noTransition.set(k, (this.noTransition.get(k) ?? 0) + 1);
      this.log("NO-MOVE", `${tag} ${key}: không có bước chuyển "${current}" → "${target}"`);
      return;
    }
    this.log("MOVE", `${tag} ${key}: ${current} → ${target}`);
    if (this.opts.apply) await this.call(`Chuyển trạng thái ${key}`, () => this.jira.transitionIssueById(key, t.id));
  }

  /** Same filename and size already attached → skip; changed → upload, then remove the older copy. */
  private async syncImages(spec: Spec, key: string, cur: any): Promise<void> {
    const have = new Map<string, Array<{ id: string; size: number }>>();
    for (const a of (cur?.fields?.attachment ?? []) as Array<{ id: string; filename: string; size: number }>) {
      if (!have.has(a.filename)) have.set(a.filename, []);
      have.get(a.filename)!.push(a);
    }
    for (const img of spec.images ?? []) {
      const old = have.get(img.filename) ?? [];
      if (old.some((a) => a.size === img.data.length)) continue;
      this.log(
        "ATTACH",
        `${this.tag(spec)} ${key}: ${img.filename} (${Math.floor(img.data.length / 1024)} KB)${old.length ? ", thay bản cũ" : ""}`
      );
      if (!this.opts.apply || key.startsWith("new:")) continue;
      const uploaded = await this.call(`Đính kèm ${img.filename}`, () =>
        this.jira.addAttachment(key, { name: img.filename, type: img.mime, data: Buffer.from(img.data) })
      );
      if (uploaded === null) continue;
      for (const a of old) await this.call(`Xoá bản cũ ${img.filename} khỏi ${key}`, () => this.jira.deleteAttachment(String(a.id)));
    }
  }
}
