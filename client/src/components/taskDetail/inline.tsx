import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { describeBlocks, linkPieces } from "../../descriptionView";
import Spinner from "../Spinner";

/**
 * The task panel's way of editing: a value is text first. It looks like the rest of the page, shows a
 * soft background when the pointer is over it, and becomes a field only once it is pressed — the same
 * place, the same size. Leaving it (Tab, a click elsewhere, Enter) saves; Esc puts the old value back.
 * Nothing here talks to Jira: each editor hands its finished value to `onCommit` and the panel saves it.
 */

/* ---------------------------------------------------------------- the title */

/** The title is always a text area (one line of Jira text that wraps), drawn as a heading. */
export function InlineTitle({ value, onCommit }: { value: string; onCommit: (next: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const cancelled = useRef(false);
  const text = draft ?? value;

  // It wraps onto as many lines as it needs instead of being cut at the box's edge.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    // scrollHeight leaves the border out, and the box is border-box.
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [text]);

  function finish() {
    const next = (draft ?? value).trim();
    const skip = cancelled.current;
    cancelled.current = false;
    setDraft(null);
    // An emptied title is not a title: the old one stays.
    if (!skip && next && next !== value) onCommit(next);
  }

  return (
    <textarea
      ref={ref}
      className="td-title"
      rows={1}
      spellCheck={false}
      value={text}
      aria-label="Tên việc"
      placeholder="Tên việc"
      onChange={(e) => setDraft(e.target.value.replace(/\s*[\r\n]+\s*/g, " "))}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape" && draft !== null) {
          // Puts the old title back; the panel stays.
          e.stopPropagation();
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/* ------------------------------------------------------------- the description */

function Linked({ text }: { text: string }) {
  return (
    <>
      {linkPieces(text).map((p, i) =>
        typeof p === "string" ? (
          <Fragment key={i}>{p}</Fragment>
        ) : (
          <a key={i} href={p.url} target="_blank" rel="noreferrer">
            {p.url}
          </a>
        )
      )}
    </>
  );
}

/** The text as a page: paragraphs, lists, links that open. React elements only, never innerHTML. */
export function DescriptionText({ text }: { text: string }) {
  return (
    <>
      {describeBlocks(text).map((b, i) =>
        b.kind === "p" ? (
          <p key={i}>
            {b.lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                <Linked text={l} />
              </Fragment>
            ))}
          </p>
        ) : b.kind === "ul" ? (
          <ul key={i}>
            {b.items.map((it, j) => (
              <li key={j}>
                <Linked text={it} />
              </li>
            ))}
          </ul>
        ) : (
          <ol key={i}>
            {b.items.map((it, j) => (
              <li key={j}>
                <Linked text={it} />
              </li>
            ))}
          </ol>
        )
      )}
    </>
  );
}

/**
 * Read as a page; pressed, it becomes a text area in the same place. Saves on leaving the box or Ctrl+Enter,
 * Esc (or the Huỷ button) throws the edit away. `value` undefined = not read yet, null = no description.
 */
export function InlineDescription({
  value,
  error,
  onRetry,
  onCommit,
}: {
  value: string | null | undefined;
  error?: string | null;
  onRetry?: () => void;
  onCommit: (next: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const areaRef = useRef<HTMLTextAreaElement>(null);
  // Leaving the box ends the edit once, whichever of blur, a button or a key got there first.
  const done = useRef(true);

  useEffect(() => {
    if (!editing) return;
    const el = areaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  function begin() {
    done.current = false;
    setDraft(value ?? "");
    setEditing(true);
  }

  function finish(save: boolean) {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    const next = draft.trim();
    if (save && next !== (value ?? "").trim()) onCommit(next === "" ? null : next);
  }

  if (value === undefined) {
    return error ? (
      <p className="tdx-empty">
        Không tải được mô tả.{" "}
        <button type="button" className="text-btn" onClick={onRetry}>
          Thử lại
        </button>
      </p>
    ) : (
      <Spinner block className="spinner-inline" />
    );
  }

  if (!editing) {
    return (
      <div
        className="tdx-desc"
        role="button"
        tabIndex={0}
        aria-label="Mô tả. Bấm để sửa"
        data-empty={value ? undefined : ""}
        onClick={(e) => {
          // A link in the text opens; anything else starts the edit.
          if ((e.target as HTMLElement).closest("a")) return;
          begin();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            begin();
          }
        }}
      >
        {value ? <DescriptionText text={value} /> : <span className="tdx-empty">Thêm mô tả…</span>}
      </div>
    );
  }

  return (
    <div className="tdx-desc-edit">
      <textarea
        ref={areaRef}
        spellCheck={false}
        value={draft}
        aria-label="Mô tả"
        placeholder="Thêm mô tả…"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            finish(false);
          } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.stopPropagation();
            finish(true);
          }
        }}
      />
      {/* mousedown is kept off the buttons so the text area keeps focus: a blur first would save before "Huỷ" got its click. */}
      <div className="tdx-desc-actions">
        <button type="button" className="primary" onMouseDown={(e) => e.preventDefault()} onClick={() => finish(true)}>
          Lưu
          <kbd>Ctrl ⏎</kbd>
        </button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => finish(false)}>
          Huỷ
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------- one value, in place */

/**
 * A short value that is text until pressed, then `editor` in its place. `editor` gets `done`, which it calls
 * to end the edit (the editor saves itself first). Focus leaving the editor ends it too, and Esc.
 */
export function Editable({
  display,
  editor,
  className = "",
  label,
  disabled,
}: {
  display: ReactNode;
  editor: (done: () => void) => ReactNode;
  className?: string;
  label: string;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!editing) return;
    const el = wrap.current?.querySelector<HTMLElement>("input:not([type=date]):not([hidden]), textarea, select");
    el?.focus();
    if (el instanceof HTMLInputElement && el.type === "text") el.select();
  }, [editing]);

  if (!editing) {
    return (
      <button type="button" className={`tdx-val ${className}`} aria-label={label} disabled={disabled} onClick={() => setEditing(true)}>
        {display}
      </button>
    );
  }
  return (
    <span
      ref={wrap}
      className={`tdx-editing ${className}`}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          // Out of the edit only; the panel stays.
          e.stopPropagation();
          setEditing(false);
        }
      }}
    >
      {editor(() => setEditing(false))}
    </span>
  );
}

/* --------------------------------------------------------------- small pieces */

/** A label and its value on one row. `data-prop` names it for tests and for nothing else. */
export function Prop({ name, label, children, className = "" }: { name: string; label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`tdx-prop ${className}`} data-prop={name}>
      <span className="tdx-label">{label}</span>
      <div className="tdx-value">{children}</div>
    </div>
  );
}

/** "Đang lưu…" while a save is out, "Đã lưu" for two seconds after, nothing otherwise. */
export function SaveBadge({ saving, savedAt }: { saving: boolean; savedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!savedAt) return;
    setNow(Date.now());
    const h = window.setTimeout(() => setNow(Date.now()), 2100);
    return () => window.clearTimeout(h);
  }, [savedAt]);
  const recent = savedAt > 0 && now - savedAt < 2000;
  return (
    <span className={`tdx-save${saving ? " is-saving" : recent ? " is-saved" : ""}`} role="status" aria-live="polite">
      {saving ? "Đang lưu…" : recent ? "Đã lưu" : ""}
    </span>
  );
}
