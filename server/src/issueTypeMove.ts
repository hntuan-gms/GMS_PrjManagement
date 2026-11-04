/**
 * Changing an issue's type, planned before Jira is asked.
 *
 * `PUT /issue` with a new `issuetype` only works between types that share a
 * workflow and field configuration; otherwise Jira answers "The issue type
 * selected is invalid". The way Jira's own UI does it is *Move*, and since 2024
 * that is a public API (`POST /bulk/issues/move`). A move has one decision the
 * edit never had: an issue whose status does not exist in the target type's
 * workflow (a "Done" the new workflow lacks) must be told which status to land
 * in. This module works that out from facts the caller has already read, so the
 * rule is testable without Jira:
 *
 *   - a status the target workflow has is kept (no mapping);
 *   - otherwise it maps to a target status of the same category — same name
 *     first ("Done" → "Done"), else the first of that category — and the
 *     proposal is shown to the person before anything is written;
 *   - a category the target has no status in cannot be mapped: the plan says so.
 */

export interface MoveSource {
  key: string;
  id: string;
  summary: string;
  typeName: string;
  subtask: boolean;
  statusId: string;
  statusName: string;
  statusCategory: string;
  hasAssignee: boolean;
}

export interface TargetType {
  id: string;
  name: string;
  subtask: boolean;
}

export interface TargetStatus {
  id: string;
  name: string;
  category: string;
}

export interface StatusProposal {
  fromStatusId: string;
  fromStatusName: string;
  /** null = the target has no status of this category: nothing to propose. */
  toStatusId: string | null;
  toStatusName: string | null;
  keys: string[];
}

export interface TypeMovePlan {
  target: TargetType;
  /** Keys that will be moved. */
  movable: string[];
  /** Already of the target type: nothing to do. */
  alreadyThere: string[];
  /** Cannot be moved by this route, with the reason shown to the person. */
  refused: Array<{ key: string; reason: string }>;
  /** Source statuses the target workflow lacks, and what each would become. */
  statusProposals: StatusProposal[];
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[\s\-_]+/g, " ")
    .trim();

export function planTypeMove(sources: MoveSource[], target: TargetType, targetStatuses: TargetStatus[]): TypeMovePlan {
  const plan: TypeMovePlan = { target, movable: [], alreadyThere: [], refused: [], statusProposals: [] };

  if (target.subtask) {
    // A sub-task needs a parent chosen, which this route has no way to say.
    for (const s of sources) plan.refused.push({ key: s.key, reason: `"${target.name}" là loại việc con — cần chọn việc cha, hãy dùng "Move" trên Jira.` });
    return plan;
  }

  const byStatus = new Map<string, StatusProposal>();
  const targetIds = new Set(targetStatuses.map((s) => s.id));

  for (const s of sources) {
    if (norm(s.typeName) === norm(target.name)) {
      plan.alreadyThere.push(s.key);
      continue;
    }
    if (s.subtask) {
      plan.refused.push({ key: s.key, reason: "là việc con — đổi loại việc con cần chọn việc cha, hãy dùng \"Move\" trên Jira." });
      continue;
    }
    // An Epic with an owner would book that person for its children's whole span
    // (see isAssignableType): the same rule updateTask enforces on the edit path.
    if (norm(target.name) === "epic" && s.hasAssignee) {
      plan.refused.push({ key: s.key, reason: "đang có người phụ trách, mà Epic thì không được gán người. Bỏ người phụ trách trước." });
      continue;
    }
    plan.movable.push(s.key);
    if (targetIds.has(s.statusId)) continue;

    let p = byStatus.get(s.statusId);
    if (!p) {
      const sameCategory = targetStatuses.filter((t) => t.category === s.statusCategory);
      const pick = sameCategory.find((t) => norm(t.name) === norm(s.statusName)) ?? sameCategory[0] ?? null;
      p = { fromStatusId: s.statusId, fromStatusName: s.statusName, toStatusId: pick?.id ?? null, toStatusName: pick?.name ?? null, keys: [] };
      byStatus.set(s.statusId, p);
    }
    p.keys.push(s.key);
  }
  plan.statusProposals = [...byStatus.values()];
  return plan;
}

/** The statuses that can't be placed anywhere — the move must not go ahead while any exist. */
export function unmappable(plan: TypeMovePlan): StatusProposal[] {
  return plan.statusProposals.filter((p) => p.toStatusId === null);
}

/**
 * The body Jira wants. `statusMap` (source status id → target status id) overrides
 * the proposal; anything left unmapped is a caller error caught by `unmappable`.
 * Notifications are off: a bulk email to every watcher for a housekeeping move
 * would be noise the person never asked for.
 */
export function buildMovePayload(
  projectKey: string,
  plan: TypeMovePlan,
  statusMap: Record<string, string> = {}
): Record<string, unknown> {
  const grouped = new Map<string, string[]>();
  for (const p of plan.statusProposals) {
    const to = statusMap[p.fromStatusId] ?? p.toStatusId;
    if (!to) continue;
    grouped.set(to, [...(grouped.get(to) ?? []), p.fromStatusId]);
  }
  const needsStatus = grouped.size > 0;
  return {
    sendBulkNotification: false,
    targetToSourcesMapping: {
      [`${projectKey},${plan.target.id}`]: {
        issueIdsOrKeys: plan.movable,
        inferFieldDefaults: true,
        inferSubtaskTypeDefault: true,
        inferClassificationDefaults: true,
        // Jira: targetStatus may only be given when inferStatusDefaults is false.
        inferStatusDefaults: !needsStatus,
        ...(needsStatus
          ? { targetStatus: [{ statuses: Object.fromEntries(grouped) }] }
          : {}),
      },
    },
  };
}
