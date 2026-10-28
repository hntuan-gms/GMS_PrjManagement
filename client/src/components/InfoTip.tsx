import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "./Icons";

interface Props {
  /** Names the icon button for screen readers. */
  label: string;
  /** "warn" swaps the icon and tints it: the note says something the reader should not miss. */
  tone?: "warn";
  children: ReactNode;
}

/**
 * An ⓘ that explains the thing next to it. Hover or focus shows it; a click keeps it open so the
 * text can be read and selected.
 *
 * The panel is `position: fixed`, not absolute: this sits inside a sticky header cell of a scroll
 * container, and an absolutely placed panel would be clipped by that container (or grow its
 * scroll area) instead of floating over the page. Because it is fixed, it closes on any scroll
 * rather than trailing behind its anchor.
 */
export default function InfoTip({ label, tone, children }: Props) {
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const leaveTimer = useRef<number | undefined>(undefined);
  const id = useId();
  const open = pinned || hover;

  useLayoutEffect(() => {
    const btn = btnRef.current;
    if (!open || !btn) return;
    const r = btn.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 16);
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), top: r.bottom + 4 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setPinned(false);
        setHover(false);
      }
    }
    function onScroll() {
      setPinned(false);
      setHover(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);

  function enter() {
    window.clearTimeout(leaveTimer.current);
    setHover(true);
  }
  // A short grace period, so the pointer can cross the gap onto the panel itself.
  function leave() {
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => setHover(false), 120);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== "Escape" || !open) return;
    // Handled on the React tree and stopped here, like Popover: the workspace clears the
    // Gantt selection on a window-level Escape, and closing a tip must not do that too.
    e.stopPropagation();
    setPinned(false);
    setHover(false);
    btnRef.current?.focus();
  }

  return (
    <span className="infotip" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        ref={btnRef}
        type="button"
        className={`infotip-btn${tone === "warn" ? " is-warn" : ""}${open ? " is-open" : ""}`}
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setPinned((v) => !v);
        }}
        onMouseEnter={enter}
        onMouseLeave={leave}
        onFocus={enter}
        onBlur={leave}
      >
        <Icon name={tone === "warn" ? "alert" : "info"} size={13} />
      </button>
      {open && pos && (
        <div
          id={id}
          role="tooltip"
          className="infotip-panel"
          style={{ left: pos.left, top: pos.top }}
          onMouseEnter={enter}
          onMouseLeave={leave}
        >
          {children}
        </div>
      )}
    </span>
  );
}
