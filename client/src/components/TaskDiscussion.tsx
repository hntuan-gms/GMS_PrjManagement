import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import type { ActivityEntry, JiraUser, TaskComment } from "../types";

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
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

/** Tokens → the `@Name` a person types, remembering who each name stands for. */
function fromTokens(text: string): { display: string; mentions: Map<string, string> } {
  const mentions = new Map<string, string>();
  const display = text.replace(/@\[([^\]]+)\]\(([^)\s]+)\)/g, (_all, name: string, id: string) => {
    mentions.set(name, id);
    return `@${name}`;
  });
  return { display, mentions };
}

/** `@Name` → `@[Name](accountId)` for every person picked from the list and still present. */
function toTokens(text: string, mentions: Map<string, string>): string {
  let out = text;
  // Longest names first, so "@Anh Tuấn" is not eaten by "@Anh".
  for (const [name, id] of [...mentions].sort((a, b) => b[0].length - a[0].length)) {
    out = out.replace(new RegExp(`@${escapeRe(name)}(?=$|[\\s.,;:!?)])`, "g"), `@[${name}](${id})`);
  }
  return out;
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}

const FIELD_VI: Record<string, string> = {
  status: "Trạng thái",
  assignee: "Người phụ trách",
  summary: "Tiêu đề",
  description: "Mô tả",
  priority: "Độ ưu tiên",
  duedate: "Hạn",
  "start date": "Ngày bắt đầu",
  labels: "Nhãn",
  timeoriginalestimate: "Ước lượng",
  timeestimate: "Ước lượng còn lại",
  timespent: "Đã ghi",
  sprint: "Sprint",
  link: "Liên kết",
  attachment: "Đính kèm",
  parent: "Công việc cha",
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
  const [mentions, setMentions] = useState<Map<string, string>>(seeded.mentions);
  const [suggest, setSuggest] = useState<{ query: string; start: number } | null>(null);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

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
    const next = `${text.slice(0, suggest.start)}@${name} ${text.slice(caret)}`;
    setText(next);
    setMentions((prev) => new Map(prev).set(name, user.accountId));
    setSuggest(null);
    const pos = suggest.start + name.length + 2;
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
    <div className="td-box">
      <textarea
        ref={areaRef}
        rows={3}
        autoFocus={autoFocus}
        value={text}
        placeholder="Viết bình luận… gõ @ để nhắc tên một người (Ctrl+Enter để gửi)"
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
      <div className="td-box-actions">
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy}>
            Huỷ
          </button>
        )}
        <button type="button" className="primary" onClick={submit} disabled={busy || !text.trim()}>
          {busy ? "Đang gửi..." : submitLabel}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ the section */

export default function TaskDiscussion({ taskId, members, myAccountId }: Props) {
  const [tab, setTab] = useState<"comments" | "activity">("comments");
  const [comments, setComments] = useState<TaskComment[] | null>(null);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[] | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .listComments(taskId)
      .then((c) => alive && setComments(c))
      .catch((e) => alive && setCommentsError(e instanceof Error ? e.message : "Không tải được bình luận."));
    return () => {
      alive = false;
    };
  }, [taskId]);

  // The history is a longer read (paged), so it waits until someone opens the tab.
  useEffect(() => {
    if (tab !== "activity" || activity || activityError) return;
    let alive = true;
    api
      .listActivity(taskId)
      .then((a) => alive && setActivity(a))
      .catch((e) => alive && setActivityError(e instanceof Error ? e.message : "Không tải được lịch sử."));
    return () => {
      alive = false;
    };
  }, [tab, taskId, activity, activityError]);

  async function add(text: string) {
    const created = await api.addComment(taskId, text);
    setComments((prev) => [created, ...(prev ?? [])]);
    // The comment is part of the history in Jira only for field changes, so no refetch is needed.
  }

  async function save(id: string, text: string) {
    const updated = await api.updateComment(taskId, id, text);
    setComments((prev) => (prev ?? []).map((c) => (c.id === id ? updated : c)));
    setEditing(null);
  }

  async function remove(id: string) {
    setActionError(null);
    try {
      await api.deleteComment(taskId, id);
      setComments((prev) => (prev ?? []).filter((c) => c.id !== id));
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
          Bình luận{comments ? ` (${comments.length})` : ""}
        </button>
        <button role="tab" aria-selected={tab === "activity"} className={tab === "activity" ? "active" : ""} onClick={() => setTab("activity")}>
          Lịch sử thay đổi
        </button>
      </div>

      {tab === "comments" ? (
        <>
          <CommentBox members={members} submitLabel="Gửi bình luận" onSubmit={add} />
          {commentsError && <div className="td-error">{commentsError}</div>}
          {actionError && <div className="td-error">{actionError}</div>}
          {!comments && !commentsError && <div className="td-muted">Đang tải bình luận…</div>}
          {comments && comments.length === 0 && <div className="td-muted">Chưa có bình luận nào.</div>}
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
                  <div className="td-body">{renderText(c.text, myAccountId)}</div>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          {activityError && <div className="td-error">{activityError}</div>}
          {!activity && !activityError && <div className="td-muted">Đang tải lịch sử…</div>}
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
