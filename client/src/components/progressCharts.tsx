import { useState, type CSSProperties } from "react";
import type { ProgressMetrics } from "../types";

/**
 * The report page's charts. Plain SVG/CSS, no chart library — each one is a
 * single shape and a library would be most of the bundle for four donuts.
 *
 * One encoding across the page, so nothing has to be re-learned between charts:
 * - **Work state is an ordinal blue ramp** — done `#2a78d6`, in progress
 *   `#86b6ef`, not started a neutral gray. Stages are ordered, so one hue light→
 *   dark (never three unrelated hues), and "done" is the same blue as "actual"
 *   on the gauge and the trend line: done work IS the actual progress.
 * - **Status colours** (good/warning/serious/critical) appear only where
 *   something is judged, always with an icon and a label.
 * - Text is always in text ink; a coloured mark beside it carries identity.
 */

export type WorkState = "done" | "inProgress" | "todo";

const STATE_LABEL: Record<WorkState, string> = {
  done: "Xong",
  inProgress: "Đang làm",
  todo: "Chưa làm",
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/* -------------------------------------------------------------------------- */
/* Gauge: actual % as the arc, planned % as a tick on the same ring.          */
/* -------------------------------------------------------------------------- */

export function ProgressGauge({ actual, planned }: { actual: number; planned: number }) {
  const size = 168;
  const r = 66;
  const stroke = 14;
  const c = 2 * Math.PI * r;
  const clamp = (v: number) => Math.min(100, Math.max(0, v));
  const dash = (clamp(actual) / 100) * c;
  // Planned tick, measured clockwise from 12 o'clock like the arc.
  const angle = (clamp(planned) / 100) * 2 * Math.PI - Math.PI / 2;
  const inner = r - stroke / 2 - 4;
  const outer = r + stroke / 2 + 4;
  const cx = size / 2;
  const gap = round1(planned - actual);

  return (
    <div className="pr-gauge">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`Hoàn thành ${actual}%, kế hoạch ${planned}%`}
      >
        <circle className="pr-gauge-track" cx={cx} cy={cx} r={r} strokeWidth={stroke} />
        <circle
          className="pr-gauge-arc"
          cx={cx}
          cy={cx}
          r={r}
          strokeWidth={stroke}
          strokeDasharray={`${dash} ${c}`}
          transform={`rotate(-90 ${cx} ${cx})`}
          style={{ "--pr-circ": `${c}px` } as CSSProperties}
        />
        <line
          className="pr-gauge-plan"
          x1={cx + inner * Math.cos(angle)}
          y1={cx + inner * Math.sin(angle)}
          x2={cx + outer * Math.cos(angle)}
          y2={cx + outer * Math.sin(angle)}
        >
          <title>Kế hoạch {planned}%</title>
        </line>
        <text className="pr-gauge-value" x={cx} y={cx + 4} textAnchor="middle">
          {actual}%
        </text>
        <text className="pr-gauge-caption" x={cx} y={cx + 24} textAnchor="middle">
          hoàn thành
        </text>
      </svg>
      <div className="pr-gauge-legend">
        <span>
          <i className="pr-swatch pr-swatch-done" /> Thực tế <b>{actual}%</b>
        </span>
        <span>
          <i className="pr-swatch pr-swatch-plan" /> Kế hoạch <b>{planned}%</b>
        </span>
      </div>
      {gap > 5 ? (
        <span className={`pr-pill ${gap > 15 ? "pr-pill-crit" : "pr-pill-warn"}`}>
          <span aria-hidden="true">▼</span> Chậm {gap} điểm
        </span>
      ) : gap < -5 ? (
        <span className="pr-pill pr-pill-good">
          <span aria-hidden="true">▲</span> Vượt {round1(-gap)} điểm
        </span>
      ) : (
        <span className="pr-pill pr-pill-good">
          <span aria-hidden="true">✓</span> Bám sát kế hoạch
        </span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Donut: how many work items are in each state.                              */
/* -------------------------------------------------------------------------- */

export function StatusDonut({
  counts,
  onSelect,
}: {
  counts: Record<WorkState, number>;
  onSelect: (state: WorkState) => void;
}) {
  const [hover, setHover] = useState<WorkState | null>(null);
  const size = 150;
  const r = 56;
  const stroke = 18;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  const order: WorkState[] = ["done", "inProgress", "todo"];
  const total = order.reduce((s, k) => s + counts[k], 0);
  // 2px surface gap between segments, subtracted from each segment's length.
  const gapLen = total > 0 && order.filter((k) => counts[k] > 0).length > 1 ? 2 : 0;

  let offset = 0;
  const segments = order.map((k) => {
    const len = total > 0 ? (counts[k] / total) * c : 0;
    const seg = { k, len: Math.max(0, len - gapLen), offset };
    offset += len;
    return seg;
  });

  const focus = hover ?? null;
  const centerValue = focus ? counts[focus] : total;
  const centerLabel = focus
    ? `${STATE_LABEL[focus].toLowerCase()} · ${total > 0 ? Math.round((counts[focus] / total) * 100) : 0}%`
    : "công việc";

  return (
    <div className="pr-donut">
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={order.map((k) => `${STATE_LABEL[k]} ${counts[k]}`).join(", ")}>
        <circle className="pr-donut-bg" cx={cx} cy={cx} r={r} strokeWidth={stroke} />
        {segments.map(
          (s) =>
            s.len > 0 && (
              <circle
                key={s.k}
                className={`pr-donut-seg pr-state-${s.k} ${focus && focus !== s.k ? "is-dim" : ""} ${focus === s.k ? "is-focus" : ""}`}
                cx={cx}
                cy={cx}
                r={r}
                strokeWidth={stroke}
                strokeDasharray={`${s.len} ${c - s.len}`}
                strokeDashoffset={-s.offset}
                transform={`rotate(-90 ${cx} ${cx})`}
                onPointerEnter={() => setHover(s.k)}
                onPointerLeave={() => setHover(null)}
                onClick={() => onSelect(s.k)}
              />
            )
        )}
        <text className="pr-donut-value" x={cx} y={cx + 4} textAnchor="middle">
          {centerValue}
        </text>
        <text className="pr-donut-caption" x={cx} y={cx + 21} textAnchor="middle">
          {centerLabel}
        </text>
      </svg>
      <div className="pr-donut-legend">
        {order.map((k) => (
          <button
            key={k}
            className={`pr-legend-btn ${focus === k ? "is-focus" : ""}`}
            onPointerEnter={() => setHover(k)}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(k)}
            onBlur={() => setHover(null)}
            onClick={() => onSelect(k)}
          >
            <i className={`pr-swatch pr-state-bg-${k}`} />
            <span>{STATE_LABEL[k]}</span>
            <b>{counts[k]}</b>
          </button>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Schedule: start → today → forecast end, with the slip past baseline.       */
/* -------------------------------------------------------------------------- */

function toUtc(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

function short(iso: string | null): string {
  return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—";
}

export function ScheduleTimeline({ schedule, asOf }: { schedule: ProgressMetrics["schedule"]; asOf: string }) {
  const { start, plannedEnd, baselineEnd, slipDays, daysRemaining } = schedule;
  if (!start || !plannedEnd) {
    return <p className="pr-muted">Chưa có công việc nào được lên lịch.</p>;
  }
  const late = slipDays !== null && slipDays > 0;
  const endMax = [plannedEnd, baselineEnd ?? plannedEnd, asOf].sort().at(-1)!;
  const t0 = toUtc(start);
  const span = Math.max(1, toUtc(endMax) - t0);
  const pos = (iso: string) => `${Math.min(100, Math.max(0, ((toUtc(iso) - t0) / span) * 100))}%`;

  const baseline = baselineEnd ?? plannedEnd;
  const planEnd = pos(plannedEnd);
  const baseEnd = pos(baseline);

  return (
    <div className="pr-timeline">
      <div className="pr-timeline-head">
        <span className={`pr-timeline-big ${late ? "pr-bad" : ""}`}>
          {late ? `Trễ ${slipDays} ngày` : daysRemaining !== null ? `Còn ${daysRemaining} ngày` : "—"}
        </span>
        <span className="pr-muted">
          {late ? `so với baseline ${short(baselineEnd)}` : `tới ${short(plannedEnd)} · đúng baseline`}
        </span>
      </div>
      <div className="pr-timeline-track" role="img" aria-label={`Bắt đầu ${short(start)}, hôm nay ${short(asOf)}, dự kiến kết thúc ${short(plannedEnd)}, baseline ${short(baseline)}`}>
        {/* The committed window, then the forecast window over it. */}
        <div className="pr-timeline-plan" style={{ width: late ? baseEnd : planEnd }} />
        {late && <div className="pr-timeline-slip" style={{ left: baseEnd, width: `calc(${planEnd} - ${baseEnd})` }} />}
        <div className="pr-timeline-elapsed" style={{ width: pos(asOf) }} />
        <div className="pr-timeline-today" style={{ left: pos(asOf) }}>
          <span>Hôm nay</span>
        </div>
      </div>
      <div className="pr-timeline-axis">
        <span>{short(start)}</span>
        {late && (
          <span className="pr-timeline-mark" style={{ left: baseEnd }}>
            baseline {short(baseline)}
          </span>
        )}
        <span className="pr-timeline-end">{short(plannedEnd)}</span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Phases: one bullet bar per Epic — actual fill, planned tick.               */
/* -------------------------------------------------------------------------- */

export function PhaseBars({
  phases,
  onSelect,
}: {
  phases: ProgressMetrics["phases"];
  onSelect: (id: string | null, label: string) => void;
}) {
  if (phases.length === 0) return <p className="pr-muted">Chưa có giai đoạn nào.</p>;
  return (
    <div className="pr-bars">
      {phases.map((p) => {
        const gap = round1(p.plannedPct - p.actualPct);
        const severity = gap > 15 ? "crit" : gap > 5 ? "warn" : "ok";
        const late = p.baselineEnd && p.end && p.end > p.baselineEnd;
        return (
          <button key={p.id ?? "none"} className="pr-bar-row" onClick={() => onSelect(p.id, p.summary)}>
            <span className="pr-bar-name" title={p.summary}>
              {p.id && <span className="pr-bar-key">{p.id}</span>}
              {p.summary}
            </span>
            <span className="pr-bar-track" aria-label={`Thực tế ${p.actualPct}%, kế hoạch ${p.plannedPct}%`}>
              <span className={`pr-bar-fill pr-fill-${severity}`} style={{ width: `${Math.min(100, p.actualPct)}%` }} />
              <span className="pr-bar-plan" style={{ left: `${Math.min(100, p.plannedPct)}%` }} />
            </span>
            <span className="pr-bar-val">
              <b>{Math.round(p.actualPct)}%</b>
              <span className="pr-muted"> / {Math.round(p.plannedPct)}%</span>
            </span>
            <span className="pr-bar-flags">
              {p.overdue > 0 && (
                <span className="pr-flag pr-flag-crit" title={`${p.overdue} việc quá hạn`}>
                  <span aria-hidden="true">!</span>
                  {p.overdue}
                </span>
              )}
              {late && (
                <span className="pr-flag pr-flag-serious" title={`Kết thúc ${short(p.end)}, baseline ${short(p.baselineEnd)}`}>
                  <span aria-hidden="true">⏱</span>
                </span>
              )}
            </span>
            <span className="pr-hovercard" role="tooltip">
              <b>{p.summary}</b>
              <span>
                {p.done}/{p.total} việc xong · thực tế {p.actualPct}% · kế hoạch {p.plannedPct}%
              </span>
              <span>
                {short(p.start)} → {short(p.end)}
                {late ? ` (baseline ${short(p.baselineEnd)})` : ""}
              </span>
              {p.overdue > 0 && <span>{p.overdue} việc quá hạn</span>}
              <span className="pr-hovercard-hint">Bấm để xem các việc</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* People: stacked bar per person, length = how much they hold.               */
/* -------------------------------------------------------------------------- */

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts.at(-1)?.[0] ?? "") + (parts.length > 1 ? parts[0][0] : "")).toUpperCase() || "?";
}

export function PeopleBars({
  people,
  onSelect,
}: {
  people: ProgressMetrics["people"];
  onSelect: (accountId: string | null, label: string) => void;
}) {
  if (people.length === 0) return <p className="pr-muted">Chưa có ai được giao việc.</p>;
  const max = Math.max(1, ...people.map((p) => p.open + p.done));
  return (
    <div className="pr-bars">
      {people.map((p) => {
        const todo = p.open - p.inProgress;
        const seg = (n: number) => `${(n / max) * 100}%`;
        return (
          <button key={p.accountId ?? "none"} className="pr-bar-row pr-person-row" onClick={() => onSelect(p.accountId, p.name)}>
            <span className="pr-bar-name">
              <span className={`pr-avatar ${p.accountId ? "" : "pr-avatar-none"}`} aria-hidden="true">
                {p.accountId ? initials(p.name) : "?"}
              </span>
              {p.name}
            </span>
            <span className="pr-stack">
              {p.done > 0 && <span className="pr-stack-seg pr-state-bg-done" style={{ width: seg(p.done) }} />}
              {p.inProgress > 0 && <span className="pr-stack-seg pr-state-bg-inProgress" style={{ width: seg(p.inProgress) }} />}
              {todo > 0 && <span className="pr-stack-seg pr-state-bg-todo" style={{ width: seg(todo) }} />}
            </span>
            <span className="pr-bar-val">
              <b>{p.open}</b>
              <span className="pr-muted"> mở</span>
            </span>
            <span className="pr-bar-flags">
              {p.overdue > 0 && (
                <span className="pr-flag pr-flag-crit" title={`${p.overdue} việc quá hạn`}>
                  <span aria-hidden="true">!</span>
                  {p.overdue}
                </span>
              )}
            </span>
            <span className="pr-hovercard" role="tooltip">
              <b>{p.name}</b>
              <span>
                {p.done} xong · {p.inProgress} đang làm · {todo} chưa làm
              </span>
              {p.overdue > 0 && <span>{p.overdue} việc quá hạn</span>}
              <span className="pr-hovercard-hint">Bấm để xem các việc</span>
            </span>
          </button>
        );
      })}
      <div className="pr-bars-legend" aria-hidden="true">
        {(["done", "inProgress", "todo"] as WorkState[]).map((k) => (
          <span key={k}>
            <i className={`pr-swatch pr-state-bg-${k}`} /> {STATE_LABEL[k]}
          </span>
        ))}
      </div>
    </div>
  );
}
