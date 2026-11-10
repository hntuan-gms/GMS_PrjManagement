/**
 * What IssueTypeIcon draws for a Jira issue type name: which drawing and which colour.
 *
 * Decided from the **real** Jira name, never from `IssueTypeName` / `canonicalIssueType`:
 * that mapping folds every unknown type into "Task", which drew Issue, Change Request and
 * Task as the same box. Sites rename and localise types ("Sub Bug", "Lỗi", "Rủi ro"), so names
 * are folded (case, diacritics, spaces and hyphens dropped) before matching.
 *
 * Every kind below has its own drawing (`client/test/issueTypeLook.test.ts` checks that no two
 * share one). A type not listed gets one of GENERIC: the first free one counting from a hash of
 * its name, so two unknown types never share a drawing until all of GENERIC are taken. Which
 * names are taken depends on the order they are met, so `rememberIssueTypes` is handed the
 * project's types (sorted) before anything is drawn: the same project then always gets the same
 * icons.
 *
 * Colours (tokens `--type-*` in tokens.css):
 *  - bug   red:    Bug, Sub Bug and anything named as a bug (Lỗi)
 *  - issue orange: Issue
 *  - task  blue:   Task and Sub-task
 *  - epic  purple: Epic, as in Jira
 *  - change green: Change Request
 * Everything else stays ink.
 *
 * Drawn on a 16px grid, 1.5px strokes, round caps — the same rules as Icons.tsx.
 */
export type IssueTypeTone = "bug" | "issue" | "task" | "epic" | "change" | null;

export type IssueTypeKind =
  | "epic"
  | "story"
  | "task"
  | "subtask"
  | "bug"
  | "subbug"
  | "issue"
  | "risk"
  | "nc"
  | "deliverable"
  | "changerequest"
  | "improvement"
  | "newfeature"
  | "testcase"
  | "subtestcase"
  | "spike"
  | "support"
  | "question"
  | "incident";

export const KIND_PATHS: Record<IssueTypeKind, string> = {
  // A lightning bolt: the container that carries a phase.
  epic: "M8.9 1.8 3.8 9h3.6l-.9 5.2 5.3-7.4H8.2z",
  // A bookmark.
  story: "M4.5 2.5h7v11l-3.5-2.4-3.5 2.4z",
  // A checked box.
  task: "M3 3h10v10H3z M5.6 8.1l1.7 1.7 3.2-3.4",
  // A box with a branch going down into it: work under another.
  subtask: "M3.5 2.5v5.5h4 M7.5 5.5h5v7h-5z",
  // A beetle: body, head and legs.
  bug: "M5.2 6.2a2.8 2.8 0 0 1 5.6 0v3.6a2.8 2.8 0 0 1-5.6 0z M6.3 4.1 5 2.8 M9.7 4.1 11 2.8 M5.2 7.6H2.8 M13.2 7.6h-2.4 M5.2 10H3.2 M12.8 10h-2 M8 6.6v5.6",
  // The sub-task branch leading into a smaller beetle.
  subbug: "M2.5 2v4.5h2.5 M7.5 8.2a2.25 2.25 0 0 1 4.5 0v2.6a2.25 2.25 0 0 1-4.5 0z M8.6 6.4l-.8-.8 M10.9 6.4l.8-.8 M7.5 9.5H6 M13.5 9.5H12 M9.75 8.6v4.3",
  // Code brackets, as Jira draws Issue.
  issue: "M5.5 4.5 2 8l3.5 3.5 M10.5 4.5 14 8l-3.5 3.5 M9.2 3.2 6.8 12.8",
  // A diamond with an exclamation mark.
  risk: "M8 1.8 14.2 8 8 14.2 1.8 8z M8 5.3v3.4 M8 10.9v.1",
  // A warning triangle: non-conformity.
  nc: "M8 2.2 14.3 13.3H1.7z M8 6.3v3.3 M8 11.4v.1",
  // A parcel.
  deliverable: "M2.5 5 8 2.5 13.5 5v6.2L8 13.7l-5.5-2.5z M2.5 5 8 7.5 13.5 5 M8 7.5v6.2",
  // A plus in a box.
  changerequest: "M3 3h10v10H3z M8 5.5v5 M5.5 8h5",
  // An arrow up in a box.
  improvement: "M3 3h10v10H3z M8 11V5.5 M5.6 7.9 8 5.5l2.4 2.4",
  // A plus in a circle.
  newfeature: "M8 2.5a5.5 5.5 0 1 1 0 11a5.5 5.5 0 1 1 0-11z M8 5.6v4.8 M5.6 8h4.8",
  // A clipboard with a tick.
  testcase: "M4 3.5h8v10H4z M6.2 2.5h3.6v2H6.2z M6.1 9.2l1.3 1.3 2.6-2.8",
  // A flask.
  subtestcase: "M6.3 2.5h3.4 M7 2.5v3.8L3.6 12.4a.9.9 0 0 0 .8 1.3h7.2a.9.9 0 0 0 .8-1.3L9 6.3V2.5 M5 10.2h6",
  // A magnifying glass: research before the work.
  spike: "M7 2.8a4.2 4.2 0 1 1 0 8.4a4.2 4.2 0 1 1 0-8.4z M10.1 10.1 13.5 13.5",
  // A speech bubble.
  support: "M2.5 3.5h11v7.5H7l-3 2.5v-2.5H2.5z",
  // A question mark in a circle.
  question: "M8 2.5a5.5 5.5 0 1 1 0 11a5.5 5.5 0 1 1 0-11z M6.4 6.6a1.7 1.7 0 1 1 2.4 1.5c-.5.3-.8.6-.8 1.2 M8 11.2v.1",
  // An alarm light.
  incident: "M4 12V8.5a4 4 0 0 1 8 0V12 M2.5 12.5h11 M8 2v1.2 M3 4l.9.9 M13 4l-.9.9",
};

/** Drawings for types none of the names below match. */
export const GENERIC: readonly string[] = [
  // A page of lines.
  "M3 3h10v10H3z M5.5 6.2h5 M5.5 8.4h5 M5.5 10.6h3",
  // A hexagon.
  "M8 1.8 13.4 4.9v6.2L8 14.2 2.6 11.1V4.9z",
  // A star.
  "M8 2.2l1.8 3.7 4 .6-2.9 2.8.7 4L8 11.4l-3.6 1.9.7-4-2.9-2.8 4-.6z",
  // A target.
  "M8 2.5a5.5 5.5 0 1 1 0 11a5.5 5.5 0 1 1 0-11z M8 5.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 1 1 0-5z",
  // A flag.
  "M4 14V2.5 M4 3h8l-1.8 3L12 9H4",
  // A striped box.
  "M3 3h10v10H3z M3 9.5 9.5 3 M6.5 13 13 6.5",
  // A tag.
  "M2.5 2.5h5.3l5.7 5.7-5.3 5.3-5.7-5.7z M5.3 5.3h.01",
  // A circle with a dot.
  "M8 2.5a5.5 5.5 0 1 1 0 11a5.5 5.5 0 1 1 0-11z M8 8h.01",
  // A circle cut in half.
  "M8 2.5a5.5 5.5 0 1 1 0 11a5.5 5.5 0 1 1 0-11z M8 2.5v11",
  // Two chevrons.
  "M3.5 4 7.5 8l-4 4 M8.5 4l4 4-4 4",
  // Four squares.
  "M3 3h4v4H3z M9 3h4v4H9z M3 9h4v4H3z M9 9h4v4H9z",
  // A map pin.
  "M8 14s-4.5-4.4-4.5-7.5a4.5 4.5 0 0 1 9 0C12.5 9.6 8 14 8 14z M8 5.2v2.6",
];

/** Folded names (see `fold`) of each kind, in English and Vietnamese. */
const NAMES: Record<string, IssueTypeKind> = {
  epic: "epic",
  suthi: "epic",
  story: "story",
  userstory: "story",
  cauchuyen: "story",
  task: "task",
  nhiemvu: "task",
  congviec: "task",
  subtask: "subtask",
  congviecphu: "subtask",
  bug: "bug",
  loi: "bug",
  subbug: "subbug",
  subloi: "subbug",
  issue: "issue",
  vande: "issue",
  risk: "risk",
  ruiro: "risk",
  nc: "nc",
  nonconformity: "nc",
  nonconformance: "nc",
  khongphuhop: "nc",
  deliverable: "deliverable",
  sanpham: "deliverable",
  changerequest: "changerequest",
  cr: "changerequest",
  yeucauthaydoi: "changerequest",
  improvement: "improvement",
  caitien: "improvement",
  newfeature: "newfeature",
  feature: "newfeature",
  tinhnang: "newfeature",
  tinhnangmoi: "newfeature",
  testcase: "testcase",
  test: "testcase",
  kiemthu: "testcase",
  subtestcase: "subtestcase",
  spike: "spike",
  support: "support",
  hotro: "support",
  question: "question",
  cauhoi: "question",
  incident: "incident",
  suco: "incident",
};

export interface IssueTypeLook {
  /** The kind matched, or null when the name is none of them and a generic drawing was picked. */
  kind: IssueTypeKind | null;
  path: string;
  tone: IssueTypeTone;
}

export function fold(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[\s\-_/.]+/g, "");
}

function kindOf(folded: string): IssueTypeKind | null {
  const exact = NAMES[folded];
  if (exact) return exact;
  if (folded.includes("bug") || folded.startsWith("loi")) return folded.startsWith("sub") ? "subbug" : "bug";
  return null;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const TONE: Partial<Record<IssueTypeKind, IssueTypeTone>> = {
  bug: "bug",
  subbug: "bug",
  issue: "issue",
  task: "task",
  subtask: "task",
  epic: "epic",
  changerequest: "change",
};

/**
 * `label` is the real Jira name when the caller has one (the board and backlog pass a mapped
 * `type` plus the real `label`); otherwise `type` is the real name.
 */
export function issueTypeLook(type: string, label?: string): IssueTypeLook {
  const name = fold(label ?? type);
  const kind = kindOf(name);
  const path = kind ? KIND_PATHS[kind] : GENERIC[genericSlot(name)];
  return { kind, path, tone: (kind && TONE[kind]) ?? null };
}

/** Folded unknown name → index in GENERIC, for this page's life. */
const assigned = new Map<string, number>();

function genericSlot(folded: string): number {
  const known = assigned.get(folded);
  if (known !== undefined) return known;
  const taken = new Set(assigned.values());
  const start = hash(folded) % GENERIC.length;
  let slot = start;
  // Only when every shape is taken do two types share one; then the hash decides.
  for (let i = 0; i < GENERIC.length; i++) {
    const candidate = (start + i) % GENERIC.length;
    if (!taken.has(candidate)) {
      slot = candidate;
      break;
    }
  }
  assigned.set(folded, slot);
  return slot;
}

/**
 * Hands out the generic drawings for a project's type names in sorted order, so the result does
 * not depend on which row happened to render first. Names already handed out keep theirs.
 */
export function rememberIssueTypes(names: Iterable<string>): void {
  const unknown = [...new Set([...names].map(fold))].filter((n) => !kindOf(n)).sort();
  for (const n of unknown) genericSlot(n);
}

/** Tests only. */
export function resetIssueTypeSlots(): void {
  assigned.clear();
}
