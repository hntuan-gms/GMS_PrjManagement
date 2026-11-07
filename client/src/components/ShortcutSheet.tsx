import { useEffect, useRef } from "react";
import { useLayer } from "../useLayer";
import { SHORTCUTS, type Shortcut } from "../shortcuts";
import { Icon } from "./Icons";

/** "?" — every shortcut, grouped, from the same list the command bar and tooltips read. */
export default function ShortcutSheet({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayer("shortcuts", true, { onEscape: onClose });
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => prev?.focus?.();
  }, []);
  const groups = new Map<Shortcut["group"], Shortcut[]>();
  for (const s of SHORTCUTS) groups.set(s.group, [...(groups.get(s.group) ?? []), s]);
  return (
    <div className="cmdk-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="shortcut-sheet"
        role="dialog"
        aria-label="Phím tắt"
        tabIndex={-1}
        ref={ref}
        onKeyDown={(e) => {
          if (e.key === "Escape" || e.key === "?") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <header>
          <h2>Phím tắt</h2>
          <span className="muted">Không chạy khi đang gõ trong ô nhập.</span>
          <button type="button" className="icon-btn" aria-label="Đóng" onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>
        <div className="shortcut-grid">
          {[...groups].map(([group, list]) => (
            <section key={group}>
              <h3>{group}</h3>
              <dl>
                {list.map((s) => (
                  <div key={s.id} className="shortcut-row">
                    <dt>{s.label}</dt>
                    <dd>
                      {s.keys.split(/\s{2,}| /).map((k, i) => (
                        <kbd key={i}>{k}</kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
