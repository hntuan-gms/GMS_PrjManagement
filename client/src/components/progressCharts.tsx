
import type { ProgressMetrics } from "../types";

/**
 * The report page's charts. Plain SVG/CSS, no chart library — each one is a
 * single shape and a library would be most of the bundle for four donuts.
 *
 * One encoding across the page, so nothing has to be re-learned between charts:
 * - **Work state is an ordinal blue ramp** — done (--info), in progress
 *   (--info-line), not started a neutral gray. Stages are ordered, so one hue light→
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
  // A bar with the plan marked on it, not a ring: the number is what is read, and a thin bar says
  // "how far, and where should we be" without the decoration of a donut.
  const clamp = (v: number) => Math.min(100, Math.max(0, v));
  return (
    <div className="pr-meter">
      <div className="pr-meter-figure">
        <b>{actual}%</b>
        <span>xong · kế hoạch {planned}%</span>
      </div>
      <div className="pr-meter-bar" role="img" aria-label={`Hoàn thành ${actual}%, kế hoạch ${planned}%`}>
        <span className="pr-meter-fill" style={{ width: `${clamp(actual)}%` }} />
        <span className="pr-meter-plan" style={{ left: `${clamp(planned)}%` }} title={`Kế hoạch ${planned}%`} />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Stacked bar: how many work items are in each state.                        */
/* -------------------------------------------------------------------------- */

export function StatusDonut({
  counts,
  onSelect,
}: {
  counts: Record<WorkState, number>;
  onSelect: (state: WorkState) => void;
}) {
  const order: WorkState[] = ["done", "inProgress", "todo"];
  const total = order.reduce((s, k) => s + counts[k], 0);
  return (
    <div className="pr-stack">
      <div className="pr-meter-figure">
        <b>{total}</b>
        <span>việc</span>
      </div>
      <div className="pr-stack-bar" role="img" aria-label={order.map((k) => `${STATE_LABEL[k]} ${counts[k]}`).join(", ")}>
        {order.map(
          (k) =>
            counts[k] > 0 && (
              <button
                key={k}
                type="button"
                className={`pr-stack-seg pr-state-bg-${k}`}
                style={{ flexGrow: counts[k] }}
                title={`${STATE_LABEL[k]} ${counts[k]}`}
                aria-label={`${STATE_LABEL[k]} ${counts[k]}`}
                onClick={() => onSelect(k)}
              />
            )
        )}
      </div>
      <div className="pr-donut-legend">
        {order.map((k) => (
          <button key={k} className="pr-legend-btn" onClick={() => onSelect(k)}>
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
        {/* The slip is already the page headline; this card answers "when", so it leads with the date. */}
        <span className={`pr-timeline-big ${late ? "pr-bad" : ""}`}>{short(plannedEnd)}</span>
        <span className="pr-muted">
          {late ? `dự kiến xong · baseline ${short(baselineEnd)}` : daysRemaining !== null ? `còn ${daysRemaining} ngày` : "dự kiến xong"}
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
