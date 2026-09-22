import { GoogleGenAI, Type } from "@google/genai";
import type { JiraUser, Predecessor } from "../types.js";

/**
 * Turns a plain-language project brief into a reviewable work breakdown.
 *
 * The division of labour here is the whole design: the model decides *semantics*
 * — what the tasks are, which one must finish before another can start, who has
 * the right skills — and this file's own code decides every *number* that has to
 * be right. Models are unreliable at date arithmetic and will happily emit a
 * schedule that contradicts its own dependency list, so `layoutSchedule()` below
 * derives the dates from durations and the dependency graph instead of asking.
 *
 * Nothing here writes to Jira. The output is a proposal that lands in
 * ai_plan_item for a human to edit and approve (see routes/ai.ts).
 */

export interface PlannerResource {
  accountId: string;
  displayName: string;
  role: string | null;
  skills: string[];
  /** Inclusive ISO ranges this person is already unavailable. */
  absences: Array<{ from: string; to: string }>;
}

export interface PlannerInput {
  brief: string;
  projectKey: string;
  /** Names this project actually accepts, read from Jira — not the hard-coded union. */
  issueTypes: Array<{ name: string; subtask: boolean }>;
  resources: PlannerResource[];
  /** Day 1 of the plan; every derived date is relative to it. */
  startDate: string;
}

export interface PlannedItem {
  tempId: string;
  parentTempId: string | null;
  summary: string;
  description: string | null;
  issueType: string;
  durationDays: number;
  assigneeAccountId: string | null;
  dependencies: Array<{ tempId: string; type: Predecessor["type"]; lagDays: number }>;
  rationale: string | null;
  /** Derived here, never asked of the model. */
  startDate: string;
  dueDate: string;
}

export interface PlannerResult {
  items: PlannedItem[];
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Things quietly corrected in the model's output, surfaced to the reviewer. */
  warnings: string[];
  raw: unknown;
}

const DEPENDENCY_TYPES = ["FS", "SS", "FF", "SF"] as const;

/**
 * Deliberately not `responseJsonSchema`: `responseSchema` is the constrained-
 * decoding path, so the model cannot emit a shape that fails to parse. Every
 * field the review UI and the apply step need is required here, because an
 * optional field is one the model will sometimes omit and the apply step will
 * then have to guess at.
 */
const PLAN_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          tempId: { type: Type.STRING, description: "Stable id for this plan only, e.g. T1, T2." },
          parentTempId: {
            type: Type.STRING,
            description: "tempId of the parent work item, or an empty string for a top-level item.",
          },
          summary: { type: Type.STRING },
          description: { type: Type.STRING },
          issueType: { type: Type.STRING, description: "Must be exactly one of the allowed issue types." },
          durationDays: { type: Type.INTEGER, description: "Working days of effort, at least 1." },
          assigneeAccountId: {
            type: Type.STRING,
            description: "accountId of a listed team member, or an empty string if nobody fits.",
          },
          dependencies: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                tempId: { type: Type.STRING, description: "tempId of the PREDECESSOR item." },
                type: { type: Type.STRING, enum: [...DEPENDENCY_TYPES] },
                lagDays: { type: Type.INTEGER },
              },
              required: ["tempId", "type", "lagDays"],
            },
          },
          rationale: { type: Type.STRING, description: "One short sentence: why this duration and this assignee." },
        },
        required: [
          "tempId",
          "parentTempId",
          "summary",
          "description",
          "issueType",
          "durationDays",
          "assigneeAccountId",
          "dependencies",
          "rationale",
        ],
      },
    },
  },
  required: ["items"],
};

function systemPrompt(input: PlannerInput): string {
  const types = input.issueTypes.map((t) => `- ${t.name}${t.subtask ? " (sub-task)" : ""}`).join("\n");
  const people =
    input.resources.length === 0
      ? "(no team members are registered, so leave every assigneeAccountId empty)"
      : input.resources
          .map((r) => {
            const skills = r.skills.length > 0 ? r.skills.join(", ") : "no skills recorded";
            const away =
              r.absences.length > 0
                ? ` | unavailable: ${r.absences.map((a) => `${a.from}..${a.to}`).join(", ")}`
                : "";
            return `- ${r.displayName} (accountId: ${r.accountId}) | role: ${r.role ?? "unspecified"} | skills: ${skills}${away}`;
          })
          .join("\n");

  return [
    "You are a delivery lead breaking a software project into a work breakdown structure for a Gantt chart.",
    "",
    "Rules:",
    "1. Produce a hierarchy: top-level phases, each with concrete child tasks. Reference parents by tempId.",
    "2. issueType must be copied verbatim from the allowed list. Use a sub-task type only for items that have a parent.",
    "3. durationDays is effort in working days for one person. Be realistic; do not pad every task to the same number.",
    "4. dependencies lists the items that must come BEFORE this one. Use FS unless another type is genuinely right:",
    "   FS finish-to-start, SS start-together, FF finish-together, SF start-to-finish. lagDays is usually 0.",
    "5. Only create a dependency when the work genuinely cannot proceed otherwise. Do not chain everything linearly,",
    "   and never create a cycle.",
    "6. assigneeAccountId must be an accountId copied from the team list, chosen by skill and role fit. Leave it empty",
    "   when no one fits. Do not invent people and do not put dates in any field.",
    "7. Do NOT output dates or a schedule. Dates are computed from durations and dependencies by the caller.",
    "",
    `Allowed issue types for project ${input.projectKey}:`,
    types,
    "",
    "Team:",
    people,
  ].join("\n");
}

/** Reads GEMINI_API_KEY lazily so the rest of the app boots without it. */
function client(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Missing GEMINI_API_KEY. The AI planner needs it; everything else in the app works without it."
    );
  }
  return new GoogleGenAI({ apiKey });
}

export async function generatePlan(input: PlannerInput): Promise<PlannerResult> {
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
  const response = await client().models.generateContent({
    model,
    contents: `${systemPrompt(input)}\n\n---\n\nProject brief:\n${input.brief}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: PLAN_SCHEMA,
      temperature: 0.4,
    },
  });

  const text = response.text;
  if (!text) throw new Error("The planner returned an empty response.");

  let parsed: { items?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The planner returned a response that was not valid JSON.");
  }

  const warnings: string[] = [];
  const items = normalize(Array.isArray(parsed.items) ? parsed.items : [], input, warnings);
  if (items.length === 0) throw new Error("The planner produced no tasks. Try describing the project in more detail.");

  return {
    items: layoutSchedule(items, input.startDate),
    model,
    inputTokens: response.usageMetadata?.promptTokenCount ?? null,
    outputTokens: response.usageMetadata?.candidatesTokenCount ?? null,
    warnings,
    raw: parsed,
  };
}

type DraftItem = Omit<PlannedItem, "startDate" | "dueDate">;

/**
 * Constrained decoding guarantees the SHAPE of the response, not its meaning: the
 * model can still name an issue type this project doesn't have, assign someone
 * who isn't on the team, or point a dependency at a tempId it never emitted.
 * Each of those would fail — or silently corrupt the plan — only at apply time,
 * so they are corrected here and reported to the reviewer instead.
 */
function normalize(raw: unknown[], input: PlannerInput, warnings: string[]): DraftItem[] {
  const allowedTypes = new Map(input.issueTypes.map((t) => [t.name.toLowerCase(), t]));
  const fallbackType = input.issueTypes.find((t) => !t.subtask)?.name ?? input.issueTypes[0]?.name;
  const knownAccounts = new Set(input.resources.map((r) => r.accountId));

  const items: DraftItem[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const row = entry as Record<string, unknown>;
    const tempId = String(row.tempId ?? "").trim();
    const summary = String(row.summary ?? "").trim();
    if (!tempId || !summary || seen.has(tempId)) continue;
    seen.add(tempId);

    const proposedType = String(row.issueType ?? "").trim();
    const matched = allowedTypes.get(proposedType.toLowerCase());
    if (!matched && fallbackType) {
      warnings.push(`"${summary}": issue type "${proposedType}" is not in this project; used "${fallbackType}".`);
    }

    const assignee = String(row.assigneeAccountId ?? "").trim();
    if (assignee && !knownAccounts.has(assignee)) {
      warnings.push(`"${summary}": assignee was not on the team list and has been cleared.`);
    }

    const duration = Number(row.durationDays);
    items.push({
      tempId,
      parentTempId: String(row.parentTempId ?? "").trim() || null,
      summary,
      description: String(row.description ?? "").trim() || null,
      issueType: matched?.name ?? fallbackType ?? proposedType,
      durationDays: Number.isFinite(duration) ? Math.max(1, Math.round(duration)) : 1,
      assigneeAccountId: assignee && knownAccounts.has(assignee) ? assignee : null,
      dependencies: [],
      rationale: String(row.rationale ?? "").trim() || null,
    });
  }

  const byId = new Map(items.map((i) => [i.tempId, i]));
  for (const item of items) {
    if (item.parentTempId && !byId.has(item.parentTempId)) {
      warnings.push(`"${item.summary}": parent referenced an unknown item and was made top-level.`);
      item.parentTempId = null;
    }
  }

  // Dependencies are attached only after every tempId is known, so an edge can be
  // checked against the final set rather than whatever had been parsed so far.
  raw.forEach((entry) => {
    const row = entry as Record<string, unknown>;
    const item = byId.get(String(row.tempId ?? "").trim());
    if (!item) return;
    const deps = Array.isArray(row.dependencies) ? row.dependencies : [];
    for (const dep of deps) {
      const d = dep as Record<string, unknown>;
      const predId = String(d.tempId ?? "").trim();
      const type = String(d.type ?? "FS").toUpperCase() as Predecessor["type"];
      if (!byId.has(predId) || predId === item.tempId) {
        warnings.push(`"${item.summary}": dropped a dependency on an unknown item.`);
        continue;
      }
      if (!DEPENDENCY_TYPES.includes(type)) continue;
      const lag = Number(d.lagDays);
      item.dependencies.push({ tempId: predId, type, lagDays: Number.isFinite(lag) ? Math.round(lag) : 0 });
    }
  });

  return breakCycles(items, warnings);
}

/**
 * A cycle would make the schedule below unsolvable and, once applied, would make
 * the live dependency cascade chase its own tail. Edges that close a cycle are
 * dropped rather than the whole plan rejected — the rest of a 40-task breakdown
 * is still worth reviewing.
 */
function breakCycles(items: DraftItem[], warnings: string[]): DraftItem[] {
  const byId = new Map(items.map((i) => [i.tempId, i]));
  const state = new Map<string, "visiting" | "done">();

  const visit = (id: string) => {
    const item = byId.get(id);
    if (!item || state.get(id) === "done") return;
    state.set(id, "visiting");
    item.dependencies = item.dependencies.filter((dep) => {
      if (state.get(dep.tempId) === "visiting") {
        warnings.push(`"${item.summary}": dropped a dependency that formed a loop.`);
        return false;
      }
      visit(dep.tempId);
      return true;
    });
    state.set(id, "done");
  };

  for (const item of items) visit(item.tempId);
  return items;
}

/**
 * Forward pass over the dependency graph, using the same FS/SS/FF/SF rules the
 * live cascade uses (taskService.applyDependencyCascade), so the preview a
 * reviewer approves matches what the app will enforce once the issues exist.
 */
export function layoutSchedule<T extends DraftItem>(
  items: T[],
  projectStart: string
): Array<T & { startDate: string; dueDate: string }> {
  const byId = new Map(items.map((i) => [i.tempId, i]));
  const scheduled = new Map<string, { startDate: string; dueDate: string }>();

  const resolve = (id: string, guard: Set<string>): { startDate: string; dueDate: string } => {
    const cached = scheduled.get(id);
    if (cached) return cached;
    const item = byId.get(id)!;
    // breakCycles has already run, so this only catches a caller passing in a
    // hand-edited graph that reintroduced one.
    if (guard.has(id)) {
      const fallback = { startDate: projectStart, dueDate: addDays(projectStart, item.durationDays - 1) };
      scheduled.set(id, fallback);
      return fallback;
    }
    guard.add(id);

    let start = projectStart;
    for (const dep of item.dependencies) {
      const pred = byId.get(dep.tempId);
      if (!pred) continue;
      const predDates = resolve(dep.tempId, guard);
      let earliest: string;
      if (dep.type === "FS") earliest = addDays(predDates.dueDate, dep.lagDays + 1);
      else if (dep.type === "SS") earliest = addDays(predDates.startDate, dep.lagDays);
      else if (dep.type === "FF") earliest = addDays(predDates.dueDate, dep.lagDays - (item.durationDays - 1));
      else earliest = addDays(predDates.startDate, dep.lagDays - (item.durationDays - 1));
      if (earliest > start) start = earliest;
    }
    guard.delete(id);

    const dates = { startDate: start, dueDate: addDays(start, item.durationDays - 1) };
    scheduled.set(id, dates);
    return dates;
  };

  return items.map((item) => ({ ...item, ...resolve(item.tempId, new Set()) }));
}

/** UTC-based, matching the server's convention everywhere else. */
function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Team members enriched with whatever the resource tables know about them. */
export function toPlannerResources(
  users: JiraUser[],
  profiles: Map<string, { role: string | null; skills: string[] }>,
  absences: Map<string, Array<{ from: string; to: string }>>
): PlannerResource[] {
  return users.map((u) => ({
    accountId: u.accountId,
    displayName: u.displayName,
    role: profiles.get(u.accountId)?.role ?? null,
    skills: profiles.get(u.accountId)?.skills ?? [],
    absences: absences.get(u.accountId) ?? [],
  }));
}
