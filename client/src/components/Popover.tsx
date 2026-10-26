import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "./Icons";

interface Props {
  /** Trigger content: an icon and/or text. */
  label: ReactNode;
  /** Names the trigger when `label` is only an icon; leave unset when the label is text. */
  ariaLabel?: string;
  /** Names the panel itself (a dialog needs a name of its own). */
  menuLabel: string;
  title?: string;
  /** Classes for the trigger button — the caller decides how it looks. */
  className?: string;
  /** Extra classes for the panel. */
  menuClassName?: string;
  align?: "start" | "end";
  /** "top" opens upward — for a trigger at the bottom of the window (the selection bar). */
  placement?: "bottom" | "top";
  /** "menu" is a list of actions (arrow keys move between `role="menuitem"`s); "dialog" holds
   * controls such as checkboxes and inputs and is walked with Tab. */
  role?: "menu" | "dialog";
  caret?: boolean;
  /** A cue that something behind the popover is switched on. */
  active?: boolean;
  disabled?: boolean;
  /** Controlled use (a chip elsewhere opens this panel); omit for the usual self-managed one. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode | ((api: { close: () => void }) => ReactNode);
}

/**
 * A trigger button and the panel it opens, closed by a click outside, Escape, or
 * Tab leaving it. Escape is handled here, on the React tree, and stops there: the
 * workspace listens for Escape on `window` to clear the Gantt selection, and closing
 * a menu must not also wipe a multi-select.
 */
export default function Popover({
  label,
  ariaLabel,
  menuLabel,
  title,
  className = "",
  menuClassName = "",
  align = "start",
  placement = "bottom",
  role = "dialog",
  caret = true,
  active,
  disabled,
  open: openProp,
  onOpenChange,
  children,
}: Props) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const focusFirst = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);

  function setOpen(next: boolean) {
    setOpenState(next);
    onOpenChange?.(next);
  }
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpenState(false);
        onOpenChange?.(false);
      }
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open, onOpenChange]);

  // A panel anchored near a window edge (the filter panel when the toolbar has wrapped) is
  // slid back inside it, rather than cut off. Measured after paint, before the browser draws.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!open || !el) return;
    el.style.transform = "";
    const r = el.getBoundingClientRect();
    const margin = 8;
    const over = r.right - (window.innerWidth - margin);
    const under = margin - r.left;
    if (over > 0) el.style.transform = `translateX(${-Math.min(over, Math.max(0, r.left - margin))}px)`;
    else if (under > 0) el.style.transform = `translateX(${under}px)`;
  }, [open]);

  // Opened from the keyboard: land on the first item instead of leaving focus on the trigger.
  useEffect(() => {
    if (!open || !focusFirst.current) return;
    focusFirst.current = false;
    rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [open]);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (role !== "menu") return;
    if (!open) {
      if (e.key === "ArrowDown" && e.target === triggerRef.current) {
        e.preventDefault();
        focusFirst.current = true;
        setOpen(true);
      }
      return;
    }
    const items = [...(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === "ArrowDown") next = at < 0 ? 0 : (at + 1) % items.length;
    else if (e.key === "ArrowUp") next = at <= 0 ? items.length - 1 : at - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next >= 0) {
      e.preventDefault();
      items[next].focus();
    }
  }

  // Only when focus moves to another element: a click on plain text inside the panel
  // also blurs (to nothing), and that must not close it.
  function onBlur(e: FocusEvent) {
    const to = e.relatedTarget as Node | null;
    if (open && to && rootRef.current && !rootRef.current.contains(to)) setOpen(false);
  }

  return (
    <div className="popover" ref={rootRef} onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        ref={triggerRef}
        type="button"
        className={`${className}${open ? " is-open" : ""}${active ? " is-on" : ""}`}
        aria-haspopup={role}
        aria-expanded={open}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        {label}
        {caret && <Icon name="chevronDown" size={12} className="caret" />}
      </button>
      {open && (
        <div ref={menuRef} className={`popover-menu popover-${align}${placement === "top" ? " popover-up" : ""} ${menuClassName}`} role={role} aria-label={menuLabel}>
          {typeof children === "function" ? children({ close }) : children}
        </div>
      )}
    </div>
  );
}
