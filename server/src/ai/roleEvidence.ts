import type { Task } from "../types.js";

/**
 * What each person has actually worked on, derived from the project's own Jira
 * history.
 *
 * The resource_profile table is the declared answer to "who does what", and on
 * every real team it is empty: nobody maintains a skills matrix. Jira already
 * holds the evidence — the issues a person has been assigned and what those
 * issues were called — so this reads it instead of asking anyone to type it in.
 *
 * Deliberately evidence, not conclusions: it reports "12 issues, words: api,
 * endpoint, migration" and lets the model judge, rather than stamping someone
 * "Backend Developer" here. A keyword count is weak evidence, and dressing it up
 * as a job title would hide how weak it is at the point where it matters.
 */
export interface RoleEvidence {
  accountId: string;
  taskCount: number;
  /** Most frequent meaningful words across this person's issue summaries. */
  keywords: string[];
  /** Issue types they have worked on, most common first. */
  issueTypes: string[];
}

// Words that carry no signal about what someone specialises in. Kept short on
// purpose: an over-eager stoplist silently deletes the domain vocabulary that
// makes this useful in the first place.
const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "into", "this", "that", "them", "then",
  "add", "fix", "update", "create", "make", "new", "task", "issue", "test",
  "cho", "các", "của", "và", "với", "khi", "thêm", "sửa", "tạo", "làm", "mới",
  "trong", "theo", "được", "một", "phần", "này", "đó", "để", "từ", "là",
]);

function topBy<T>(counts: Map<T, number>, limit: number): T[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value]) => value);
}

export function inferRoleEvidence(tasks: Task[]): Map<string, RoleEvidence> {
  const byPerson = new Map<string, { words: Map<string, number>; types: Map<string, number>; count: number }>();

  for (const task of tasks) {
    const id = task.assigneeAccountId;
    if (!id) continue;
    const entry = byPerson.get(id) ?? { words: new Map(), types: new Map(), count: 0 };
    entry.count++;
    entry.types.set(task.issueType, (entry.types.get(task.issueType) ?? 0) + 1);

    // Unicode-aware so Vietnamese summaries tokenise as words rather than being
    // shredded at every diacritic.
    for (const word of task.summary.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}+#.-]*/gu) ?? []) {
      if (word.length < 3 || STOPWORDS.has(word)) continue;
      entry.words.set(word, (entry.words.get(word) ?? 0) + 1);
    }
    byPerson.set(id, entry);
  }

  const out = new Map<string, RoleEvidence>();
  for (const [accountId, entry] of byPerson) {
    out.set(accountId, {
      accountId,
      taskCount: entry.count,
      keywords: topBy(entry.words, 8),
      issueTypes: topBy(entry.types, 3),
    });
  }
  return out;
}

/** One line per person for the prompt, or null when there is nothing to say. */
export function describeEvidence(evidence: RoleEvidence | undefined): string | null {
  if (!evidence || evidence.taskCount === 0) return null;
  const parts = [`${evidence.taskCount} issue đã từng nhận`];
  if (evidence.issueTypes.length > 0) parts.push(`loại: ${evidence.issueTypes.join("/")}`);
  if (evidence.keywords.length > 0) parts.push(`hay làm về: ${evidence.keywords.join(", ")}`);
  return parts.join(" | ");
}
