import { textToAdf } from "./adf.js";
import { foldName } from "./jiraClient.js";

/**
 * A field Jira wants filled in before an issue may move — the "RootCause" box a workflow's
 * transition screen shows when you drag a card to Done. Without these the move is refused
 * with a 400 and a message only the workflow's author could read.
 *
 * Pure on purpose (no Jira calls): the shape of Jira's field metadata is the part that
 * varies, so it is the part worth testing.
 */
export type TransitionFieldKind = "text" | "textarea" | "select" | "number" | "date" | "unsupported";

export interface TransitionField {
  id: string;
  name: string;
  kind: TransitionFieldKind;
  /** Only for `select`. */
  options?: Array<{ id: string; label: string }>;
}

/** What Jira reports per field under `transitions.fields` and `editmeta`. */
export interface JiraFieldMeta {
  required?: boolean;
  hasDefaultValue?: boolean;
  name?: string;
  schema?: { type?: string; custom?: string; system?: string; items?: string };
  allowedValues?: Array<{ id?: string; name?: string; value?: string }>;
}

export function describeField(id: string, meta: JiraFieldMeta): TransitionField {
  const name = meta.name?.trim() || id;
  const type = meta.schema?.type ?? "";
  const custom = meta.schema?.custom ?? "";
  const system = meta.schema?.system ?? "";
  const options = (meta.allowedValues ?? [])
    .map((v) => ({ id: String(v.id ?? ""), label: String(v.value ?? v.name ?? "") }))
    .filter((o) => o.id && o.label);

  if (type === "string") {
    const long = /textarea/i.test(custom) || system === "description" || system === "environment";
    return { id, name, kind: long ? "textarea" : "text" };
  }
  if (type === "number") return { id, name, kind: "number" };
  if (type === "date") return { id, name, kind: "date" };
  if ((type === "option" || type === "resolution" || type === "priority") && options.length > 0) {
    return { id, name, kind: "select", options };
  }
  // Users, multi-selects, cascading selects, versions: not something a one-line form can fill
  // honestly. The caller says so and points at Jira instead of guessing a value.
  return { id, name, kind: "unsupported" };
}

/** The fields a transition cannot proceed without: required and with nothing to fall back on. */
export function requiredTransitionFields(fields: Record<string, JiraFieldMeta> | undefined): TransitionField[] {
  return Object.entries(fields ?? {})
    .filter(([id, m]) => m.required && !m.hasDefaultValue && id !== "comment")
    .map(([id, m]) => describeField(id, m));
}

/** The value Jira's REST v3 expects for what a person typed or picked. Null = unusable as given. */
export function fieldValue(f: TransitionField, raw: string): unknown | null {
  const text = raw.trim();
  if (!text) return null;
  switch (f.kind) {
    case "text":
    case "date":
      return text;
    // v3 takes rich-text custom fields as ADF, never as a bare string.
    case "textarea":
      return textToAdf(text);
    case "number": {
      const n = Number(text.replace(",", "."));
      return Number.isFinite(n) ? n : null;
    }
    case "select":
      return f.options?.some((o) => o.id === text) ? { id: text } : null;
    default:
      return null;
  }
}

/**
 * Jira's "Vui lòng nhập RootCause" can come from a workflow validator rather than the
 * transition screen, so the field is not among the transition's own. When its name is
 * quoted in the refusal, though, the issue's editable fields usually hold it: matched
 * with case, spacing and diacritics folded ("RootCause" ↔ "Root Cause").
 */
export function fieldsNamedIn(message: string, editable: Record<string, JiraFieldMeta> | undefined): TransitionField[] {
  const text = foldName(message);
  return Object.entries(editable ?? {})
    .filter(([, m]) => {
      const name = foldName(m.name ?? "");
      return name.length >= 3 && text.includes(name);
    })
    .map(([id, m]) => describeField(id, m))
    .filter((f) => f.kind !== "unsupported");
}
