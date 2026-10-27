import type { ResourceProfile } from "./types";

/**
 * Skills matrix: people down the side, skills across the top. Pure, so the table
 * and its tests share one definition of "the same skill".
 *
 * Skills are free text typed by whoever edits a profile, so "React", "react" and
 * "Reáct" must land in one column — otherwise the matrix fills with near-duplicates
 * and the question it answers ("who knows React?") gets three partial answers. The
 * column keeps the spelling most people used; the key is only for comparing.
 */

export const skillKey = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .trim()
    .toLowerCase();

/** Trimmed, empty ones dropped, and one entry per skill (first spelling wins). */
export function normalizeSkills(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const label = raw.trim();
    const key = skillKey(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

/** Add the skill if absent, remove it if present — what clicking a matrix cell does. */
export function toggleSkill(skills: string[], label: string): string[] {
  const key = skillKey(label);
  return skills.some((s) => skillKey(s) === key)
    ? skills.filter((s) => skillKey(s) !== key)
    : normalizeSkills([...skills, label]);
}

export interface SkillColumn {
  key: string;
  label: string;
  /** How many of the listed people have it. */
  count: number;
}

export interface SkillRow {
  accountId: string;
  displayName: string;
  role: string | null;
  skills: string[];
  /** Skill keys, for the cell lookup. */
  has: Set<string>;
}

export interface SkillMatrix {
  columns: SkillColumn[];
  rows: SkillRow[];
  /** Members with no skill recorded — the gap the matrix exists to show. */
  withoutSkills: number;
}

export function buildSkillMatrix(
  users: Array<{ accountId: string; displayName: string }>,
  profiles: ResourceProfile[],
  extraColumns: string[] = []
): SkillMatrix {
  const byAccount = new Map(profiles.map((p) => [p.accountId, p]));
  const labels = new Map<string, { label: string; votes: Map<string, number> }>();
  const note = (raw: string) => {
    const label = raw.trim();
    const key = skillKey(label);
    if (!key) return null;
    const entry = labels.get(key) ?? { label, votes: new Map() };
    entry.votes.set(label, (entry.votes.get(label) ?? 0) + 1);
    labels.set(key, entry);
    return key;
  };

  const rows: SkillRow[] = users.map((u) => {
    const profile = byAccount.get(u.accountId);
    const has = new Set<string>();
    for (const s of profile?.skills ?? []) {
      const key = note(s);
      if (key) has.add(key);
    }
    return {
      accountId: u.accountId,
      displayName: u.displayName,
      role: profile?.role ?? null,
      skills: normalizeSkills(profile?.skills ?? []),
      has,
    };
  });
  // A skill added in the UI before anyone has it is still a column.
  for (const extra of extraColumns) note(extra);

  const columns: SkillColumn[] = [...labels].map(([key, entry]) => {
    // The spelling most people used, ties to the first seen.
    let best = entry.label;
    let bestVotes = 0;
    for (const [label, votes] of entry.votes) {
      if (votes > bestVotes) {
        best = label;
        bestVotes = votes;
      }
    }
    return { key, label: best, count: rows.filter((r) => r.has.has(key)).length };
  });
  columns.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "vi"));

  rows.sort((a, b) => b.has.size - a.has.size || a.displayName.localeCompare(b.displayName, "vi"));
  return { columns, rows, withoutSkills: rows.filter((r) => r.has.size === 0).length };
}

/** Rows whose name, role or any skill contains the text (diacritics ignored). */
export function filterRows(rows: SkillRow[], query: string): SkillRow[] {
  const q = skillKey(query);
  if (!q) return rows;
  return rows.filter((r) => skillKey(`${r.displayName} ${r.role ?? ""} ${r.skills.join(" ")}`).includes(q));
}
