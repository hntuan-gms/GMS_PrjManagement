import { useEffect, useRef, useState } from "react";
import { dismissToast, useToasts, type Toast } from "../toast";
import { Icon } from "./Icons";

function ToastItem({ t, depth }: { t: Toast; depth: number }) {
  const [hover, setHover] = useState(false);
  const left = useRef(t.ms);
  const startedAt = useRef(0);

  // The clock stops while the pointer is on the toast: reading "Hoàn tác" and reaching for it
  // must not race a timer.
  useEffect(() => {
    if (t.sticky || hover) return;
    startedAt.current = Date.now();
    const id = window.setTimeout(() => dismissToast(t.id), left.current);
    return () => {
      window.clearTimeout(id);
      left.current = Math.max(800, left.current - (Date.now() - startedAt.current));
    };
  }, [t.id, t.sticky, hover]);

  return (
    <div
      className={`toast toast-${t.tone}`}
      role={t.tone === "error" ? "alert" : "status"}
      style={{ "--toast-depth": depth } as React.CSSProperties}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {t.tone === "error" && <Icon name="alert" size={15} />}
      {t.tone === "success" && <Icon name="check" size={15} />}
      <span className="toast-msg">{t.message}</span>
      {t.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            t.action!.run();
            dismissToast(t.id);
          }}
        >
          {t.action.label}
          {t.action.hint && <kbd>{t.action.hint}</kbd>}
        </button>
      )}
      <button type="button" className="toast-close" aria-label="Đóng thông báo" onClick={() => dismissToast(t.id)}>
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

export default function Toaster() {
  const list = useToasts();
  return (
    <div className="toaster" aria-live="polite">
      {list.map((t, i) => (
        <ToastItem key={t.id} t={t} depth={list.length - 1 - i} />
      ))}
    </div>
  );
}
