/**
 * What goes into a chat message and what comes back out of one, kept free of React so it can be
 * tested (the same split as mentions.ts and csv.ts).
 *
 * Wire format of a message: the typed text with `@Name` turned into `@[Name](accountId)` (the form
 * comments already speak, so the assistant is handed the exact account), then, when work was dragged
 * in, a trailer line `Việc đính kèm: KEY «title»; KEY «title»`. The trailer is also what the
 * transcript parses back into chips, so a reloaded conversation shows the same bundle.
 */
import { toTokens, labelFor, type Mentions } from "./mentions";
import type { JiraUser } from "./types";

export const TRAILER = "Việc đính kèm: ";
const KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;

export interface AttachedTask {
  key: string;
  summary: string;
}

/** The message text for the server: typed words, then the attached work. */
export function composeMessage(text: string, tasks: readonly AttachedTask[], mentions: Mentions): string {
  const body = toTokens(text.trim(), mentions);
  if (tasks.length === 0) return body;
  const list = tasks.map((t) => `${t.key} «${t.summary.replace(/[«»\n]/g, " ").trim()}»`).join("; ");
  return `${body}\n\n${TRAILER}${list}`;
}

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "mention"; name: string; accountId: string }
  | { kind: "key"; key: string };

export interface ParsedMessage {
  segments: Segment[];
  tasks: AttachedTask[];
}

const TOKEN_RE = /@\[([^\]]+)\]\(([^)\s]+)\)|\b([A-Z][A-Z0-9_]*-\d+)\b/g;

/** A user message back into its pieces: text, mention pills, issue keys, and the dragged-in bundle. */
export function parseUserMessage(content: string): ParsedMessage {
  let body = content;
  const tasks: AttachedTask[] = [];
  const at = content.lastIndexOf(`\n\n${TRAILER}`);
  if (at >= 0) {
    const items = content.slice(at + 2 + TRAILER.length).split("; ");
    const parsed: AttachedTask[] = [];
    for (const item of items) {
      const m = /^(\S+)(?: «(.*)»)?$/.exec(item.trim());
      if (!m || !KEY_RE.test(m[1])) {
        parsed.length = 0;
        break;
      }
      parsed.push({ key: m[1], summary: m[2] ?? "" });
    }
    if (parsed.length > 0) {
      tasks.push(...parsed);
      body = content.slice(0, at);
    }
  }
  const segments: Segment[] = [];
  let last = 0;
  for (const m of body.matchAll(TOKEN_RE)) {
    const i = m.index ?? 0;
    if (i > last) segments.push({ kind: "text", text: body.slice(last, i) });
    if (m[3]) segments.push({ kind: "key", key: m[3] });
    else segments.push({ kind: "mention", name: m[1], accountId: m[2] });
    last = i + m[0].length;
  }
  if (last < body.length) segments.push({ kind: "text", text: body.slice(last) });
  return { segments, tasks };
}

/* ---- @ people menu ---- */

export interface MentionQuery {
  /** Index of the "@". */
  start: number;
  query: string;
}

/** The "@word" being typed at the caret, or null. An "@" inside a word (an email) does not count. */
export function mentionQueryAt(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.length > 24 || query.includes("\n") || query.includes("@")) return null;
  // A name may have several words ("@Nguyễn A"), but a space at the end means the word is finished: right after a
  // person is inserted ("@Trần Bình ") the menu must stay shut.
  if (/\s$/.test(query)) return null;
  return { start: at, query };
}

export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase();
}

/** People matching the typed words (diacritics ignored, every word must start a word of the name); me first when nothing is typed. */
export function filterPeople(users: readonly JiraUser[], query: string, meId?: string): JiraUser[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const rank = (u: JiraUser) => {
    const name = fold(u.displayName);
    if (words.length === 0) return u.accountId === meId ? 0 : 1;
    return name.startsWith(words[0]) ? 0 : 1;
  };
  return users
    .filter((u) => {
      if (words.length === 0) return true;
      const parts = fold(u.displayName).split(/\s+/);
      return words.every((w) => parts.some((p) => p.startsWith(w)));
    })
    .sort((a, b) => rank(a) - rank(b) || a.displayName.localeCompare(b.displayName, "vi"));
}

/** The menu's multi-select, file-manager style: Ctrl/Cmd toggles one, Shift extends from the anchor. */
export function nextMarks(
  marked: readonly string[],
  order: readonly string[],
  id: string,
  mod: { toggle: boolean; range: boolean },
  anchor: string | null
): string[] {
  if (mod.range && anchor && order.includes(anchor)) {
    const a = order.indexOf(anchor);
    const b = order.indexOf(id);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const span = order.slice(lo, hi + 1);
    return [...new Set([...marked, ...span])];
  }
  if (mod.toggle) return marked.includes(id) ? marked.filter((x) => x !== id) : [...marked, id];
  return [id];
}

/** Replace the "@query" at `q` with "@A @B " and move the caret after it; returns the label map to send with. */
export function insertMentions(
  text: string,
  q: MentionQuery,
  caret: number,
  people: readonly JiraUser[],
  mentions: Mentions
): { text: string; caret: number; mentions: Mentions } {
  const next: Mentions = new Map(mentions);
  const labels = people.map((p) => {
    const label = labelFor(next, p.displayName, p.accountId);
    next.set(label, { accountId: p.accountId, name: p.displayName });
    return `@${label}`;
  });
  const insert = `${labels.join(" ")} `;
  const out = text.slice(0, q.start) + insert + text.slice(caret);
  return { text: out, caret: q.start + insert.length, mentions: next };
}

/* ---- empty state ---- */

export type ChatView = "today" | "gantt" | "board" | "resource" | "report" | "settings" | "timesheet";

/** A few questions that fit the screen the person is on; each is a button, with no intro paragraph. */
export function suggestionsFor(view: ChatView, hasSelection: boolean): string[] {
  const common = ["Việc nào đang trễ?", "Tóm tắt tiến độ dự án"];
  if (hasSelection) return ["Các việc đang chọn đang vướng gì?", "Giao các việc đang chọn cho người ít bận nhất", ...common.slice(0, 1)];
  switch (view) {
    case "gantt":
      return ["Việc nào đang trễ?", "Chia việc cho một Epic", "Ai đang quá tải?", "Tóm tắt tiến độ dự án"];
    case "board":
      return ["Sprint này kịp không?", "Việc nào đang bị chặn?", "Gợi ý việc đưa vào sprint tới", "Ước lượng các việc chưa có điểm"];
    case "resource":
    case "timesheet":
      return ["Ai quá tải tuần sau?", "Ai chưa ghi giờ tuần này?", "Ai đang rảnh nhất?", "Tóm tắt tiến độ dự án"];
    case "report":
      return ["Tạo báo cáo tiến độ", "Rủi ro lớn nhất hiện giờ là gì?", ...common.slice(0, 1)];
    default:
      return ["Hôm nay tôi nên làm gì trước?", ...common, "Tạo việc mới"];
  }
}

/** True when the scroller is at (or within `slack` px of) the bottom, so new text may keep it there. */
export function atBottom(el: { scrollTop: number; clientHeight: number; scrollHeight: number }, slack = 48): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= slack;
}
