/**
 * What a write tool did, as one line per issue the browser can show as a receipt.
 * Pure: built from the tool's own answer plus the tasks as they were before and after.
 *
 * `undo.patch` is exactly what the browser sends to `PATCH /api/tasks/:id` to put the
 * task back (the same call a drag makes, so the cascade pulls zero-slack successors
 * back by itself). It is offered only when every change the call made can be restored
 * that way; a status change, a rename or a delete is a Jira write with side effects
 * and is not undoable, same as the undo button elsewhere.
 */
import type { Task } from "../types.js";

export interface ReceiptItem {
  key: string;
  text: string;
  undo?: { patch: Record<string, unknown> };
}

/** Tools worth snapshotting the task list for. */
const WRITE_TOOLS = new Set([
  "create_task",
  "assign_task",
  "unassign_task",
  "update_task",
  "add_dependency",
  "remove_dependency",
  "delete_task",
  "change_issue_type",
  "move_to_sprint",
  "set_estimate",
  "add_comment",
  "log_work",
]);

export const isReceiptTool = (name: string): boolean => WRITE_TOOLS.has(name);

const text = (v: unknown): string => (typeof v === "string" ? v : "");
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const find = (tasks: Task[], id: string) => tasks.find((t) => t.id.toUpperCase() === id.trim().toUpperCase());

function dmy(iso: string | null): string {
  return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—";
}

/** The receipt lines for one tool call; empty when nothing was written. */
export function buildReceipt(
  name: string,
  args: Record<string, unknown>,
  response: Record<string, unknown>,
  before: Task[],
  after: Task[]
): ReceiptItem[] {
  if (response.error || response.needsConfirmation === true) return [];

  switch (name) {
    case "create_task": {
      const key = text(response.created);
      return key ? [{ key, text: `Đã tạo ${key} · ${text(response.summary)}` }] : [];
    }

    case "assign_task": {
      const key = text(response.taskId);
      if (!key) return [];
      const was = find(before, key);
      const now = find(after, key);
      const to = text(response.assignedTo) || now?.assigneeName || "";
      return [
        {
          key,
          text: `${key} → ${to}`,
          ...(was ? { undo: { patch: { assigneeAccountId: was.assigneeAccountId ?? null } } } : {}),
        },
      ];
    }

    case "unassign_task": {
      const key = text(response.taskId);
      if (!key) return [];
      const was = find(before, key);
      return [
        {
          key,
          text: `${key} bỏ gán`,
          ...(was?.assigneeAccountId ? { undo: { patch: { assigneeAccountId: was.assigneeAccountId } } } : {}),
        },
      ];
    }

    case "update_task": {
      const brief = response.task as Record<string, unknown> | undefined;
      const key = text(brief?.id);
      if (!key) return [];
      return [updateReceipt(key, find(before, key), find(after, key), before, after)];
    }

    case "add_dependency": {
      const linked = text(response.linked);
      return linked ? [{ key: text(args.successorId).toUpperCase(), text: `Đã nối ${linked}` }] : [];
    }
    case "remove_dependency": {
      const removed = text(response.removed);
      return removed ? [{ key: text(args.successorId).toUpperCase(), text: `Đã bỏ nối ${removed}` }] : [];
    }

    case "delete_task": {
      const key = text(response.deleted);
      return key ? [{ key, text: `Đã xoá ${key}` }] : [];
    }

    case "change_issue_type": {
      const to = text(response.movedTo);
      return list(response.moved).map((key) => ({ key, text: `${key} đổi loại sang ${to}` }));
    }

    case "move_to_sprint": {
      const to = text(response.to);
      return list(response.moved).map((key) => ({ key, text: `${key} → ${to}` }));
    }

    case "set_estimate": {
      const key = text(response.taskId);
      return key ? [{ key, text: `${key} ước lượng đã đặt` }] : [];
    }

    case "add_comment": {
      const key = text(response.commented);
      return key ? [{ key, text: `Đã bình luận ${key}` }] : [];
    }

    case "log_work": {
      const logged = response.logged as Record<string, unknown> | undefined;
      const key = text(logged?.task);
      return key ? [{ key, text: `Đã ghi ${String(logged?.hours ?? "")}h vào ${key}` }] : [];
    }

    default:
      return [];
  }
}

/** update_task: what changed, found by comparing the task before and after (not by trusting the arguments). */
function updateReceipt(key: string, was: Task | undefined, now: Task | undefined, before: Task[], after: Task[]): ReceiptItem {
  if (!was || !now) return { key, text: `Đã cập nhật ${key}` };

  const parts: string[] = [];
  const patch: Record<string, unknown> = {};
  let restorable = true;

  if (was.summary !== now.summary) {
    parts.push("đổi tên");
    restorable = false;
  }
  if (was.statusName !== now.statusName) {
    parts.push(`${was.statusName} → ${now.statusName}`);
    restorable = false;
  }
  if ((was.assigneeAccountId ?? null) !== (now.assigneeAccountId ?? null)) {
    parts.push(`người: ${was.assigneeName ?? "—"} → ${now.assigneeName ?? "—"}`);
    patch.assigneeAccountId = was.assigneeAccountId ?? null;
  }
  if (was.startDate !== now.startDate || was.durationDays !== now.durationDays) {
    parts.push(`ngày ${dmy(now.startDate)}–${dmy(now.dueDate)}`);
    if (was.startDate) {
      patch.startDate = was.startDate;
      patch.durationDays = was.durationDays;
    } else {
      restorable = false;
    }
  }
  if (was.percentComplete !== now.percentComplete) {
    parts.push(`${now.percentComplete}%`);
    patch.percentComplete = was.percentComplete;
  }
  if (was.priority !== now.priority) {
    parts.push(`ưu tiên ${now.priority ?? "—"}`);
    restorable = false;
  }
  if ((was.estimateHours ?? null) !== (now.estimateHours ?? null)) {
    parts.push(`ước lượng ${now.estimateHours ?? "—"}h`);
    restorable = false;
  }
  if (was.labels.join("\u0000") !== now.labels.join("\u0000")) {
    parts.push("nhãn");
    restorable = false;
  }
  if (was.components.join("\u0000") !== now.components.join("\u0000") || was.fixVersions.join("\u0000") !== now.fixVersions.join("\u0000")) {
    parts.push("thành phần / phiên bản");
    restorable = false;
  }
  if ((was.wbsParentId ?? null) !== (now.wbsParentId ?? null)) {
    parts.push(`cha: ${now.wbsParentId ?? "không"}`);
    restorable = false;
  }
  if (was.description !== now.description && now.description !== undefined) {
    restorable = false;
  }

  // Successors the cascade moved along with it.
  const beforeById = new Map(before.map((t) => [t.id, t]));
  const moved = after.filter((t) => t.id !== key && beforeById.has(t.id) && beforeById.get(t.id)!.startDate !== t.startDate).length;
  if (moved > 0) parts.push(`${moved} việc dời theo`);

  const textLine = parts.length > 0 ? `${key}: ${parts.join(" · ")}` : `Đã cập nhật ${key}`;
  return { key, text: textLine, ...(restorable && Object.keys(patch).length > 0 ? { undo: { patch } } : {}) };
}
