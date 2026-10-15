import type { Task } from "../types.js";
import { fold } from "./toolUtils.js";

/**
 * "Is this already in the project?" — a word-overlap score between task titles,
 * computed here so the assistant can quote it instead of guessing. No embeddings:
 * within one project a duplicate is almost always the same few distinctive words
 * ("thiết kế màn hình đăng nhập" vs "Thiết kế màn hình login"), and an overlap
 * score is explainable ("trùng 4/5 từ khoá") where a vector distance is not.
 *
 * Both Vietnamese with and without diacritics fold to the same tokens (fold()).
 */

/**
 * Words that carry no identity: connectives and the verbs every task title starts with.
 *
 * Words are compared WITHOUT diacritics, so a stopword must not collide with a
 * meaningful word once they are stripped: "đang" (currently) folds to the same
 * "dang" as "đăng" (as in đăng nhập), "bằng"/"bảng", "về"/"vé", "từ"/"tự", "đề"/"để",
 * "hiện"/"hiển" all collide, so none of those is listed even though they are common.
 * Missing a connective costs a little precision; dropping a real keyword costs recall.
 */
const STOPWORDS = new Set(
  [
    // vi
    "va", "cho", "cac", "la", "cua", "voi", "mot", "nhung", "trong", "tren", "khi", "duoc", "theo", "nay", "se",
    "viec", "thuc", "lam",
    // en
    "the", "an", "of", "to", "for", "and", "in", "on", "with", "or", "is", "be", "by", "at", "as",
  ].map(fold)
);

export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of fold(text).split(/[^a-z0-9]+/)) {
    if (w.length >= 2 && !STOPWORDS.has(w)) out.add(w);
  }
  return out;
}

function overlap(a: Set<string>, b: Set<string>): { shared: string[]; score: number } {
  if (a.size === 0 || b.size === 0) return { shared: [], score: 0 };
  const shared = [...a].filter((w) => b.has(w));
  if (shared.length === 0) return { shared, score: 0 };
  const union = a.size + b.size - shared.length;
  const jaccard = shared.length / union;
  // Containment forgives a short title that sits inside a longer one ("Đăng nhập"
  // inside "Thiết kế màn hình đăng nhập"); Jaccard alone would score it low.
  const containment = shared.length / Math.min(a.size, b.size);
  return { shared, score: 0.5 * jaccard + 0.5 * containment };
}

export interface SimilarTask {
  id: string;
  summary: string;
  status: string;
  assignee: string | null;
  /** 0–1. */
  score: number;
  sharedWords: string[];
}

/** Below this a pair is "related at best". Tuned so a one-word coincidence never reaches it. */
export const DUPLICATE_THRESHOLD = 0.6;

/**
 * Tasks in `tasks` that look like `query`, best first. Titles decide; a
 * description, when given, can raise a score (it never lowers one) because the
 * same work is sometimes titled differently but described alike.
 */
export function findSimilarTasks(
  query: { summary: string; description?: string | null },
  tasks: Task[],
  opts: { min?: number; limit?: number; excludeId?: string } = {}
): SimilarTask[] {
  const min = opts.min ?? DUPLICATE_THRESHOLD;
  const limit = opts.limit ?? 5;
  const q = tokens(query.summary);
  const qFull = query.description ? tokens(`${query.summary} ${query.description}`) : null;

  const hits: SimilarTask[] = [];
  for (const t of tasks) {
    if (t.id === opts.excludeId) continue;
    const title = overlap(q, tokens(t.summary));
    let { score, shared } = title;
    if (qFull && t.description) {
      const full = overlap(qFull, tokens(`${t.summary} ${t.description}`));
      // Discounted: long texts share common words by accident.
      if (full.score * 0.8 > score) {
        score = full.score * 0.8;
        shared = full.shared;
      }
    }
    // One shared word is a coincidence however short the titles are.
    if (shared.length < 2 || score < min) continue;
    hits.push({
      id: t.id,
      summary: t.summary,
      status: t.statusName,
      assignee: t.assigneeName,
      score: Math.round(score * 100) / 100,
      sharedWords: shared.slice(0, 8),
    });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
