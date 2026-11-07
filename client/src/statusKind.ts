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
  | "done"
  | "dropped";

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
  if (category === "done") return isDroppedStatus(name) ? "dropped" : "done";
  const n = name ? fold(name) : "";
  if (n) {
    if (REOPENED.test(n)) return "reopened";
    if (BLOCKED.test(n)) return "blocked";
    if (REVIEW.test(n)) return "review";
    if (HOLD.test(n)) return "hold";
    if (category === "new") {
      if (READY.test(n)) return "ready";
      if (BACKLOG.test(n)) return "backlog";
    }
  }
  return category === "indeterminate" ? "doing" : "todo";
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
  done: "Xong",
  dropped: "Đã huỷ",
};
