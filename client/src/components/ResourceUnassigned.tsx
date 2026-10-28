import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { filterUnassigned } from "../resourceColumns";
import type { Task } from "../types";
import { Icon } from "./Icons";

/**
 * The dragged task, held in React state rather than read back out of the
 * DataTransfer: `getData` is write-only during dragover in Chrome and Safari,
 * and the drop targets need to know what is coming to decide whether to light
 * up at all (dropping a task on the person who already holds it is a no-op).
 */
export interface DragState {
  taskId: string;
  summary: string;
  fromAccountId: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** The KPI button that opens this; the panel first appears just under it. */
  anchorRef: RefObject<HTMLElement | null>;
  tasks: Task[];
  members: Array<{ accountId: string; displayName: string }>;
  drag: DragState | null;
  /** True when dropping the dragged task on "nobody" would change something. */
  canDropUnassigned: boolean;
  /** The strip is the one place to drop a task to take it off someone. */
  isDropTarget: boolean;
  onDragStartTask: (task: Task) => void;
  onAssign: (taskId: string, accountId: string | null) => void;
  onOpenEdit: (task: Task) => void;
  onDragOverZone: () => void;
  onDragLeaveZone: () => void;
  onDropZone: () => void;
  /** Id of the panel, for the opener's aria-controls. */
  panelId: string;
}

const MARGIN = 8;

function clamp(p: { x: number; y: number }, w: number, h: number): { x: number; y: number } {
  return {
    x: Math.max(MARGIN, Math.min(p.x, window.innerWidth - w - MARGIN)),
    y: Math.max(MARGIN, Math.min(p.y, window.innerHeight - h - MARGIN)),
  };
}

/**
 * Work nobody owns, as a small card floating over the heatmap instead of a box in the page
 * flow: the list can be 40 rows long, and a static one pushed the people table off screen.
 *
 * It is a tool palette, not a dialog — non-modal, no backdrop, not closed by clicking elsewhere,
 * because the point is to keep it open while dragging from it onto the rows beneath. For the
 * same reason it goes translucent and stops catching the pointer while anything is dragged (and
 * while the card itself is being moved): otherwise it hides the very rows and dates the task is
 * being dropped on.
 *
 * Taking a task *off* someone is a separate strip at the bottom of the window, shown only while
 * such a drag is under way. It used to be this panel; but a panel that is both "covering the
 * rows" and "a drop target" turns a drop meant for a person into an unassign.
 */
export default function ResourceUnassigned({
  open,
  onClose,
  anchorRef,
  tasks,
  members,
  drag,
  canDropUnassigned,
  isDropTarget,
  onDragStartTask,
  onAssign,
  onOpenEdit,
  onDragOverZone,
  onDragLeaveZone,
  onDropZone,
  panelId,
}: Props) {
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [moving, setMoving] = useState(false);
  // Set a tick after a drag starts: restyling the card in the dragstart handler itself would
  // put the faded look into the browser's drag image.
  const [ghostFor, setGhostFor] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const grab = useRef<{ dx: number; dy: number } | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!drag) return;
    const t = window.setTimeout(() => setGhostFor(drag.taskId), 0);
    return () => {
      window.clearTimeout(t);
      setGhostFor(null);
    };
  }, [drag]);
  const ghost = drag !== null && ghostFor === drag.taskId;

  // Placed (or kept inside the window) before the browser paints, so it never flashes at 0,0.
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!open || !el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setPos((cur) => {
      if (cur) return clamp(cur, w, h);
      const a = anchorRef.current?.getBoundingClientRect();
      return clamp({ x: a ? a.left : window.innerWidth - w - 24, y: a ? a.bottom + 6 : 120 }, w, h);
    });
  }, [open, anchorRef]);

  const shown = useMemo(() => filterUnassigned(tasks, query), [tasks, query]);

  function onGripDown(e: PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("button") || !pos) return;
    grab.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
    setMoving(true);
  }
  function onGripMove(e: PointerEvent<HTMLDivElement>) {
    const g = grab.current;
    const el = panelRef.current;
    if (!g || !el) return;
    setPos(clamp({ x: e.clientX - g.dx, y: e.clientY - g.dy }, el.offsetWidth, el.offsetHeight));
  }
  function onGripUp() {
    if (!grab.current) return;
    grab.current = null;
    setMoving(false);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    // Stopped here: the workspace clears the Gantt selection on a window-level Escape.
    e.stopPropagation();
    onClose();
    anchorRef.current?.focus();
  }

  const classes = [
    "rv-unassigned",
    moving || ghost ? "is-ghost" : "",
    // Same tick as the fade, for the same reason: not while the browser is taking the drag image.
    ghost ? "is-passthrough" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      {open && (
        <div
          id={panelId}
          ref={panelRef}
          className={classes}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          style={pos ? { left: pos.x, top: pos.y } : { visibility: "hidden" }}
          onKeyDown={onKeyDown}
        >
          <div
            className="rv-un-head"
            onPointerDown={onGripDown}
            onPointerMove={onGripMove}
            onPointerUp={onGripUp}
            onPointerCancel={onGripUp}
            onLostPointerCapture={onGripUp}
          >
            <Icon name="grip" size={14} className="rv-un-grip" />
            <strong id={titleId}>{tasks.length} công việc chưa gán</strong>
            <button type="button" className="icon-btn rv-un-close" onClick={onClose} aria-label="Đóng danh sách chưa gán" title="Đóng">
              <Icon name="x" size={14} />
            </button>
          </div>
          <input
            type="search"
            className="rv-un-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Lọc theo mã hoặc tên…"
            aria-label="Lọc công việc chưa gán"
          />
          {shown.length === 0 ? (
            <div className="rv-un-empty">
              {tasks.length === 0 ? "Mọi công việc đã có người phụ trách." : "Không có công việc nào khớp."}
            </div>
          ) : (
            <ul className="rv-un-list">
              {shown.map((t) => (
                <li key={t.id} className="rv-un-row">
                  <button
                    type="button"
                    className="rv-un-main"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", t.id);
                      onDragStartTask(t);
                    }}
                    onClick={() => onOpenEdit(t)}
                    title={`${t.id} · ${t.summary}\nKéo thả lên một thành viên để gán`}
                  >
                    <span className="rv-un-key">{t.id}</span>
                    <span className="rv-un-summary">{t.summary}</span>
                  </button>
                  {/* Drag-and-drop is the fast path; this is the one that works
                      from a keyboard or a touch screen. */}
                  <select
                    className="rv-assign-select"
                    value=""
                    onChange={(e) => e.target.value && onAssign(t.id, e.target.value)}
                    aria-label={`Gán ${t.id} cho`}
                  >
                    <option value="">Gán…</option>
                    {members.map((p) => (
                      <option key={p.accountId} value={p.accountId}>
                        {p.displayName}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {drag && canDropUnassigned && (
        <div
          className={`rv-un-strip ${isDropTarget ? "is-drop-target" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            onDragOverZone();
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onDragLeaveZone();
          }}
          onDrop={(e) => {
            e.preventDefault();
            onDropZone();
          }}
        >
          Thả vào đây để bỏ gán “{drag.summary}”
        </div>
      )}
    </>
  );
}
