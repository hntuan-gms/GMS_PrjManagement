import { canonicalIssueType } from "./boardModel";
import { earliestStart } from "./dependencyCascade";
import { formatDayMonth, formatWeekdayDayMonth } from "./humanDate";
import { addDays, diffDays } from "./resourceAllocation";
import type { IssueTypeName, JiraUser, Predecessor, Task } from "./types";
import { isoWeekday } from "./workCalendar";

/*
 * Tạo nhanh bằng câu (plan 6.4): one line of Vietnamese → the fields of a new task.
 *
 *   "Dựng API đăng nhập @chi t6 3n !cao ^DEMO-2 sau DEMO-5 #backend"
 *
 * Pure and React-free so every token, and every way Vietnamese can fool it, is tested without a browser.
 * The parser works word by word (whitespace-separated); each recognised token remembers its character
 * offsets in the input so the box can tint it, and whatever is not a token is the title.
 *
 * The rule throughout is that a false positive costs more than a miss: a word the parser leaves alone is
 * still in the title where the person can see it, while a title word silently eaten as a date moves the
 * task. So:
 * - Words are compared case- and diacritic-insensitively, EXCEPT where folding makes two common words
 *   collide — "mốt"/"một", "mai"/"mãi", "thứ tư"/"thứ tự", "chủ nhật"/"chữ nhật", "thứ"/"thư". Those are
 *   matched with their diacritics.
 * - Short forms (`t6`, `3n`, `4h`, `15/11`) count only as a whole word: "T6-1" is an issue key.
 * - Units are lowercase: "3n", "4h", "2t" are tokens; "5G" (the network) and "3D" (the model) are not.
 * - Single-valued kinds (assignee, date, duration, estimate, priority, parent, type, sprint) are taken
 *   from their first occurrence; a second one is left in the title as text.
 * - `sau`/`trước` are dependencies only when an issue key or a quoted title follows; "sau khi" is prose.
 * - An unresolved reference (`@nobody`, `^OTHER-1`, a quoted title that matches nothing) is still a token,
 *   flagged `unresolved`, and its text stays in the title so nothing typed is lost.
 */

export interface QuickAddContext {
  /** "YYYY-MM-DD", the browser's local date. */
  today: string;
  users: JiraUser[];
  meAccountId: string;
  /** The project's tasks: parents, predecessors and title look-ups come from here. */
  tasks: Task[];
  /** The project's real issue type names. Empty = the stock names are returned. */
  issueTypes: string[];
  /** The site's priority names, highest first, as Jira lists them. */
  priorities: string[];
  projectKey: string;
}

export type QuickAddTokenKind =
  | "assignee"
  | "date"
  | "duration"
  | "estimate"
  | "priority"
  | "parent"
  | "predecessor"
  | "successor"
  | "label"
  | "issueType"
  | "sprint";

/** A choice the person still has to make: an account id or an issue key, with what to show for it. */
export interface QuickAddCandidate {
  id: string;
  label: string;
}

export interface QuickAddToken {
  kind: QuickAddTokenKind;
  /** The input text the token covers, exactly as typed. */
  raw: string;
  /** Character offsets into the input: input.slice(start, end) === raw. */
  start: number;
  end: number;
  /**
   * assignee: accountId · date: "YYYY-MM-DD", or "start/end" for a range · duration: days · estimate:
   * hours · priority: the site's name · parent: issue key · predecessor/successor: keys joined by "," ·
   * label: the label · issueType: the project's type name · sprint: the hint (see `sprintHint`).
   * null while ambiguous or unresolved.
   */
  value: string | number | null;
  /** What a chip says, in Vietnamese. */
  label: string;
  /** Several people / tasks match; the person picks one. */
  ambiguous?: QuickAddCandidate[];
  /** Nothing matches; the text is also kept in the title. */
  unresolved?: boolean;
}

export interface QuickAddFields {
  assigneeAccountId?: string;
  startDate?: string;
  durationDays?: number;
  estimateHours?: number;
  priority?: string;
  parentId?: string;
  /** Always FS with no lag. */
  predecessors?: Predecessor[];
  /** "trước KEY": the new task becomes a predecessor of each of these. */
  successorOf?: string[];
  labels?: string[];
  issueType?: string;
  /** "next" | "backlog" | "active" | anything else as typed ("sprint 8"); resolved against the board elsewhere. */
  sprintHint?: string;
}

export interface QuickAddResult {
  title: string;
  tokens: QuickAddToken[];
  fields: QuickAddFields;
  /** One line, e.g. "Task · Dựng API · Lê Chi · 6/11 → 8/11 (sau DEMO-5) · Cao · #backend". */
  preview: string;
}

/* ------------------------------------------------------------------ folding */

/** Lowercase, no diacritics, đ → d. Length can change (NFD), so it is applied per word, never to offsets. */
export function foldVi(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
}

/** Folded words of a name or title, punctuation dropped: "Lê  Chi (QA)" → ["le", "chi", "qa"]. */
export function foldWords(s: string): string[] {
  return foldVi(s)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

const compact = (s: string) => foldVi(s).replace(/[^a-z0-9]/g, "");

/* -------------------------------------------------------------- priorities */

export type PriorityLevel = "highest" | "high" | "medium" | "low" | "lowest";

/** What follows `!`, folded. Two-word forms are tried before one-word ones. */
const PRIORITY_WORDS: Record<string, PriorityLevel> = {
  khan: "highest",
  "khan cap": "highest",
  gap: "highest",
  "cao nhat": "highest",
  "rat cao": "highest",
  highest: "highest",
  urgent: "highest",
  critical: "highest",
  blocker: "highest",
  cao: "high",
  high: "high",
  tb: "medium",
  "trung binh": "medium",
  vua: "medium",
  "binh thuong": "medium",
  medium: "medium",
  thap: "low",
  low: "low",
  "thap nhat": "lowest",
  "rat thap": "lowest",
  lowest: "lowest",
};

/** Site priority names that mean a level, folded — Jira's stock names and the usual Vietnamese renames. */
const PRIORITY_NAMES: Record<PriorityLevel, string[]> = {
  highest: ["highest", "khan cap", "khan", "cao nhat", "rat cao", "critical", "blocker", "urgent", "cuc cao"],
  high: ["high", "cao", "major"],
  medium: ["medium", "trung binh", "normal", "binh thuong", "vua"],
  low: ["low", "thap", "minor"],
  lowest: ["lowest", "thap nhat", "rat thap", "trivial", "cuc thap"],
};

const LEVEL_LABEL: Record<PriorityLevel, string> = {
  highest: "Khẩn",
  high: "Cao",
  medium: "Trung bình",
  low: "Thấp",
  lowest: "Rất thấp",
};

/**
 * A level → one of the site's own priority names. By name first (sites rename priorities, and a
 * Vietnamese "Cao" is still high); failing that by position in Jira's list, which is ordered highest
 * first — highest/lowest are the ends, medium the middle, high/low a quarter in. null when the site has
 * no priorities at all.
 */
export function resolvePriorityName(level: PriorityLevel, priorities: string[]): string | null {
  for (const alias of PRIORITY_NAMES[level]) {
    const hit = priorities.find((p) => foldWords(p).join(" ") === alias);
    if (hit) return hit;
  }
  const n = priorities.length;
  if (n === 0) return null;
  const quarter = Math.floor((n - 1) / 4);
  const index: Record<PriorityLevel, number> = {
    highest: 0,
    high: quarter,
    medium: Math.floor((n - 1) / 2),
    low: n - 1 - quarter,
    lowest: n - 1,
  };
  return priorities[index[level]];
}

/* -------------------------------------------------------------- issue types */

/** What follows `/`, compacted → the stock type it means. */
const TYPE_ALIASES: Record<string, IssueTypeName> = {
  bug: "Bug",
  loi: "Bug",
  story: "Story",
  us: "Story",
  task: "Task",
  viec: "Task",
  congviec: "Task",
  nhiemvu: "Task",
  epic: "Epic",
  sub: "Sub-task",
  subtask: "Sub-task",
  con: "Sub-task",
  viecon: "Sub-task",
};

/**
 * `/bug` → the project's own type name ("Lỗi" on a localised project). An exact name wins, then the
 * stock meaning through `canonicalIssueType` (preferring a type actually named like it, since every
 * unknown name falls into canonicalIssueType's "Task" bucket), then a unique prefix ("/sto"). With no
 * project types known, the stock name itself.
 */
export function resolveIssueTypeName(typed: string, issueTypes: string[]): string | null {
  const key = compact(typed);
  if (!key) return null;
  const exact = issueTypes.find((t) => compact(t) === key);
  if (exact) return exact;
  const canonical = TYPE_ALIASES[key];
  if (canonical) {
    if (issueTypes.length === 0) return canonical;
    const same = issueTypes.filter((t) => canonicalIssueType(t) === canonical);
    return same.find((t) => TYPE_ALIASES[compact(t)] === canonical) ?? same[0] ?? null;
  }
  if (key.length >= 2) {
    const prefixed = issueTypes.filter((t) => compact(t).startsWith(key));
    if (prefixed.length === 1) return prefixed[0];
  }
  return null;
}

/* ------------------------------------------------------------------- dates */

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Day-first d/m[/y] → "YYYY-MM-DD", or null if no such date. Without a year it is this year, unless that
 * lands more than 60 days in the past — then next year ("5/1" typed in November means January). A date a
 * little in the past is kept as typed: back-dating last week's work is a real thing to do.
 */
export function makeDate(d: number, m: number, y: number | null, today: string): string | null {
  if (m < 1 || m > 12 || d < 1) return null;
  let year = y === null ? Number(today.slice(0, 4)) : y < 100 ? 2000 + y : y;
  if (y === null && d <= daysInMonth(year, m) && diffDays(`${year}-${pad2(m)}-${pad2(d)}`, today) > 60) year += 1;
  if (d > daysInMonth(year, m)) return null;
  return `${year}-${pad2(m)}-${pad2(d)}`;
}

/**
 * A weekday's date. Alone it is the nearest one from today on, today included ("t6" said on a Friday is
 * today: the plan's own example is typed on a Friday and means that day). With `nextWeek` it is that
 * weekday in next calendar week (Monday-based), so "t6 tuần sau" is the same date whether said on Monday
 * or on Friday.
 */
export function weekdayDate(wd: number, today: string, nextWeek: boolean): string {
  const now = isoWeekday(today);
  if (!nextWeek) return addDays(today, (wd - now + 7) % 7);
  return addDays(today, 7 - now + wd);
}

/* ------------------------------------------------------------------ parser */

interface Word {
  /** As typed. */
  raw: string;
  start: number;
  end: number;
  /** `raw` without trailing ",;." — "mai," is still "mai". */
  core: string;
  /** `core` folded. */
  f: string;
  /** `core` lowercased with its diacritics, for the words folding would confuse. */
  lower: string;
}

interface Match {
  kind: QuickAddTokenKind;
  count: number;
  value: string | number | null;
  label: string;
  ambiguous?: QuickAddCandidate[];
  unresolved?: boolean;
  /** Writes the token into the fields; absent when ambiguous or unresolved. */
  apply?: (f: QuickAddFields) => void;
  /** Single-valued kinds this token fills besides its own (a date range also fixes the duration). */
  alsoClaims?: QuickAddTokenKind[];
}

const KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;
const SINGLE: ReadonlySet<QuickAddTokenKind> = new Set([
  "assignee",
  "date",
  "duration",
  "estimate",
  "priority",
  "parent",
  "issueType",
  "sprint",
]);
const ME_WORDS = new Set(["toi", "me"]);
const NUM = /^\d+(?:[.,]\d+)?$/;
const toNum = (s: string) => Number(s.replace(",", "."));

/** A word that opens another token: it ends a multi-word name or title. */
const startsToken = (w: Word) => /^[@#!^/*"“]/.test(w.core);
/** …or, for a person's name, any word with a digit ("@chi t6"); a task title may contain "2" ("^giai đoạn 2"). */
const looksSpecial = (w: Word) => startsToken(w) || /\d/.test(w.core);

function splitWords(input: string): Word[] {
  const out: Word[] = [];
  for (const m of input.matchAll(/\S+/g)) {
    const raw = m[0];
    const start = m.index ?? 0;
    const core = raw.replace(/[,;.]+$/, "") || raw;
    out.push({ raw, start, end: start + raw.length, core, f: foldVi(core), lower: core.normalize("NFC").toLowerCase() });
  }
  return out;
}

export function parseQuickAdd(input: string, ctx: QuickAddContext): QuickAddResult {
  const words = splitWords(input);
  const today = ctx.today;
  const byId = new Map(ctx.tasks.map((t) => [t.id.toUpperCase(), t]));
  const projectPrefix = `${ctx.projectKey.toUpperCase()}-`;
  const userWords = new Map(ctx.users.map((u) => [u.accountId, foldWords(u.displayName)]));
  const taskWords = new Map(ctx.tasks.map((t) => [t.id, foldWords(t.summary)]));

  const at = (i: number): Word | undefined => words[i];
  const isKnownKey = (key: string) => byId.has(key) || key.startsWith(projectPrefix);

  /** `"words in quotes"` starting at word i (after `skip` prefix characters), or null without a closing quote. */
  const readQuoted = (i: number, skip: number): { count: number; text: string } | null => {
    const first = words[i].core.slice(skip);
    if (!/^["“]/.test(first)) return null;
    const parts: string[] = [];
    for (let j = i; j < words.length; j++) {
      let piece = j === i ? first.slice(1) : words[j].core;
      const closes = /["”]$/.test(piece);
      if (closes) piece = piece.slice(0, -1);
      parts.push(piece);
      if (closes) {
        const text = parts.join(" ").trim();
        return text ? { count: j - i + 1, text } : null;
      }
    }
    return null;
  };

  /**
   * Greedy name/title matching shared by `@người` and `^việc cha`: the first word may be a prefix of a
   * word in the name; each following word is taken while at least one remaining candidate has it as a
   * whole word ("@lê chi"), which keeps "@anh làm" from swallowing "làm" as the start of "Lâm".
   */
  const greedy = <T>(
    i: number,
    firstWords: string[],
    pool: T[],
    wordsOf: (x: T) => string[],
    stop: (w: Word) => boolean
  ): { count: number; typed: string[]; hits: T[] } => {
    let typed = firstWords;
    let hits = pool.filter((x) => typed.every((w) => wordsOf(x).some((n) => n.startsWith(w))));
    let count = 1;
    while (hits.length > 0) {
      const next = at(i + count);
      if (!next || stop(next)) break;
      const nw = foldWords(next.core);
      if (nw.length !== 1 || typed.includes(nw[0])) break;
      const narrowed = hits.filter((x) => wordsOf(x).includes(nw[0]));
      if (narrowed.length === 0) break;
      typed = [...typed, nw[0]];
      hits = narrowed;
      count++;
    }
    const exact = hits.filter((x) => wordsOf(x).join(" ") === typed.join(" "));
    return { count, typed, hits: exact.length === 1 ? exact : hits };
  };

  const taskCandidate = (t: Task): QuickAddCandidate => ({ id: t.id, label: `${t.id} ${t.summary}` });

  /** A title phrase → one task; with several, an exact title wins, then (for a parent) the only Epic. */
  const pickTask = (hits: Task[], phrase: string[], preferEpic: boolean): { task?: Task; ambiguous?: Task[] } => {
    if (hits.length === 0) return {};
    if (hits.length === 1) return { task: hits[0] };
    const exact = hits.filter((t) => taskWords.get(t.id)?.join(" ") === phrase.join(" "));
    if (exact.length === 1) return { task: exact[0] };
    if (preferEpic) {
      const epics = hits.filter((t) => t.issueType === "Epic");
      if (epics.length === 1) return { task: epics[0] };
    }
    const sorted = [...hits].sort((a, b) => Number(b.issueType === "Epic") - Number(a.issueType === "Epic"));
    return { ambiguous: sorted.slice(0, 8) };
  };

  const phraseTasks = (phrase: string, pool: Task[]): Task[] => {
    const typed = foldWords(phrase);
    if (typed.length === 0) return [];
    return pool.filter((t) => typed.every((w) => (taskWords.get(t.id) ?? []).includes(w)));
  };

  /* ---- @người */
  const matchPerson = (i: number): Match | null => {
    const first = foldWords(words[i].core.slice(1));
    if (first.length === 0) return null;
    const typedRaw = words[i].core.slice(1);
    if (first.length === 1 && ME_WORDS.has(first[0])) {
      if (!ctx.meAccountId) return { kind: "assignee", count: 1, value: null, label: "Chưa biết bạn là ai", unresolved: true };
      const me = ctx.users.find((u) => u.accountId === ctx.meAccountId);
      const id = ctx.meAccountId;
      return { kind: "assignee", count: 1, value: id, label: me?.displayName ?? "Tôi", apply: (f) => (f.assigneeAccountId = id) };
    }
    const { count, hits } = greedy(i, first, ctx.users, (u) => userWords.get(u.accountId) ?? [], looksSpecial);
    const shown = words
      .slice(i, i + count)
      .map((w) => w.core)
      .join(" ")
      .slice(1);
    if (hits.length === 1) {
      const u = hits[0];
      return { kind: "assignee", count, value: u.accountId, label: u.displayName, apply: (f) => (f.assigneeAccountId = u.accountId) };
    }
    if (hits.length > 1) {
      return {
        kind: "assignee",
        count,
        value: null,
        label: `${shown}? (${hits.length} người)`,
        ambiguous: hits.map((u) => ({ id: u.accountId, label: u.displayName })),
      };
    }
    return { kind: "assignee", count: 1, value: null, label: `Không có ai tên “${typedRaw}”`, unresolved: true };
  };

  /* ---- dates */
  type DateHit = { count: number; start: string; end?: string };

  const weekdayAt = (i: number): { wd: number; count: number } | null => {
    const w = at(i);
    if (!w) return null;
    const short = /^t([2-7])$/.exec(w.f);
    if (short) return { wd: Number(short[1]) - 1, count: 1 };
    if (w.f === "cn") return { wd: 7, count: 1 };
    const next = at(i + 1);
    if (!next) return null;
    // "thu 6" without diacritics is fine with a digit; with a spelled-out day only "thứ" counts
    // ("thư sau" is "a letter after", "thứ tự" is "order").
    if ((w.lower === "thứ" || w.lower === "thu") && /^[2-7]$/.test(next.f)) return { wd: Number(next.f) - 1, count: 2 };
    if (w.lower === "thứ") {
      const named: Record<string, number> = { hai: 1, ba: 2, tư: 3, năm: 4, sáu: 5, bảy: 6, bẩy: 6 };
      const wd = named[next.lower];
      if (wd) return { wd, count: 2 };
    }
    if (w.lower === "chủ" && next.lower === "nhật") return { wd: 7, count: 2 };
    return null;
  };

  /** "tuần sau" / "tuần tới" at word i. */
  const nextWeekAt = (i: number): boolean => {
    const w = at(i);
    const n = at(i + 1);
    return !!w && !!n && w.f === "tuan" && (n.lower === "sau" || n.lower === "tới" || n.lower === "toi");
  };

  const DM = String.raw`(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?`;
  const SINGLE_DATE = new RegExp(`^${DM}$`);
  const RANGE_DATE = new RegExp(String.raw`^(\d{1,2})(?:\/(\d{1,2})(?:\/(\d{4}|\d{2}))?)?[-–—]${DM}$`);
  const yearOf = (s: string | undefined) => (s ? Number(s) : null);

  /** A whole-word "15/11" or "15/11/2026", before the year is guessed. */
  const dayMonthAt = (i: number): { d: number; m: number; y: number | null } | null => {
    const single = SINGLE_DATE.exec(at(i)?.core ?? "");
    return single ? { d: Number(single[1]), m: Number(single[2]), y: yearOf(single[3]) } : null;
  };

  const numericAt = (i: number): DateHit | null => {
    const w = at(i);
    if (!w) return null;
    const single = dayMonthAt(i);
    if (single) {
      const start = makeDate(single.d, single.m, single.y, today);
      return start ? { count: 1, start } : null;
    }
    const range = RANGE_DATE.exec(w.core);
    if (!range) return null;
    const m2 = Number(range[5]);
    const y2 = yearOf(range[6]);
    const m1 = range[2] ? Number(range[2]) : m2;
    const y1 = range[2] ? yearOf(range[3]) : y2;
    return rangeOf(1, Number(range[1]), m1, y1, Number(range[4]), m2, y2);
  };

  const rangeOf = (count: number, d1: number, m1: number, y1: number | null, d2: number, m2: number, y2: number | null): DateHit | null => {
    const start = makeDate(d1, m1, y1, today);
    let end = makeDate(d2, m2, y2, today);
    if (!start || !end) return null;
    // "28/12–3/1": the end's own year guess may land before the start; it is the following year.
    if (end < start && y2 === null) end = makeDate(d2, m2, Number(end.slice(0, 4)) + 1, today);
    if (!end || end < start) return null;
    return { count, start, end };
  };

  const dateExprAt = (i: number): DateHit | null => {
    const w = at(i);
    if (!w) return null;
    const next = at(i + 1);
    if (w.f === "hom" && next?.f === "nay") return { count: 2, start: today };
    if (w.lower === "mai") return { count: 1, start: addDays(today, 1) };
    if (w.lower === "mốt") return { count: 1, start: addDays(today, 2) };
    if (w.f === "ngay" && next) {
      if (next.lower === "mai") return { count: 2, start: addDays(today, 1) };
      if (next.f === "kia" || next.lower === "mốt") return { count: 2, start: addDays(today, 2) };
      const n = numericAt(i + 1);
      if (n) return { ...n, count: n.count + 1 };
    }
    const wd = weekdayAt(i);
    if (wd) {
      const nextWeek = nextWeekAt(i + wd.count);
      return { count: wd.count + (nextWeek ? 2 : 0), start: weekdayDate(wd.wd, today, nextWeek) };
    }
    if (nextWeekAt(i)) return { count: 2, start: weekdayDate(1, today, true) };
    // "15/11 – 20/11", "15/11 đến 20/11": a range spread over three words.
    const a = dayMonthAt(i);
    const b = dayMonthAt(i + 2);
    const sep = at(i + 1);
    if (a && b && sep && ["-", "–", "—", "->", "→", "~", "đến", "den", "tới"].includes(sep.lower)) {
      const r = rangeOf(3, a.d, a.m, a.y, b.d, b.m, b.y);
      if (r) return r;
    }
    return numericAt(i);
  };

  const matchDate = (i: number): Match | null => {
    let hit: DateHit | null;
    if (words[i].lower === "từ") {
      const inner = dateExprAt(i + 1);
      hit = inner ? { ...inner, count: inner.count + 1 } : null;
    } else hit = dateExprAt(i);
    if (!hit) return null;
    const { start, end, count } = hit;
    if (end) {
      const days = diffDays(start, end) + 1;
      return {
        kind: "date",
        count,
        value: `${start}/${end}`,
        label: `${formatDayMonth(start, today)} → ${formatDayMonth(end, today)}`,
        apply: (f) => {
          f.startDate = start;
          f.durationDays = days;
        },
        alsoClaims: ["duration"],
      };
    }
    return { kind: "date", count, value: start, label: formatWeekdayDayMonth(start, today), apply: (f) => (f.startDate = start) };
  };

  /* ---- 3n, 2 tuần */
  const matchDuration = (i: number): Match | null => {
    const w = words[i];
    let amount: number | null = null;
    let perUnit = 1;
    let count = 1;
    const short = /^(\d+(?:[.,]\d+)?)([ndtw])$/.exec(w.core);
    if (short) {
      amount = toNum(short[1]);
      perUnit = short[2] === "t" || short[2] === "w" ? 7 : 1;
    } else if (NUM.test(w.core) && at(i + 1)) {
      const unit = at(i + 1)!.f;
      if (unit === "ngay" || unit === "tuan") {
        amount = toNum(w.core);
        perUnit = unit === "tuan" ? 7 : 1;
        count = 2;
      }
    }
    if (amount === null) return null;
    // Duration is whole calendar days (due = start + duration − 1 has no meaning for 1.5): the server ceils too.
    const days = Math.ceil(amount * perUnit);
    if (days < 1) return null;
    const label = perUnit === 7 ? `${amount} tuần (${days} ngày)` : `${days} ngày`;
    return { kind: "duration", count, value: days, label, apply: (f) => (f.durationDays = days) };
  };

  /* ---- 4h, 1h30, 30p, 2 giờ */
  const matchEstimate = (i: number): Match | null => {
    const w = words[i];
    let hours: number | null = null;
    let count = 1;
    const plain = /^(\d+(?:[.,]\d+)?)[hg]$/.exec(w.core);
    const hm = /^(\d+)[hg](\d{1,2})(?:p|ph|m)?$/.exec(w.core);
    const min = /^(\d+)(?:p|ph)$/.exec(w.core);
    if (plain) hours = toNum(plain[1]);
    else if (hm && Number(hm[2]) < 60) hours = Number(hm[1]) + Number(hm[2]) / 60;
    else if (min) hours = Number(min[1]) / 60;
    else if (NUM.test(w.core) && at(i + 1) && ["giờ", "gio", "tiếng", "tieng"].includes(at(i + 1)!.lower)) {
      hours = toNum(w.core);
      count = 2;
    }
    if (hours === null || !(hours > 0)) return null;
    const value = Math.round(hours * 100) / 100;
    return { kind: "estimate", count, value, label: formatHours(value), apply: (f) => (f.estimateHours = value) };
  };

  /* ---- !cao */
  const matchPriority = (i: number): Match | null => {
    const w = words[i];
    let level: PriorityLevel | undefined;
    let count = 1;
    if (/^!{2,}$/.test(w.core)) level = "highest";
    else {
      const body = foldWords(w.core.slice(1)).join(" ");
      if (!body) return null;
      const next = at(i + 1);
      if (next && !looksSpecial(next)) {
        const two = PRIORITY_WORDS[`${body} ${foldWords(next.core).join(" ")}`];
        if (two) {
          level = two;
          count = 2;
        }
      }
      level ??= PRIORITY_WORDS[body];
    }
    if (!level) return null;
    const name = resolvePriorityName(level, ctx.priorities);
    if (!name) return { kind: "priority", count, value: null, label: "Trang Jira này không có mức ưu tiên", unresolved: true };
    // A stock English name reads better as its Vietnamese word; a site's own (renamed) name is shown as is.
    const stock = Object.values(PRIORITY_NAMES).some((names) => names.includes(foldWords(name).join(" ")));
    const label = stock && /^[a-z ]+$/i.test(name) ? LEVEL_LABEL[level] : name;
    return { kind: "priority", count, value: name, label, apply: (f) => (f.priority = name) };
  };

  /* ---- ^cha */
  const parentPool = ctx.tasks.filter((t) => canonicalIssueType(t.issueType) !== "Sub-task");
  const parentMatch = (count: number, picked: { task?: Task; ambiguous?: Task[] }, shown: string): Match => {
    if (picked.task) {
      const t = picked.task;
      return { kind: "parent", count, value: t.id, label: `${t.id} · ${t.summary}`, apply: (f) => (f.parentId = t.id) };
    }
    if (picked.ambiguous) {
      return {
        kind: "parent",
        count,
        value: null,
        label: `${shown}? (${picked.ambiguous.length} việc)`,
        ambiguous: picked.ambiguous.map(taskCandidate),
      };
    }
    return { kind: "parent", count, value: null, label: `Không tìm thấy “${shown}”`, unresolved: true };
  };

  const matchParent = (i: number): Match | null => {
    const body = words[i].core.slice(1);
    if (!body) return null;
    const quoted = readQuoted(i, 1);
    if (quoted) return parentMatch(quoted.count, pickTask(phraseTasks(quoted.text, parentPool), foldWords(quoted.text), true), quoted.text);
    if (KEY.test(body)) {
      const key = body.toUpperCase();
      const t = byId.get(key);
      if (t) return parentMatch(1, { task: t }, key);
      if (key.startsWith(projectPrefix)) return { kind: "parent", count: 1, value: key, label: key, apply: (f) => (f.parentId = key) };
      return parentMatch(1, {}, key);
    }
    const first = foldWords(body);
    if (first.length === 0) return null;
    const { count, typed, hits } = greedy(i, first, parentPool, (t) => taskWords.get(t.id) ?? [], startsToken);
    const shown = words
      .slice(i, i + count)
      .map((w) => w.core)
      .join(" ")
      .slice(1);
    return parentMatch(hits.length ? count : 1, pickTask(hits, typed, true), shown);
  };

  /* ---- sau KEY / trước KEY */
  const matchDependency = (i: number): Match | null => {
    const w = words[i];
    const kind: QuickAddTokenKind | null = w.lower === "sau" ? "predecessor" : w.lower === "trước" || w.lower === "truoc" ? "successor" : null;
    if (!kind || !at(i + 1)) return null;
    const verb = kind === "predecessor" ? "sau" : "trước";
    const build = (count: number, ids: string[]): Match => ({
      kind,
      count,
      value: ids.join(","),
      label: `${verb} ${ids.join(", ")}`,
      apply: (f) => {
        if (kind === "predecessor") {
          const list = (f.predecessors ??= []);
          for (const id of ids) if (!list.some((p) => p.taskId === id)) list.push({ taskId: id, type: "FS", lagDays: 0 });
        } else {
          const list = (f.successorOf ??= []);
          for (const id of ids) if (!list.includes(id)) list.push(id);
        }
      },
    });

    const quoted = readQuoted(i + 1, 0);
    if (quoted) {
      const picked = pickTask(phraseTasks(quoted.text, ctx.tasks), foldWords(quoted.text), false);
      const count = quoted.count + 1;
      if (picked.task) return build(count, [picked.task.id]);
      if (picked.ambiguous) {
        return {
          kind,
          count,
          value: null,
          label: `${verb} “${quoted.text}”? (${picked.ambiguous.length} việc)`,
          ambiguous: picked.ambiguous.map(taskCandidate),
        };
      }
      return { kind, count, value: null, label: `Không tìm thấy “${quoted.text}”`, unresolved: true };
    }

    // One or more keys: "sau DEMO-5", "sau DEMO-5, DEMO-6", "sau DEMO-5 và DEMO-6".
    const ids: string[] = [];
    let j = i + 1;
    while (j < words.length) {
      const parts = words[j].core.split(",").filter(Boolean);
      if (parts.length > 0 && parts.every((p) => KEY.test(p))) {
        ids.push(...parts.map((p) => p.toUpperCase()));
        j++;
        continue;
      }
      const joiner = ["và", "va", "&", ","].includes(words[j].lower);
      if (ids.length > 0 && joiner && KEY.test(at(j + 1)?.core ?? "")) {
        j++;
        continue;
      }
      break;
    }
    if (ids.length === 0) return null;
    const count = j - i;
    const unknown = ids.filter((id) => !isKnownKey(id));
    if (unknown.length > 0) return { kind, count, value: null, label: `${unknown.join(", ")} không thuộc dự án này`, unresolved: true };
    return build(count, [...new Set(ids)]);
  };

  /* ---- #nhãn */
  const matchLabel = (i: number): Match | null => {
    const body = words[i].core.slice(1);
    // "#12" reads as a number reference, not a label anyone means to create.
    if (!body || body.startsWith("#") || /^\d+$/.test(body)) return null;
    return {
      kind: "label",
      count: 1,
      value: body,
      label: `#${body}`,
      apply: (f) => {
        const list = (f.labels ??= []);
        if (!list.includes(body)) list.push(body);
      },
    };
  };

  /* ---- /loại — an unknown "/word" (a path, "/api") is just text. */
  const matchType = (i: number): Match | null => {
    const body = words[i].core.slice(1);
    if (!/^[\p{L}-]+$/u.test(body)) return null;
    const name = resolveIssueTypeName(body, ctx.issueTypes);
    if (!name) return null;
    return { kind: "issueType", count: 1, value: name, label: name, apply: (f) => (f.issueType = name) };
  };

  /* ---- *sprint */
  const matchSprint = (i: number): Match | null => {
    const body = words[i].core.slice(1);
    if (!body || body.endsWith("*")) return null; // *nhấn mạnh*
    const fb = foldWords(body).join(" ");
    const nextF = at(i + 1)?.f;
    let hint: string;
    let count = 1;
    if (fb === "tiep" || fb === "next" || fb === "tiep theo") {
      hint = "next";
      if (fb === "tiep" && nextF === "theo") count = 2;
    } else if (fb === "backlog") hint = "backlog";
    else if (fb === "active" || fb === "dang chay" || fb === "hien tai" || fb === "nay") hint = "active";
    else if ((fb === "hien" && nextF === "tai") || (fb === "dang" && nextF === "chay")) {
      hint = "active";
      count = 2;
    } else if (fb === "sprint" && /^\d+$/.test(at(i + 1)?.core ?? "")) {
      hint = `sprint ${at(i + 1)!.core}`;
      count = 2;
    } else if (/^(?:sprint)?\s*\d+$/.test(fb)) hint = `sprint ${fb.replace(/\D/g, "")}`;
    else hint = body;
    const label =
      hint === "next" ? "Sprint tiếp theo" : hint === "backlog" ? "Backlog" : hint === "active" ? "Sprint đang chạy" : hint.replace(/^sprint/i, "Sprint");
    return { kind: "sprint", count, value: hint, label, apply: (f) => (f.sprintHint = hint) };
  };

  const matchAt = (i: number): Match | null => {
    switch (words[i].core[0]) {
      case "@":
        return matchPerson(i);
      case "!":
        return matchPriority(i);
      case "^":
        return matchParent(i);
      case "#":
        return matchLabel(i);
      case "/":
        return matchType(i);
      case "*":
        return matchSprint(i);
      default:
        return matchDate(i) ?? matchDuration(i) ?? matchEstimate(i) ?? matchDependency(i);
    }
  };

  /* ---- the walk */
  const fields: QuickAddFields = {};
  const tokens: QuickAddToken[] = [];
  const kept: string[] = [];
  const claimed = new Set<QuickAddTokenKind>();
  for (let i = 0; i < words.length; ) {
    const m = matchAt(i);
    if (!m || (SINGLE.has(m.kind) && claimed.has(m.kind))) {
      kept.push(words[i].raw);
      i++;
      continue;
    }
    const last = words[i + m.count - 1];
    const token: QuickAddToken = {
      kind: m.kind,
      raw: input.slice(words[i].start, last.end),
      start: words[i].start,
      end: last.end,
      value: m.value,
      label: m.label,
    };
    if (m.ambiguous) token.ambiguous = m.ambiguous;
    if (m.unresolved) {
      token.unresolved = true;
      for (let k = i; k < i + m.count; k++) kept.push(words[k].raw);
    } else {
      claimed.add(m.kind);
      for (const k of m.alsoClaims ?? []) claimed.add(k);
    }
    m.apply?.(fields);
    tokens.push(token);
    i += m.count;
  }

  // "sau DEMO-5" with no date: start the day after the latest predecessor ends (FS, no lag) — the date
  // the cascade would push it to anyway.
  let afterNote = "";
  if (fields.predecessors?.length) {
    afterNote = ` (sau ${fields.predecessors.map((p) => p.taskId).join(", ")})`;
    if (!fields.startDate) {
      let best: string | null = null;
      for (const p of fields.predecessors) {
        const t = byId.get(p.taskId);
        const end = t ? taskEnd(t) : null;
        if (!t?.startDate || !end) continue;
        const s = earliestStart("FS", t.startDate, end, p.lagDays, fields.durationDays ?? 1);
        if (!best || s > best) best = s;
      }
      if (best) fields.startDate = best;
    }
  }

  const title = kept.join(" ").replace(/\s+/g, " ").trim();
  return { title, tokens, fields, preview: buildPreview(title, tokens, fields, today, afterNote) };
}

/** A task's last day: its due date, else start + duration − 1. */
function taskEnd(t: Task): string | null {
  if (t.dueDate) return t.dueDate;
  return t.startDate ? addDays(t.startDate, Math.max(1, t.durationDays) - 1) : null;
}

/** 4 → "4h", 1.5 → "1h30", 0.25 → "15p". */
export function formatHours(h: number): string {
  const whole = Math.floor(h);
  const minutes = Math.round((h - whole) * 60);
  if (minutes === 0) return `${whole}h`;
  if (whole === 0) return `${minutes}p`;
  return `${whole}h${pad2(minutes)}`;
}

function buildPreview(title: string, tokens: QuickAddToken[], fields: QuickAddFields, today: string, afterNote: string): string {
  const tokenOf = (kind: QuickAddTokenKind) => tokens.find((t) => t.kind === kind && !t.unresolved);
  const parts: string[] = [fields.issueType ?? "Task", title || "(chưa có tên)"];
  const who = tokenOf("assignee");
  if (who) parts.push(who.label);
  if (fields.startDate) {
    const end = fields.durationDays ? addDays(fields.startDate, fields.durationDays - 1) : null;
    const span = end ? `${formatDayMonth(fields.startDate, today)} → ${formatDayMonth(end, today)}` : `từ ${formatDayMonth(fields.startDate, today)}`;
    parts.push(span + afterNote);
  } else {
    if (fields.durationDays) parts.push(`${fields.durationDays} ngày`);
    if (afterNote) parts.push(afterNote.trim().slice(1, -1));
  }
  if (fields.estimateHours !== undefined) parts.push(`ước lượng ${formatHours(fields.estimateHours)}`);
  const priority = tokenOf("priority");
  if (priority) parts.push(priority.label);
  if (fields.parentId) parts.push(`trong ${fields.parentId}`);
  if (fields.successorOf?.length) parts.push(`trước ${fields.successorOf.join(", ")}`);
  const sprint = tokenOf("sprint");
  if (sprint) parts.push(sprint.label);
  if (fields.labels?.length) parts.push(fields.labels.map((l) => `#${l}`).join(" "));
  return parts.join(" · ");
}
