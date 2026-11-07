import { isDroppedStatus } from "./droppedStatus";
import type { Task } from "./types";

/**
 * Jira only has three status categories, but workflows have far more states than that: "Blocked",
 * "In Review", "On Hold", "Ready for Dev"… all of them "In Progress" or "To Do" to Jira. The glyph tells
 * them apart by the workflow's own name (diacritics folded, whole words), and falls back to the
 * category when the name says nothing. The category still decides what a name may mean: a closed
 * status is only ever done or dropped, "backlog" and "ready" only describe work not yet started.
 */
export type StatusKind =
  | "backlog"
  | "todo"
  | "ready"
  | "doing"
  | "review"
  | "hold"
  | "blocked"
  | "reopened"
  | "failed"
  | "notrun"
  | "done"
  | "dropped";

/**
 * Test-result workflows (Passed / Failed / Not Run / Pending / Blocked) file every result under the
 * done category, so the category alone draws a green tick on a failure. These are the kinds a closed
 * status may still take on from its name; "Reviewed and closed" stays a plain done.
 */
const CLOSED_MAY_BE: ReadonlySet<StatusKind> = new Set(["failed", "notrun", "blocked", "hold"]);

const FAILED = /\b(fail\w*|that bai|khong dat)\b/;
const NOTRUN = /\b(not run|not executed|unexecuted|untested|not tested|skipped?|chua chay|chua test|chua thuc hien)\b/;
const REOPENED = /\b(re ?open\w*|mo lai|lam lai|rework|redo)\b/;
const BLOCKED = /\b(block\w*|impediment\w*|stuck|bi chan|vuong|chan)\b/;
const REVIEW = /\b(review\w*|testing|test|qa|uat|verif\w*|kiem thu|kiem tra|danh gia|duyet|nghiem thu|xac nhan)\b/;
const HOLD = /\b(on hold|hold|pending|waiting|wait|paused?|suspend\w*|cho|tam dung|tam hoan)\b/;
const READY = /\b(ready\w*|san sang|approved|da duyet|selected for development)\b/;
const BACKLOG = /\b(backlog|icebox|triage|ton dong)\b/;

function fold(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[-_/]+/g, " ");
}

export function statusKind(category: Task["statusCategory"], name?: string): StatusKind {
  if (category === "done" && isDroppedStatus(name)) return "dropped";
  const n = name ? fold(name) : "";
  let kind: StatusKind | null = null;
  if (n) {
    if (FAILED.test(n)) kind = "failed";
    else if (NOTRUN.test(n)) kind = "notrun";
    else if (REOPENED.test(n)) kind = "reopened";
    else if (BLOCKED.test(n)) kind = "blocked";
    else if (REVIEW.test(n)) kind = "review";
    else if (HOLD.test(n)) kind = "hold";
    else if (category === "new" && READY.test(n)) kind = "ready";
    else if (category === "new" && BACKLOG.test(n)) kind = "backlog";
  }
  if (category === "done") return kind && CLOSED_MAY_BE.has(kind) ? kind : "done";
  return kind ?? (category === "indeterminate" ? "doing" : "todo");
}

export const STATUS_KIND_LABEL: Record<StatusKind, string> = {
  backlog: "Tồn đọng",
  todo: "Chưa làm",
  ready: "Sẵn sàng",
  doing: "Đang làm",
  review: "Chờ duyệt / kiểm thử",
  hold: "Tạm dừng",
  blocked: "Bị chặn",
  reopened: "Mở lại",
  failed: "Không đạt",
  notrun: "Chưa chạy",
  done: "Xong",
  dropped: "Đã huỷ",
};
