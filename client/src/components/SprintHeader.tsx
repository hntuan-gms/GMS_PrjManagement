import { useState } from "react";
import { burndown, localDate, shortDate, totalWeight, workingDaysLocal } from "../boardModel";
import type { BoardIssue, BoardSnapshot, Sprint, SprintInsight } from "../types";

/**
 * The active sprint at a glance, above the board: goal, time left, done vs
 * elapsed, a burndown — and the AI stand-up brief on request.
 *
 * The pace verdict here is computed (done% against elapsed%, ±10 points), the
 * same rule the server's sprintFacts uses; the AI forecast next to it is the
 * model's own judgement and is labelled as such, exactly like the report page.
 */

interface Props {
  sprint: Sprint;
  snapshot: BoardSnapshot;
  /** Every issue in this sprint, unfiltered — the header measures the sprint, not the view. */
  issues: BoardIssue[];
  today: string;
  unit: string;
  canUseAi: boolean;
  insight: { loading: boolean; data: SprintInsight | null; error: string | null };
  onAnalyze: () => void;
  onComplete: () => void;
  onEdit: () => void;
  onDescope: (key: string) => void;
  issueButton: (key: string) => React.ReactNode;
}

const VERDICT: Record<SprintInsight["forecast"]["verdict"], { label: string; icon: string; tone: string }> = {
  will_meet: { label: "Kịp mục tiêu", icon: "✓", tone: "good" },
  at_risk: { label: "Có nguy cơ không kịp", icon: "!", tone: "warn" },
  will_miss: { label: "Khó kịp", icon: "✕", tone: "crit" },
};

const CONFIDENCE: Record<"high" | "medium" | "low", string> = {
  high: "tin cậy cao",
  medium: "tin cậy vừa",
  low: "tin cậy thấp",
};

export default function SprintHeader(props: Props) {
  const { sprint, snapshot, issues, today, unit, insight } = props;
  const [open, setOpen] = useState(true);
  const start = localDate(sprint.startDate);
  const end = localDate(sprint.endDate);
  const days = start && end ? workingDaysLocal(start, end) : [];
  const elapsed = days.filter((d) => d < today).length;
  const left = Math.max(0, days.length - elapsed);
  const overdue = !!end && end < today;

  const scope = totalWeight(issues, snapshot);
  const done = totalWeight(issues.filter((i) => i.statusCategory === "done"), snapshot);
  const doing = totalWeight(issues.filter((i) => i.statusCategory === "indeterminate"), snapshot);
  const donePct = scope > 0 ? Math.round((done / scope) * 100) : 0;
  const elapsedPct = days.length > 0 ? Math.round((elapsed / days.length) * 100) : 0;
  const pace = elapsed === 0 ? "start" : donePct >= elapsedPct + 10 ? "ahead" : donePct >= elapsedPct - 10 ? "ok" : "behind";

  // Cheap (one pass per sprint day), so not memoised.
  const series = burndown(sprint, issues, snapshot, today);

  return (
    <div className="sh">
      <div className="sh-main">
        <div className="sh-title">
          <div>
            <b>{sprint.name}</b>
            <span className="bd-muted">
              {shortDate(start)} → {shortDate(end)} ·{" "}
              {overdue ? <span className="bd-bad">đã quá ngày kết thúc</span> : `còn ${left} ngày làm việc`}
            </span>
          </div>
          {sprint.goal ? <p className="sh-goal">🎯 {sprint.goal}</p> : <p className="sh-goal bd-muted">Chưa đặt mục tiêu sprint</p>}
        </div>

        <div className="sh-progress">
          <div className="sh-bar" aria-label={`Xong ${done}/${scope} ${unit}`}>
            <span className="sh-bar-done" style={{ width: `${scope ? (done / scope) * 100 : 0}%` }} />
            <span className="sh-bar-doing" style={{ width: `${scope ? (doing / scope) * 100 : 0}%` }} />
            <span className="sh-bar-time" style={{ left: `${elapsedPct}%` }} title={`Đã qua ${elapsedPct}% thời gian`} />
          </div>
          <div className="sh-progress-text">
            <b>{donePct}%</b> xong · {done}/{scope} {unit}
            <span className={`sh-pace sh-pace-${pace}`}>
              {pace === "ahead" ? "▲ Nhanh hơn nhịp" : pace === "ok" ? "● Đúng nhịp" : pace === "behind" ? "▼ Chậm hơn nhịp" : "Mới bắt đầu"}
            </span>
          </div>
          <div className="sh-legend">
            <span><i className="pr-swatch pr-state-bg-done" /> Xong</span>
            <span><i className="pr-swatch pr-state-bg-inProgress" /> Đang làm</span>
            <span><i className="sh-time-key" /> Thời gian đã qua</span>
          </div>
        </div>

        <Burndown series={series} unit={unit} today={today} />

        <div className="sh-actions">
          {props.canUseAi && (
            <button className="bd-ai-btn" onClick={props.onAnalyze} disabled={insight.loading}>
              {insight.loading ? "Đang phân tích..." : insight.data ? "↻ Phân tích lại" : "✦ Phân tích sprint"}
            </button>
          )}
          <button onClick={props.onComplete}>Hoàn thành sprint</button>
          <button className="bl-icon" onClick={props.onEdit} title="Sửa sprint" aria-label="Sửa sprint">
            ✎
          </button>
        </div>
      </div>

      {(insight.loading || insight.data || insight.error) && (
        <div className="sh-ai">
          <button className="sh-ai-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            <span className="ai-spark sh-spark" aria-hidden="true">✦</span>
            <b>Stand-up hôm nay</b>
            {insight.data && (
              <span className={`sh-verdict sh-tone-${VERDICT[insight.data.forecast.verdict].tone}`}>
                <span aria-hidden="true">{VERDICT[insight.data.forecast.verdict].icon}</span>
                {VERDICT[insight.data.forecast.verdict].label}
                <span className="bd-muted"> · Dự báo AI, {CONFIDENCE[insight.data.forecast.confidence]}</span>
              </span>
            )}
            <span className="bd-spacer" />
            <span className={`bd-chevron ${open ? "is-open" : ""}`} aria-hidden="true" />
          </button>
          {open && (
            <div className="sh-ai-body">
              {insight.loading && (
                <div className="ai-thinking">
                  <span className="chat-spinner" /> AI đang xem nhịp độ, việc bị chặn, việc đứng yên và tải từng người...
                </div>
              )}
              {insight.error && <div className="ai-error">{insight.error}</div>}
              {insight.data && !insight.loading && (
                <>
                  <p className="sh-headline">{insight.data.headline}</p>
                  {insight.data.forecast.reasoning && <p className="bd-muted sh-reason">{insight.data.forecast.reasoning}</p>}
                  <div className="sh-ai-grid">
                    {insight.data.actions.length > 0 && (
                      <div>
                        <h4>Làm ngay hôm nay</h4>
                        <ol className="sh-actions-list">
                          {insight.data.actions.map((a, i) => (
                            <li key={i}>
                              <b>{a.title}</b>
                              {a.owner && <span className="sh-owner">→ {a.owner}</span>}
                              {a.detail && <p>{a.detail}</p>}
                              {a.issueKeys.length > 0 && <div className="ai-keys">{a.issueKeys.map((k) => props.issueButton(k))}</div>}
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {insight.data.descope.length > 0 && (
                      <div>
                        <h4>Nên đưa ra khỏi sprint</h4>
                        <ul className="sh-descope">
                          {insight.data.descope.map((d) => {
                            const stillIn = issues.some((i) => i.key === d.key);
                            return (
                              <li key={d.key}>
                                {props.issueButton(d.key)}
                                <span>{d.reason}</span>
                                {stillIn ? (
                                  <button className="link-btn" onClick={() => props.onDescope(d.key)}>
                                    Chuyển ra backlog
                                  </button>
                                ) : (
                                  <span className="bd-muted">đã chuyển</span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Burndown({ series, unit, today }: { series: ReturnType<typeof burndown>; unit: string; today: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (series.length < 2) return <div className="sh-burn sh-burn-empty bd-muted">Sprint chưa có ngày bắt đầu/kết thúc.</div>;
  const W = 240;
  const H = 76;
  const pad = { l: 4, r: 4, t: 6, b: 14 };
  const max = Math.max(1, ...series.map((p) => Math.max(p.ideal, p.remaining ?? 0)));
  const x = (i: number) => pad.l + (i / (series.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const ideal = series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.ideal).toFixed(1)}`).join(" ");
  const actualPts = series.map((p, i) => ({ p, i })).filter(({ p }) => p.remaining !== null);
  const actual = actualPts.map(({ p, i }, k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(p.remaining!).toFixed(1)}`).join(" ");
  const todayIdx = series.findIndex((p) => p.date >= today);
  const h = hover !== null ? series[hover] : null;

  return (
    <div className="sh-burn">
      <div className="sh-burn-legend">
        <span><i className="pr-key pr-key-actual" /> Còn lại</span>
        <span><i className="pr-key pr-key-planned" /> Lý tưởng</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Burndown: còn ${actualPts.at(-1)?.p.remaining ?? 0} ${unit}`}
        onPointerMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          setHover(Math.max(0, Math.min(series.length - 1, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (series.length - 1)))));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <line className="pr-axis" x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} />
        <path className="pr-line pr-line-planned sh-ideal" d={ideal} />
        {actual && <path className="pr-line pr-line-actual" d={actual} />}
        {todayIdx >= 0 && <line className="pr-crosshair" x1={x(todayIdx)} x2={x(todayIdx)} y1={pad.t} y2={H - pad.b} />}
        {hover !== null && <line className="pr-crosshair" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} />}
        {actualPts.length > 0 && (
          <circle className="pr-dot pr-dot-actual" cx={x(actualPts.at(-1)!.i)} cy={y(actualPts.at(-1)!.p.remaining!)} r={3.5} />
        )}
        <text className="pr-tick" x={pad.l} y={H - 2}>{shortDate(series[0].date)}</text>
        <text className="pr-tick" x={W - pad.r} y={H - 2} textAnchor="end">{shortDate(series.at(-1)!.date)}</text>
      </svg>
      {h && (
        <div className="sh-burn-tip">
          {shortDate(h.date)} · còn <b>{h.remaining ?? "—"}</b> / lý tưởng {h.ideal} {unit}
        </div>
      )}
    </div>
  );
}
