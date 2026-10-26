import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DialogContext, type Dialogs, type Pending } from "./dialogContext";

/**
 * The app's own confirmation and question dialogs, in place of window.confirm/prompt: those
 * draw the browser's window — its font, its buttons, the page address in the title — and cannot
 * be styled, so every "Xoá?" looked like it came from somewhere else.
 *
 *   const dialogs = useDialogs();
 *   if (!(await dialogs.confirm({ message: "Xoá …?", tone: "danger", confirmLabel: "Xoá" }))) return;
 *   const name = await dialogs.prompt({ title: "Đổi tên", initial: f.name });   // null = cancelled
 *
 * Each call resolves when the person answers; asking again while one is open queues behind it.
 * Esc and a click outside cancel, Enter confirms, Tab stays inside, and focus goes back to
 * where it was.
 */
export function DialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Pending[]>([]);

  const dialogs = useMemo<Dialogs>(
    () => ({
      confirm: (o) => new Promise<boolean>((resolve) => setQueue((q) => [...q, { kind: "confirm", resolve, ...o }])),
      prompt: (o) => new Promise<string | null>((resolve) => setQueue((q) => [...q, { kind: "prompt", resolve, ...o }])),
    }),
    []
  );

  const current = queue[0];
  const done = useCallback(() => setQueue((q) => q.slice(1)), []);

  return (
    <DialogContext.Provider value={dialogs}>
      {children}
      {current && <DialogView key={queue.length + current.kind} pending={current} onDone={done} />}
    </DialogContext.Provider>
  );
}

function DialogView({ pending, onDone }: { pending: Pending; onDone: () => void }) {
  const [text, setText] = useState(pending.kind === "prompt" ? (pending.initial ?? "") : "");
  const panelRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const danger = pending.kind === "confirm" && pending.tone === "danger";

  const answer = useCallback(
    (ok: boolean) => {
      if (pending.kind === "confirm") pending.resolve(ok);
      else pending.resolve(ok ? text.trim() : null);
      onDone();
    },
    [pending, text, onDone]
  );

  // Focus lands on the answer a stray Enter should give: Cancel for something destructive.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    if (pending.kind === "prompt") {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (danger) cancelRef.current?.focus();
    else confirmRef.current?.focus();
    return () => before?.focus?.();
  }, [pending.kind, danger]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      answer(false);
    } else if (e.key === "Tab") {
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input");
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  const title = pending.kind === "prompt" ? pending.title : (pending.title ?? (danger ? "Xác nhận xoá" : "Xác nhận"));
  const confirmLabel = pending.confirmLabel ?? (pending.kind === "prompt" ? "Lưu" : danger ? "Xoá" : "Đồng ý");
  const cannotSubmit = pending.kind === "prompt" && !text.trim();

  return (
    <div className="dlg-overlay" onMouseDown={(e) => e.target === e.currentTarget && answer(false)} onKeyDown={onKeyDown}>
      <div
        ref={panelRef}
        className="dlg"
        role={danger ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby="dlg-title"
        aria-describedby={pending.message ? "dlg-body" : undefined}
      >
        <h2 id="dlg-title" className="dlg-title">
          {title}
        </h2>
        {pending.message && (
          <div id="dlg-body" className="dlg-body">
            {pending.message}
          </div>
        )}
        {pending.kind === "prompt" && (
          <label className="dlg-field">
            {pending.label ?? title}
            <input
              ref={inputRef}
              value={text}
              placeholder={pending.placeholder}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !cannotSubmit) {
                  e.preventDefault();
                  answer(true);
                }
              }}
            />
          </label>
        )}
        <div className="dlg-actions">
          <button ref={cancelRef} type="button" onClick={() => answer(false)}>
            {pending.kind === "confirm" ? (pending.cancelLabel ?? "Huỷ") : "Huỷ"}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={danger ? "danger-solid" : "primary"}
            disabled={cannotSubmit}
            onClick={() => answer(true)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
