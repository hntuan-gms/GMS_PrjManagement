import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { addDays, diffDays } from "../resourceAllocation";
import { dateAtFraction, formatDate, resizeWindow, slideWindow, type DateWindow } from "../resourceTimeline";

interface Props {
  /** The whole stretch of time the track stands for (resourceTimeline.scrubExtent). */
  extent: DateWindow;
  /** The window on screen: what the thumb is. */
  span: DateWindow;
  today: string;
  onChange: (next: DateWindow) => void;
}

type Edge = "move" | "from" | "to";

/** The first of each month inside the extent, as shares of the track. */
function monthTicks(extent: DateWindow, total: number): Array<{ at: number; month: number }> {
  const out: Array<{ at: number; month: number }> = [];
  let y = Number(extent.from.slice(0, 4));
  let m = Number(extent.from.slice(5, 7));
  for (let guard = 0; guard < 400; guard++) {
    const iso = `${y}-${String(m).padStart(2, "0")}-01`;
    if (iso > extent.to) break;
    if (iso >= extent.from) out.push({ at: (diffDays(extent.from, iso) / total) * 100, month: m });
    if (++m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * A slider for the heatmap's window, in place of typing Từ/Đến: the track is the whole project (and a
 * little either side), the thumb is what the table shows now. Drag the thumb to slide through time,
 * drag an end to widen or narrow it, click the track to jump there; arrow keys move it a week. The
 * heatmap recomputes as it moves — the load is computed in the browser, so there is no round trip to wait on.
 *
 * Exact dates are still one click away, in the "Khoảng" menu.
 */
export default function ResourceScrubber({ extent, span, today, onChange }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const grab = useRef<{ edge: Edge; x: number; span: DateWindow } | null>(null);
  const latest = useRef<DateWindow>(span);
  const frame = useRef<number | undefined>(undefined);
  const [active, setActive] = useState<Edge | null>(null);

  const total = Math.max(1, diffDays(extent.from, extent.to));
  const length = diffDays(span.from, span.to);
  const left = (diffDays(extent.from, span.from) / total) * 100;
  const width = ((length + 1) / total) * 100;
  const ticks = useMemo(() => monthTicks(extent, total), [extent, total]);
  const todayAt = today >= extent.from && today <= extent.to ? (diffDays(extent.from, today) / total) * 100 : null;
  const text = `${formatDate(span.from)} – ${formatDate(span.to)}`;

  // One update per frame while dragging: each one recomputes everybody's load for the window.
  function emit(next: DateWindow) {
    if (next.from === latest.current.from && next.to === latest.current.to) return;
    latest.current = next;
    if (frame.current !== undefined) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined;
      onChange(latest.current);
    });
  }

  function onThumbDown(e: PointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    e.preventDefault();
    const edge = ((e.target as HTMLElement).dataset.edge as Edge | undefined) ?? "move";
    latest.current = span;
    grab.current = { edge, x: e.clientX, span };
    (e.target as Element).setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    setActive(edge);
  }

  function onThumbMove(e: PointerEvent<HTMLDivElement>) {
    const g = grab.current;
    const track = trackRef.current;
    if (!g || !track) return;
    const days = Math.round(((e.clientX - g.x) / track.getBoundingClientRect().width) * total);
    if (g.edge === "move") emit(slideWindow(g.span, days, extent));
    else if (g.edge === "from") emit(resizeWindow(g.span, "from", addDays(g.span.from, days), extent));
    else emit(resizeWindow(g.span, "to", addDays(g.span.to, days), extent));
  }

  function onThumbUp() {
    if (!grab.current) return;
    grab.current = null;
    setActive(null);
  }

  function onTrackDown(e: PointerEvent<HTMLDivElement>) {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const at = dateAtFraction(extent, (e.clientX - rect.left) / rect.width);
    const from = addDays(at, -Math.floor(length / 2));
    latest.current = slideWindow({ from, to: addDays(from, length) }, 0, extent);
    onChange(latest.current);
  }

  function onKeyDown(e: KeyboardEvent) {
    const step = e.shiftKey || e.key === "PageUp" || e.key === "PageDown" ? 30 : 7;
    let next: DateWindow | null = null;
    if (e.key === "ArrowLeft" || e.key === "PageUp") next = slideWindow(span, -step, extent);
    else if (e.key === "ArrowRight" || e.key === "PageDown") next = slideWindow(span, step, extent);
    else if (e.key === "Home") next = slideWindow(span, -total, extent);
    else if (e.key === "End") next = slideWindow(span, total, extent);
    if (!next) return;
    e.preventDefault();
    latest.current = next;
    onChange(next);
  }

  return (
    <div className="rv-scrub" role="group" aria-label="Trượt khoảng thời gian" data-from={span.from} data-to={span.to}>
      <div ref={trackRef} className={`rv-scrub-track${active ? " is-dragging" : ""}`} onPointerDown={onTrackDown}>
        {ticks.map((t) => (
          <span key={t.at} className="rv-scrub-tick" style={{ left: `${t.at}%` }}>
            {ticks.length <= 12 && <i>T{t.month}</i>}
          </span>
        ))}
        {todayAt !== null && <span className="rv-scrub-today" style={{ left: `${todayAt}%` }} title="Hôm nay" />}
        <div
          className="rv-scrub-thumb"
          role="slider"
          tabIndex={0}
          aria-label="Khoảng đang xem"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={diffDays(extent.from, span.from)}
          aria-valuetext={text}
          title={`${text} — kéo để trượt, kéo hai đầu để đổi độ dài`}
          style={{ left: `${left}%`, width: `${width}%` }}
          onPointerDown={onThumbDown}
          onPointerMove={onThumbMove}
          onPointerUp={onThumbUp}
          onPointerCancel={onThumbUp}
          onKeyDown={onKeyDown}
        >
          <span className="rv-scrub-edge is-from" data-edge="from" />
          <span className="rv-scrub-label">{text}</span>
          <span className="rv-scrub-edge is-to" data-edge="to" />
        </div>
      </div>
    </div>
  );
}
