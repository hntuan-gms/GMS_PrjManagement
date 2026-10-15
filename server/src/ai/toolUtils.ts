import type { JiraUser, Task } from "../types.js";

/**
 * Small helpers every chat tool needs — argument reading, date shifting, and
 * turning what a user typed ("vo dinh quang", "gpm-12") into the real thing.
 * Kept apart from tools.ts so the edit tools (editTools.ts) can share them
 * without a runtime import cycle.
 */

export function addDays(iso: string, days: number): string {
  const ms = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function str(args: Record<string, unknown>, key: string): string {
  return String(args[key] ?? "").trim();
}

export function findTaskIn(tasks: Task[], id: string): Task | undefined {
  const needle = id.trim().toUpperCase();
  return tasks.find((t) => t.id.toUpperCase() === needle);
}

/** Lowercase, no diacritics, single spaces — "Võ Đình  Quang" and "vo dinh quang" fold to the same string. */
export function fold(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A name as the user typed it → one team member, or a reason why not.
 *
 * Users type Vietnamese names without diacritics, drop the family name, or use
 * just the given name, and none of that should need the model to go fetch the
 * team first. Exact (folded) match wins; otherwise every typed word must appear
 * in the name. More than one hit is returned as a question, never guessed —
 * assigning the wrong "Quang" is worse than asking which one.
 */
export function resolvePerson(
  team: JiraUser[],
  raw: string
): { person: JiraUser } | { error: string; candidates?: string[] } {
  const q = fold(raw);
  if (!q) return { error: "Chưa có tên người phụ trách." };
  const exact = team.filter((u) => fold(u.displayName) === q);
  if (exact.length === 1) return { person: exact[0] };
  const words = q.split(" ");
  const partial = team.filter((u) => {
    const name = fold(u.displayName).split(" ");
    return words.every((w) => name.includes(w));
  });
  const hits = exact.length > 1 ? exact : partial;
  if (hits.length === 1) return { person: hits[0] };
  if (hits.length > 1) {
    return {
      error: `Có ${hits.length} người khớp với "${raw}". Hỏi lại người dùng muốn chọn ai.`,
      candidates: hits.map((u) => `${u.displayName} (${u.accountId})`),
    };
  }
  return {
    error: `Không có ai tên "${raw}" trong nhóm dự án.`,
    candidates: team.slice(0, 40).map((u) => u.displayName),
  };
}

/** What people say in Vietnamese for Jira's stock priority names. */
const PRIORITY_WORDS: Record<string, string> = {
  "khan cap": "highest",
  "cuc cao": "highest",
  "cao nhat": "highest",
  blocker: "highest",
  critical: "highest",
  cao: "high",
  "trung binh": "medium",
  vua: "medium",
  thuong: "medium",
  binh: "medium",
  thap: "low",
  "thap nhat": "lowest",
  "cuc thap": "lowest",
};

/**
 * A priority as spoken ("cao", "khẩn cấp", "High") → one of this site's own
 * priority names. Sites rename priorities, so the stock word only picks the
 * candidate; the answer is always a name from `available`.
 */
export function resolvePriority(available: string[], raw: string): { name: string } | { error: string; available: string[] } {
  const q = fold(raw);
  const target = PRIORITY_WORDS[q] ?? q;
  const hit = available.find((p) => fold(p) === target) ?? available.find((p) => fold(p) === q);
  if (hit) return { name: hit };
  return { error: `Không có mức ưu tiên "${raw}" trong dự án này.`, available };
}
