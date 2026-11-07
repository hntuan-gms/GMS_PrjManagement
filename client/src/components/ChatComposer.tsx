import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { filterPeople, insertMentions, mentionQueryAt, nextMarks } from "../chatCompose";
import { ACCEPT, formatSize, mimeOf } from "../chatAttachments";
import type { Mentions } from "../mentions";
import type { JiraUser, Task } from "../types";
import Avatar from "./Avatar";
import { TaskChip } from "./ChatParts";
import { Icon } from "./Icons";

interface Props {
  users: readonly JiraUser[];
  meId: string;
  tasks: ReadonlyMap<string, Task>;
  /** Keys dragged (or attached) into this message. */
  attached: readonly string[];
  onRemoveTask: (key: string) => void;
  onOpenIssue?: (key: string) => void;
  files: readonly File[];
  attachError: string | null;
  onRemoveFile: (index: number) => void;
  onPickFiles: (files: File[]) => void;
  busy: boolean;
  onStop: () => void;
  /** Text as typed plus which labels stand for which account; the composer empties itself. */
  onSubmit: (text: string, mentions: Mentions) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  /** The question asked last, brought back by ArrowUp in an empty box. */
  lastQuestion: string | null;
  /** What is selected in the app right now; the strip offers to attach it. */
  selectedKeys: readonly string[];
  onAttachSelected: () => void;
}

/**
 * The box a message is written in: text, chips for the work dragged in, files, and the "@" menu.
 *
 * The "@" menu lists the project's people. Enter or Tab takes the highlighted one; Ctrl/Cmd+click toggles
 * several, Shift+click (or Shift+arrow) extends a range, and Enter then writes them all at once as
 * "@A @B ". Typing narrows the list, ignoring accents; Esc closes only the menu.
 */
export default function ChatComposer(p: Props) {
  const [input, setInput] = useState("");
  const [mentions, setMentions] = useState<Mentions>(new Map());
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [marks, setMarks] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const { textareaRef } = p;

  const q = mentionQueryAt(input, caret);
  const matches = q ? filterPeople(p.users, q.query, p.meId) : [];
  const menuOpen = !!q && matches.length > 0 && closedAt !== q.start;
  const order = matches.map((u) => u.accountId);

  // A new word to match starts at the top of the list with nothing marked.
  useEffect(() => {
    setActive(0);
    setMarks([]);
    setAnchor(null);
  }, [q?.start, q?.query]);

  useEffect(() => {
    if (!menuOpen) return;
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, menuOpen]);

  // The box grows with what is typed (up to ~6 lines) instead of cutting a long line in half.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [input, textareaRef]);

  function commit(people: JiraUser[]) {
    if (!q || people.length === 0) return;
    const r = insertMentions(input, q, caret, people, mentions);
    setInput(r.text);
    setMentions(r.mentions);
    setCaret(r.caret);
    setMarks([]);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      el?.focus();
      el?.setSelectionRange(r.caret, r.caret);
    });
  }

  /** What Enter writes: everyone marked, in list order, or else the highlighted person. */
  const chosen = (): JiraUser[] => (marks.length > 0 ? matches.filter((u) => marks.includes(u.accountId)) : matches[active] ? [matches[active]] : []);

  function clickPerson(e: React.MouseEvent, u: JiraUser, i: number) {
    const mod = { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey };
    if (mod.toggle || mod.range) {
      // The highlighted row is only a cursor: Ctrl marks nothing but what is clicked, Shift measures from the anchor (or the cursor).
      setMarks(nextMarks(marks, order, u.accountId, mod, anchor ?? matches[active]?.accountId ?? null));
      if (!mod.range) setAnchor(u.accountId);
      setActive(i);
      return;
    }
    commit([...matches.filter((m) => marks.includes(m.accountId) && m.accountId !== u.accountId), u].sort((a, b) => order.indexOf(a.accountId) - order.indexOf(b.accountId)));
  }

  function submit() {
    const text = input.trim();
    if (p.busy || (!text && p.files.length === 0)) return;
    p.onSubmit(text, mentions);
    setInput("");
    setMentions(new Map());
    setCaret(0);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return;
    if (menuOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = (active + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
        if (e.shiftKey) {
          const from = anchor ?? matches[active].accountId;
          setAnchor(from);
          setMarks(nextMarks(marks, order, matches[next].accountId, { toggle: false, range: true }, from));
        }
        setActive(next);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        commit(chosen());
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setClosedAt(q!.start);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === "ArrowUp" && input === "" && p.lastQuestion) {
      e.preventDefault();
      setInput(p.lastQuestion);
    }
  }

  const unattached = p.selectedKeys.filter((k) => !p.attached.includes(k));
  const hasTray = p.attached.length > 0 || p.files.length > 0;
  const canSend = !!input.trim() || p.files.length > 0;

  return (
    <div className="chat-composer-wrap">
      {unattached.length > 0 && (
        <div className="chat-selected-strip">
          <span>
            Đang chọn <b>{p.selectedKeys.length}</b> việc
          </span>
          <button type="button" onClick={p.onAttachSelected}>
            Đính kèm
          </button>
        </div>
      )}
      <div className="chat-composer">
        {menuOpen && (
          <div className="chat-mention-menu" role="listbox" aria-label="Gọi người" aria-multiselectable="true" onMouseDown={(e) => e.preventDefault()}>
            <ul ref={listRef}>
              {matches.map((u, i) => {
                const marked = marks.includes(u.accountId);
                return (
                  <li key={u.accountId} data-i={i}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={marked || (marks.length === 0 && i === active)}
                      className={`chat-mention-row${i === active ? " is-active" : ""}${marked ? " is-marked" : ""}`}
                      onClick={(e) => clickPerson(e, u, i)}
                      onMouseEnter={() => setActive(i)}
                    >
                      {marks.length > 0 && <span className={`chat-mention-check${marked ? " is-on" : ""}`}>{marked && <Icon name="check" size={11} />}</span>}
                      <Avatar name={u.displayName} avatarUrl={u.avatarUrl} className="chat-mention-avatar" decorative />
                      <span className="chat-mention-name">{u.displayName}</span>
                      {u.accountId === p.meId && <span className="chat-mention-me">tôi</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="chat-mention-foot">
              {marks.length > 0 ? (
                <button type="button" className="chat-mention-insert" onClick={() => commit(chosen())}>
                  Chèn {marks.length} người
                </button>
              ) : (
                <span>Ctrl hoặc Shift + bấm để chọn nhiều</span>
              )}
            </div>
          </div>
        )}

        {hasTray && (
          <div className="chat-tray">
            {p.attached.map((k) => (
              <TaskChip key={k} id={k} task={p.tasks.get(k)} onOpen={p.onOpenIssue} onRemove={() => p.onRemoveTask(k)} />
            ))}
            {p.files.map((f, i) => (
              <span key={`${f.name}-${i}`} className="chat-chip" title={`${mimeOf(f)} · ${formatSize(f.size)}`}>
                <span className="chat-chip-main">
                  <Icon name="paperclip" size={12} />
                  <span className="chat-chip-title">{f.name}</span>
                  <small>{formatSize(f.size)}</small>
                </span>
                <button type="button" className="chat-chip-x" onClick={() => p.onRemoveFile(i)} aria-label={`Bỏ ${f.name}`}>
                  <Icon name="x" size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        {p.attachError && <div className="chat-error chat-error-inline">{p.attachError}</div>}

        <textarea
          ref={textareaRef}
          rows={1}
          value={input}
          placeholder="Hỏi trợ lý · kéo việc vào đây · @ gọi người"
          aria-label="Tin nhắn cho trợ lý"
          onChange={(e) => {
            setInput(e.target.value);
            setCaret(e.target.selectionStart);
            setClosedAt(null);
          }}
          onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            // A pasted screenshot arrives as a file on the clipboard; pasted text is left alone.
            const pasted = [...e.clipboardData.files];
            if (pasted.length > 0) {
              e.preventDefault();
              p.onPickFiles(pasted);
            }
          }}
        />
        <div className="chat-composer-bar">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            accept={ACCEPT}
            onChange={(e) => {
              p.onPickFiles([...(e.target.files ?? [])]);
              // Without this, picking the same file again after removing it does nothing.
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="chat-icon-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={p.busy}
            title="Đính kèm ảnh, PDF hoặc văn bản (tối đa 4 tệp, 5 MB mỗi tệp). Tệp chỉ dùng cho tin nhắn này và không được lưu."
            aria-label="Đính kèm tệp"
          >
            <Icon name="paperclip" size={16} />
          </button>
          <span className="chat-composer-fill" />
          {p.busy ? (
            <button type="button" className="chat-send is-stop" onClick={p.onStop} title="Dừng" aria-label="Dừng">
              <Icon name="stop" size={14} />
            </button>
          ) : (
            <button type="button" className="chat-send" onClick={submit} disabled={!canSend} title="Gửi (Enter)" aria-label="Gửi">
              <Icon name="send" size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
