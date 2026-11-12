/**
 * Many schedule writes in one request: what the browser sends when the page is closing.
 *
 * The plan is drawn from the browser's own state and written to Jira behind the screen (a save takes seconds,
 * a drag can queue several). Closing or reloading the tab used to drop whatever was still waiting. On the way
 * out the browser now sends what is left as ONE request that outlives the page (`keepalive`), and the server
 * applies it in order, through the same `updateTask` a single PATCH uses, so the cascade, the Epic rule and
 * the permission checks all still apply. Every value is an absolute one (a date, a duration, a percentage), so
 * a write that already went through, or a batch that arrives twice, changes nothing.
 *
 * Pure validation here (no Express, no Jira), so the rules can be tested: only these three fields are accepted,
 * only on this project's own issues, and only a bounded number.
 */
import type { TaskUpdateInput } from "./types.js";

export const MAX_BATCH_OPS = 100;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface BatchOp {
  id: string;
  patch: Pick<TaskUpdateInput, "startDate" | "durationDays" | "percentComplete">;
}

export type BatchParse = { ok: true; ops: BatchOp[] } | { ok: false; error: string };

export function parseScheduleBatch(body: unknown, projectKey: string): BatchParse {
  const ops = (body as { ops?: unknown } | null)?.ops;
  if (!Array.isArray(ops) || ops.length === 0) return { ok: false, error: "Danh sách thay đổi trống." };
  if (ops.length > MAX_BATCH_OPS) return { ok: false, error: `Tối đa ${MAX_BATCH_OPS} thay đổi mỗi lần.` };
  const out: BatchOp[] = [];
  const prefix = `${projectKey}-`;
  for (const raw of ops) {
    const op = raw as { id?: unknown; patch?: Record<string, unknown> } | null;
    const id = op?.id;
    if (typeof id !== "string" || !id.startsWith(prefix) || !/^[A-Z][A-Z0-9_]*-\d+$/.test(id)) {
      return { ok: false, error: `Mã việc không thuộc dự án ${projectKey}.` };
    }
    const p = op?.patch;
    if (!p || typeof p !== "object") return { ok: false, error: `Thiếu nội dung thay đổi cho ${id}.` };
    const patch: BatchOp["patch"] = {};
    for (const k of Object.keys(p)) {
      if (k !== "startDate" && k !== "durationDays" && k !== "percentComplete") {
        return { ok: false, error: `Trường "${k}" không được gửi theo lô.` };
      }
    }
    if ("startDate" in p) {
      const v = p.startDate;
      if (v !== null && (typeof v !== "string" || !ISO_DATE.test(v))) return { ok: false, error: `Ngày bắt đầu của ${id} không hợp lệ.` };
      patch.startDate = v as string | null;
    }
    if ("durationDays" in p) {
      const v = p.durationDays;
      if (typeof v !== "number" || !Number.isFinite(v) || v < 1 || v > 3650) return { ok: false, error: `Số ngày của ${id} không hợp lệ.` };
      patch.durationDays = v;
    }
    if ("percentComplete" in p) {
      const v = p.percentComplete;
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100) return { ok: false, error: `% của ${id} không hợp lệ.` };
      patch.percentComplete = v;
    }
    if (Object.keys(patch).length === 0) return { ok: false, error: `Thay đổi của ${id} không có trường nào.` };
    out.push({ id, patch });
  }
  return { ok: true, ops: out };
}
