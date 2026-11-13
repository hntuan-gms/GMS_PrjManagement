import { useState } from "react";
import { api } from "../api";
import { TASK_MAX_AGE_MS } from "../detailCache";
import { readers } from "../taskDetailReads";
import { useDetail } from "../useDetail";
import RichText from "./RichText";
import { hasUploading } from "../richDoc";
import RichEditor from "./RichEditorLazy";
import Spinner from "./Spinner";
import type { JiraUser } from "../types";

/**
 * The conversation and history of one task — the two things the schedule fields
 * don't carry. Both are Jira's own (see server/src/taskActivity.ts): a comment
 * written here is a comment in Jira, and an @mention is a real Jira mention, so
 * Jira sends the notification.
 */

interface Props {
  taskId: string;
  members: JiraUser[];
  /** The signed-in account, so a mention of you can be marked. */
  myAccountId: string;
  /** A picture pasted into a comment became an attachment of the issue. */
  onAttachmentsChanged?: () => void;
}

/* ---------------------------------------------------------------- helpers */


function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}

const FIELD_VI: Record<string, string> = {
  status: "Trạng thái",
  assignee: "Người",
  summary: "Tiêu đề",
  description: "Mô tả",
  priority: "Ưu tiên",
  duedate: "Hạn",
  "start date": "Ngày bắt đầu",
  labels: "Nhãn",
  timeoriginalestimate: "Ước lượng",
  timeestimate: "Ước lượng còn lại",
  timespent: "Đã ghi",
  sprint: "Sprint",
  link: "Liên kết",
  attachment: "Đính kèm",
  parent: "Việc cha",
  "epic link": "Epic",
  resolution: "Kết quả",
  issuetype: "Loại",
  reporter: "Người báo cáo",
  flagged: "Cờ",
  component: "Thành phần",
  "fix version": "Phiên bản",
};
const fieldName = (f: string) => FIELD_VI[f.toLowerCase()] ?? f;

/* -------------------------------------------------------------- the box   */

/** Whether a mouse button or finger is down right now (see the box's blur). */
let pointerHeld = false;
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", () => (pointerHeld = true), true);
  window.addEventListener("pointerup", () => (pointerHeld = false), true);
  window.addEventListener("pointercancel", () => (pointerHeld = false), true);
}

function CommentBox({
  taskId,
  members,
  onUploaded,
  initialText = "",
  submitLabel,
  autoFocus,
  onSubmit,
  onCancel,
}: {
  taskId: string;
  members: JiraUser[];
  onUploaded?: () => void;
  initialText?: string;
  submitLabel: string;
  autoFocus?: boolean;
  onSubmit: (tokenText: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One line until it is used: a tall box in front of every comment pushed the discussion off screen.
  const [focused, setFocused] = useState(!!autoFocus);
  const [uploading, setUploading] = useState(false);
  // A new box after each send: the editor starts from its `value` and owns its text from then on.
  const [round, setRound] = useState(0);
  const open = focused || text.trim() !== "" || !!onCancel || uploading;
  const waiting = uploading || hasUploading(text);

  async function submit() {
    if (!text.trim() || busy || waiting) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(text.trim());
      setText("");
      setRound((r) => r + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không gửi được bình luận.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`td-box${open ? "" : " is-collapsed"}`}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        // The picture picker taking the window is not leaving the box.
        if (!document.hasFocus()) return;
        // Folding the box moves everything under it up. Pressed with the mouse, wait for the release:
        // otherwise the button that took the focus ("Sửa" on a comment) slides away before its click.
        if (pointerHeld) window.addEventListener("pointerup", () => setTimeout(() => setFocused(false)), { once: true });
        else setFocused(false);
      }}
    >
      <RichEditor
        key={round}
        value={round === 0 ? initialText : ""}
        onChange={setText}
        taskId={taskId}
        members={members}
        placeholder="Viết bình luận… (dán ảnh, @ để nhắc tên)"
        ariaLabel={onCancel ? "Sửa bình luận" : "Bình luận mới"}
        autoFocus={autoFocus || round > 0}
        bare={!open}
        onSubmit={() => void submit()}
        onEscape={() => {
          // Neither leaving an edit nor a stray Esc over a draft may also close the task underneath.
          if (onCancel) {
            onCancel();
            return true;
          }
          return text.trim() !== "";
        }}
        onUploaded={onUploaded}
        onUploadingChange={setUploading}
      />
      {error && <div className="td-error">{error}</div>}
      <div className="td-box-actions" hidden={!open}>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy}>
            Huỷ
          </button>
        )}
        {/* Tonal, not solid: the one solid button in the window is "Lưu & đồng bộ Jira" below it. */}
        <button type="button" className="primary tonal" onClick={submit} disabled={busy || waiting || !text.trim()}>
          {busy ? "Đang gửi..." : waiting ? "Đang tải ảnh…" : submitLabel}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ the section */

export default function TaskDiscussion({ taskId, members, myAccountId, onAttachmentsChanged }: Props) {
  const [tab, setTab] = useState<"comments" | "activity">("comments");
  // Both are read through detailCache: reopening a task shows what it showed last time at once, and the
  // read behind it replaces that. The history is a longer read (paged), so it waits for its tab.
  const commentsRead = useDetail("comments", taskId, () => readers.comments(taskId), TASK_MAX_AGE_MS);
  const activityRead = useDetail("activity", taskId, () => api.listActivity(taskId), TASK_MAX_AGE_MS, tab === "activity");
  const comments = commentsRead.value ?? null;
  const commentsError = commentsRead.value ? null : commentsRead.error;
  const activity = activityRead.value ?? null;
  const activityError = activityRead.value ? null : activityRead.error;
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function add(text: string) {
    const created = await api.addComment(taskId, text);
    commentsRead.set([created, ...(commentsRead.value ?? [])]);
    // The comment is part of the history in Jira only for field changes, so no refetch is needed.
  }

  async function save(id: string, text: string) {
    const updated = await api.updateComment(taskId, id, text);
    commentsRead.set((commentsRead.value ?? []).map((c) => (c.id === id ? updated : c)));
    setEditing(null);
  }

  async function remove(id: string) {
    setActionError(null);
    try {
      await api.deleteComment(taskId, id);
      commentsRead.set((commentsRead.value ?? []).filter((c) => c.id !== id));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Không xoá được bình luận.");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="field td">
      <div className="td-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "comments"} className={tab === "comments" ? "active" : ""} onClick={() => setTab("comments")}>
          Bình luận{comments && comments.length > 0 ? ` (${comments.length})` : ""}
        </button>
        <button role="tab" aria-selected={tab === "activity"} className={tab === "activity" ? "active" : ""} onClick={() => setTab("activity")}>
          Lịch sử thay đổi
        </button>
      </div>

      {tab === "comments" ? (
        <>
          {commentsError && <div className="td-error">{commentsError}</div>}
          {actionError && <div className="td-error">{actionError}</div>}
          {!comments && !commentsError && <Spinner block className="spinner-inline" />}
          {comments && comments.length === 0 && <div className="td-muted">Chưa có bình luận nào.</div>}
          <CommentBox
            taskId={taskId}
            members={members}
            onUploaded={onAttachmentsChanged}
            submitLabel="Gửi bình luận"
            onSubmit={add}
          />
          <ul className="td-list">
            {(comments ?? []).map((c) => (
              <li key={c.id} className="td-comment">
                <div className="td-head">
                  <b>{c.authorName}</b>
                  <span className="td-muted">{when(c.created)}</span>
                  {c.updated !== c.created && <span className="td-muted">(đã sửa)</span>}
                  {c.mine && editing !== c.id && (
                    <span className="td-tools">
                      <button type="button" className="text-btn" onClick={() => setEditing(c.id)}>
                        Sửa
                      </button>
                      {deleting === c.id ? (
                        <>
                          <span className="td-muted">Xoá?</span>
                          <button type="button" className="text-btn td-danger" onClick={() => remove(c.id)}>
                            Xoá
                          </button>
                          <button type="button" className="text-btn" onClick={() => setDeleting(null)}>
                            Không
                          </button>
                        </>
                      ) : (
                        <button type="button" className="text-btn" onClick={() => setDeleting(c.id)}>
                          Xoá
                        </button>
                      )}
                    </span>
                  )}
                </div>
                {editing === c.id ? (
                  <CommentBox
                    taskId={taskId}
                    members={members}
                    onUploaded={onAttachmentsChanged}
                    initialText={c.text}
                    submitLabel="Lưu"
                    autoFocus
                    onSubmit={(t) => save(c.id, t)}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <RichText className="td-ctext" text={c.text} taskId={taskId} myAccountId={myAccountId} />
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          {activityError && <div className="td-error">{activityError}</div>}
          {!activity && !activityError && <Spinner block className="spinner-inline" />}
          {activity && activity.length === 0 && <div className="td-muted">Chưa có thay đổi nào được ghi lại.</div>}
          <ul className="td-list">
            {(activity ?? []).map((a) => (
              <li key={a.id} className="td-activity">
                <div className="td-head">
                  <b>{a.authorName}</b>
                  <span className="td-muted">{when(a.created)}</span>
                </div>
                <ul className="td-changes">
                  {a.changes.map((ch, i) => (
                    <li key={i}>
                      <span className="td-field">{fieldName(ch.field)}</span>: <span className="td-from">{ch.from ?? "trống"}</span>
                      {" → "}
                      <span className="td-to">{ch.to ?? "trống"}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
