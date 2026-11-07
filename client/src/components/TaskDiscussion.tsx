import { useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import { TASK_MAX_AGE_MS } from "../detailCache";
import { readers } from "../taskDetailReads";
import { useDetail } from "../useDetail";
import Skeleton from "./Skeleton";
import { fromTokens, labelFor, toTokens, type Mentions } from "../mentions";
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
}

/* ---------------------------------------------------------------- helpers */

/** `@[Name](accountId)` — the mention token the server speaks — or a bare URL. */
const TOKEN = /@\[([^\]]+)\]\(([^)\s]+)\)|\bhttps?:\/\/[^\s<>"')\]]+/g;

const clean = (name: string) => name.replace(/[[\]()]/g, "");
const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/g, "d").toLowerCase();

/** Comment text with mentions highlighted and links clickable — React elements, never innerHTML: the text is anyone's. */
function renderText(text: string, myAccountId: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    if (m[2]) {
      out.push(
        <span key={n++} className={`td-mention ${m[2] === myAccountId ? "is-me" : ""}`}>
          @{m[1]}
        </span>
      );
    } else {
      const url = m[0].replace(/[).,;:!?]+$/, "");
      out.push(
        <a key={n++} href={url} target="_blank" rel="noreferrer">
          {url}
        </a>
      );
      const rest = m[0].slice(url.length);
      if (rest) out.push(rest);
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

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

function CommentBox({
  members,
  initialText = "",
  submitLabel,
  autoFocus,
  onSubmit,
  onCancel,
}: {
  members: JiraUser[];
  initialText?: string;
  submitLabel: string;
  autoFocus?: boolean;
  onSubmit: (tokenText: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const [seeded] = useState(() => fromTokens(initialText));
  const [text, setText] = useState(seeded.display);
  const [mentions, setMentions] = useState<Mentions>(seeded.mentions);
  const [suggest, setSuggest] = useState<{ query: string; start: number } | null>(null);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One line until it is used: a three-line box in front of every comment pushed the discussion off screen.
  const [focused, setFocused] = useState(!!autoFocus);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const open = focused || text.trim() !== "" || !!onCancel;

  const candidates = suggest
    ? members.filter((m) => fold(m.displayName).includes(fold(suggest.query))).slice(0, 6)
    : [];

  function onChange(value: string, caret: number) {
    setText(value);
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(value.slice(0, caret));
    setSuggest(m ? { query: m[2], start: caret - m[2].length - 1 } : null);
    setActive(0);
  }

  function pick(user: JiraUser) {
    if (!suggest) return;
    const caret = areaRef.current?.selectionStart ?? text.length;
    const name = clean(user.displayName);
    const label = labelFor(mentions, name, user.accountId);
    const next = `${text.slice(0, suggest.start)}@${label} ${text.slice(caret)}`;
    setText(next);
    setMentions((prev) => new Map(prev).set(label, { accountId: user.accountId, name }));
    setSuggest(null);
    const pos = suggest.start + label.length + 2;
    requestAnimationFrame(() => {
      areaRef.current?.focus();
      areaRef.current?.setSelectionRange(pos, pos);
    });
  }

  async function submit() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(toTokens(text.trim(), mentions));
      setText("");
      setMentions(new Map());
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
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <textarea
        ref={areaRef}
        rows={open ? 3 : 1}
        spellCheck={false}
        autoFocus={autoFocus}
        value={text}
        placeholder="Viết bình luận…"
        aria-label="Bình luận mới"
        onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
        onKeyDown={(e) => {
          if (suggest && candidates.length > 0) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a + (e.key === "ArrowDown" ? 1 : candidates.length - 1)) % candidates.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              pick(candidates[active]);
              return;
            }
            if (e.key === "Escape") {
              // Closes the list only — not the modal underneath.
              e.stopPropagation();
              setSuggest(null);
              return;
            }
          }
          if (e.key === "Escape") {
            // Neither leaving an edit nor a stray Esc over a draft may also close
            // the task modal underneath and throw the typing away.
            if (onCancel) {
              e.stopPropagation();
              onCancel();
              return;
            }
            if (text.trim()) {
              e.stopPropagation();
              return;
            }
          }
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
        }}
      />
      {suggest && candidates.length > 0 && (
        <ul className="td-suggest" role="listbox">
          {candidates.map((u, i) => (
            <li key={u.accountId} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={i === active ? "is-active" : ""}
                // mousedown, not click: the textarea would blur first and drop the list.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(u);
                }}
              >
                {u.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <div className="td-error">{error}</div>}
      <div className="td-box-actions" hidden={!open}>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy}>
            Huỷ
          </button>
        )}
        {/* Tonal, not solid: the one solid button in the window is "Lưu & đồng bộ Jira" below it. */}
        <button type="button" className="primary tonal" onClick={submit} disabled={busy || !text.trim()}>
          {busy ? "Đang gửi..." : submitLabel}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ the section */

export default function TaskDiscussion({ taskId, members, myAccountId }: Props) {
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
          {!comments && !commentsError && <Skeleton lines={2} />}
          {comments && comments.length === 0 && <div className="td-muted">Chưa có bình luận nào.</div>}
          <CommentBox members={members} submitLabel="Gửi bình luận" onSubmit={add} />
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
                    members={members}
                    initialText={c.text}
                    submitLabel="Lưu"
                    autoFocus
                    onSubmit={(t) => save(c.id, t)}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <div className="td-ctext">{renderText(c.text, myAccountId)}</div>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          {activityError && <div className="td-error">{activityError}</div>}
          {!activity && !activityError && <Skeleton lines={3} />}
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
