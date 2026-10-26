import type { TransitionField } from "./types";

/**
 * Helpers for the boxes a workflow wants filled before an issue may move. Kept out of the
 * components so the rules — what counts as filled, how a refusal becomes a form — can be tested.
 */

export interface NeededFields {
  fields: TransitionField[];
  toStatusName?: string;
  /** Jira's own sentence, when the requirement came from a validator rather than a screen. */
  reason?: string;
}

/** The form a refused status change asks for, or null if the error is anything else. */
export function neededFieldsFrom(err: unknown): NeededFields | null {
  // Read by shape, not instanceof: this module stays free of the API client (and its fetch).
  const e = err as { code?: unknown; details?: unknown } | null;
  if (!e || typeof e !== "object" || e.code !== "TRANSITION_FIELDS_REQUIRED") return null;
  const d = e.details as { fields?: unknown; toStatusName?: unknown; reason?: unknown } | undefined;
  if (!d || !Array.isArray(d.fields) || d.fields.length === 0) return null;
  return {
    fields: d.fields as TransitionField[],
    toStatusName: typeof d.toStatusName === "string" ? d.toStatusName : undefined,
    reason: typeof d.reason === "string" && d.reason ? d.reason : undefined,
  };
}

/** Fields the person has not answered yet. A field that cannot be filled here never counts as answered. */
export function missingFields(fields: TransitionField[], values: Record<string, string>): TransitionField[] {
  return fields.filter((f) => f.kind === "unsupported" || !(values[f.id] ?? "").trim());
}

/** The same field asked by several issues' transitions, once. */
export function uniqueFields(lists: TransitionField[][]): TransitionField[] {
  const seen = new Map<string, TransitionField>();
  for (const f of lists.flat()) if (!seen.has(f.id)) seen.set(f.id, f);
  return [...seen.values()];
}
