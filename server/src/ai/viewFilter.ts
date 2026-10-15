import type { JiraUser, Task } from "../types.js";
import { fold, resolvePerson } from "./toolUtils.js";

/**
 * "Lọc việc quá hạn của Minh" as a sentence → the same filter the Gantt, the
 * resource heatmap and the board already have.
 *
 * The tool does not touch Jira and does not filter anything itself: it turns
 * loose words into an exact `ViewFilterSpec` — a name into an accountId, "xong"
 * into the statuses this site calls done — and sends it to the browser, which
 * applies it to the views through the same `TaskFilter`/`BoardFilter` state a
 * person would set by hand (client/src/viewFilter.ts). Resolving here rather
 * than in the browser is what lets an ambiguous name come back as a question.
 */

export interface ViewFilterSpec {
  text: string;
  /** Account ids; "none" stands for unassigned. */
  people: string[];
  /** Exact status names. */
  statuses: string[];
  types: string[];
  /** Epic keys. */
  epics: string[];
  labels: string[];
  /** Board only: priority names. */
  priorities: string[];
  onlyOverdue: boolean;
  /** Board only: cards blocked by unfinished predecessors, or flagged. */
  onlyBlocked: boolean;
}

export interface ViewFilterEvent {
  /** null clears the filters. */
  spec: ViewFilterSpec | null;
  /** Switch to this tab; null keeps the current one. */
  view: "gantt" | "board" | null;
  /** What was applied, in words — also what the chat shows. */
  summary: string;
}

export const EMPTY_SPEC: ViewFilterSpec = {
  text: "",
  people: [],
  statuses: [],
  types: [],
  epics: [],
  labels: [],
  priorities: [],
  onlyOverdue: false,
  onlyBlocked: false,
};

const strings = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" && v.trim() ? [v] : []).map((x) => String(x).trim()).filter(Boolean);

const unique = <T>(xs: T[]) => [...new Set(xs)];

/** Why a word could not be resolved, with what would have been valid — the model asks the user from this. */
export interface Unresolved {
  error: string;
  available?: string[];
  epics?: string[];
  candidates?: string[];
}

type Resolved<T> = { value: T } | Unresolved;

// Not "mình": without diacritics it is "minh", which is also one of the most common given names, and
// "lọc việc của Minh" must filter Minh, not the person asking.
const ME = new Set(["me", "toi", "tui", "ban than"]);
const NOBODY = new Set(["none", "chua gan", "khong ai", "unassigned", "nobody"]);

function resolvePeople(names: string[], team: JiraUser[], myAccountId: string): Resolved<string[]> {
  const out: string[] = [];
  for (const raw of names) {
    const q = fold(raw);
    if (ME.has(q)) out.push(myAccountId);
    else if (NOBODY.has(q)) out.push("none");
    else {
      const found = resolvePerson(team, raw);
      if ("error" in found) return found;
      out.push(found.person.accountId);
    }
  }
  return { value: unique(out) };
}

const CATEGORY: Array<{ words: string[]; match: (t: Task) => boolean }> = [
  { words: ["todo", "to do", "chua lam", "can lam", "moi"], match: (t) => t.statusCategory === "new" },
  { words: ["in progress", "in_progress", "dang lam", "doing"], match: (t) => t.statusCategory === "indeterminate" },
  { words: ["done", "xong", "hoan thanh", "da xong"], match: (t) => t.statusCategory === "done" },
  { words: ["open", "dang mo", "chua xong"], match: (t) => t.statusCategory !== "done" },
];

function resolveStatuses(names: string[], tasks: Task[]): Resolved<string[]> {
  const known = unique(tasks.map((t) => t.statusName));
  const out: string[] = [];
  for (const raw of names) {
    const q = fold(raw);
    const cat = CATEGORY.find((c) => c.words.includes(q));
    // A category word means every status this site files under it — workflows
    // name them differently, and "Xong" is not "Done" everywhere.
    const named = known.filter((s) => fold(s) === q);
    if (named.length > 0) out.push(...named);
    else if (cat) out.push(...unique(tasks.filter(cat.match).map((t) => t.statusName)));
    else {
      const partial = known.filter((s) => fold(s).includes(q));
      if (partial.length === 0) return { error: `Không có trạng thái "${raw}" nào trong dự án.`, available: known };
      out.push(...partial);
    }
  }
  return { value: unique(out) };
}

function resolveTypes(names: string[], tasks: Task[]): Resolved<string[]> {
  const known = unique(tasks.map((t) => t.issueType));
  const out: string[] = [];
  for (const raw of names) {
    const hit = known.find((k) => fold(k) === fold(raw));
    if (!hit) return { error: `Không có loại "${raw}" trong dự án.`, available: known };
    out.push(hit);
  }
  return { value: unique(out) };
}

function resolveEpics(names: string[], tasks: Task[]): Resolved<string[]> {
  const epics = tasks.filter((t) => t.issueType.toLowerCase() === "epic");
  const out: string[] = [];
  for (const raw of names) {
    const byKey = epics.find((e) => e.id.toUpperCase() === raw.toUpperCase());
    if (byKey) {
      out.push(byKey.id);
      continue;
    }
    const q = fold(raw);
    const hits = epics.filter((e) => fold(e.summary).includes(q));
    if (hits.length === 1) out.push(hits[0].id);
    else {
      return {
        error: hits.length > 1 ? `"${raw}" khớp ${hits.length} Epic; hỏi người dùng chọn một.` : `Không tìm thấy Epic "${raw}".`,
        epics: (hits.length > 1 ? hits : epics).map((e) => `${e.id} ${e.summary}`),
      };
    }
  }
  return { value: unique(out) };
}

function resolveLabels(names: string[], tasks: Task[]): string[] {
  const known = unique(tasks.flatMap((t) => t.labels));
  // Jira labels have no spaces; an unknown one is kept as typed (it matches nothing, and says so).
  return unique(names.map((n) => known.find((k) => fold(k) === fold(n)) ?? n.replace(/\s+/g, "-")));
}

/** Which Epic each task sits under — the same walk as client/src/taskFilter.ts's buildEpicIndex. */
function epicIndex(tasks: Task[]): Map<string, string | null> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out = new Map<string, string | null>();
  for (const t of tasks) {
    let cur: Task | undefined = t;
    let found: string | null = null;
    for (let i = 0; cur && i < 50; i++) {
      if (cur.issueType.toLowerCase() === "epic") {
        found = cur.id;
        break;
      }
      cur = cur.wbsParentId ? byId.get(cur.wbsParentId) : undefined;
    }
    out.set(t.id, found);
  }
  return out;
}

/**
 * How many tasks pass. A mirror of `matchesTaskFilter` in client/src/taskFilter.ts
 * for the facets a spec carries (priorities and blocked are board-only and ignored
 * here) — it exists so the assistant can say "có 7 việc" without a browser round
 * trip. Change the rule in one, change it in both.
 */
export function countMatching(tasks: Task[], spec: ViewFilterSpec, today: string): number {
  const epicOf = epicIndex(tasks);
  const q = spec.text.trim().toLowerCase();
  return tasks.filter((t) => {
    if (q && !`${t.id} ${t.summary} ${t.assigneeName ?? ""} ${t.labels.join(" ")}`.toLowerCase().includes(q)) return false;
    if (spec.people.length > 0 && !spec.people.includes(t.assigneeAccountId ?? "none")) return false;
    if (spec.statuses.length > 0 && !spec.statuses.includes(t.statusName)) return false;
    if (spec.types.length > 0 && !spec.types.includes(t.issueType)) return false;
    if (spec.epics.length > 0 && !spec.epics.includes(epicOf.get(t.id) ?? "none")) return false;
    if (spec.labels.length > 0 && !t.labels.some((l) => spec.labels.includes(l))) return false;
    if (spec.onlyOverdue && !(t.statusCategory !== "done" && !!t.dueDate && t.dueDate < today)) return false;
    return true;
  }).length;
}

function describe(spec: ViewFilterSpec, team: JiraUser[], me: string): string {
  const nameOf = (id: string) => (id === "none" ? "chưa gán" : id === me ? "bạn" : (team.find((u) => u.accountId === id)?.displayName ?? id));
  const parts: string[] = [];
  if (spec.text) parts.push(`chữ "${spec.text}"`);
  if (spec.people.length) parts.push(`người: ${spec.people.map(nameOf).join(", ")}`);
  if (spec.statuses.length) parts.push(`trạng thái: ${spec.statuses.join(", ")}`);
  if (spec.types.length) parts.push(`loại: ${spec.types.join(", ")}`);
  if (spec.epics.length) parts.push(`Epic: ${spec.epics.join(", ")}`);
  if (spec.labels.length) parts.push(`nhãn: ${spec.labels.join(", ")}`);
  if (spec.priorities.length) parts.push(`ưu tiên: ${spec.priorities.join(", ")}`);
  if (spec.onlyOverdue) parts.push("quá hạn");
  if (spec.onlyBlocked) parts.push("đang bị chặn");
  return parts.join(" · ");
}

export function resolveViewFilter(
  args: Record<string, unknown>,
  ctx: { tasks: Task[]; team: JiraUser[]; accountId: string; today: string }
): { event: ViewFilterEvent; matching: number | null } | Unresolved {
  const viewArg = fold(String(args.view ?? ""));
  const view: ViewFilterEvent["view"] = viewArg === "gantt" || viewArg === "board" ? viewArg : viewArg === "bang" ? "board" : null;

  if (args.clear === true) {
    return { event: { spec: null, view, summary: "Đã bỏ bộ lọc." }, matching: ctx.tasks.length };
  }

  const people = resolvePeople(strings(args.assignees ?? args.assignee), ctx.team, ctx.accountId);
  if ("error" in people) return people;
  const statuses = resolveStatuses(strings(args.statuses ?? args.status), ctx.tasks);
  if ("error" in statuses) return statuses;
  const types = resolveTypes(strings(args.types ?? args.issueType), ctx.tasks);
  if ("error" in types) return types;
  const epics = resolveEpics(strings(args.epics ?? args.epic), ctx.tasks);
  if ("error" in epics) return epics;

  const spec: ViewFilterSpec = {
    text: typeof args.text === "string" ? args.text.trim() : "",
    people: people.value,
    statuses: statuses.value,
    types: types.value,
    epics: epics.value,
    labels: resolveLabels(strings(args.labels), ctx.tasks),
    priorities: strings(args.priorities ?? args.priority),
    onlyOverdue: args.overdue === true,
    onlyBlocked: args.blocked === true,
  };
  const summary = describe(spec, ctx.team, ctx.accountId);
  if (!summary) return { error: "Chưa có điều kiện lọc nào. Nói rõ lọc theo người, trạng thái, loại, Epic, nhãn, quá hạn… hoặc clear=true để bỏ lọc." };
  return { event: { spec, view, summary }, matching: countMatching(ctx.tasks, spec, ctx.today) };
}
