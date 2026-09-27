import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { todayIso } from "../resourceAllocation";
import type {
  Health,
  ProgressMetrics,
  ProgressOverview,
  ProgressReport,
  ProgressTaskRef,
  ReportNarrative,
  Task,
} from "../types";
import ProgressTrendChart from "./ProgressTrendChart";

interface Props {
  tasks: Task[];
  /** A report to open on arrival — set when the user clicks a report card in the chat. */
  focusReportId: string | null;
  onOpenEdit: (task: Task) => void;
}

/**
 * The progress report tab.
 *
 * Two layers with two lifetimes, and the page keeps them visibly apart:
 * - **Live numbers** (KPI row, phases, task lists) are computed server-side from
 *   the project as it is right now, on every visit. No model involved, no cost,
 *   never stale.
 * - **The AI narrative** is a dated document: generated only on request, stored
 *   with the numbers it was written from, and labelled with when it was written.
 *   When the project has moved since, the page says so instead of letting last
 *   week's prose sit silently next to today's figures.
 */

const HEALTH: Record<Health, { label: string; icon: string }> = {
  on_track: { label: "Đúng tiến độ", icon: "✓" },
  at_risk: { label: "Có rủi ro", icon: "!" },
  off_track: { label: "Chậm tiến độ", icon: "✕" },
};

const SEVERITY: Record<"high" | "medium" | "low", { label: string; icon: string }> = {
  high: { label: "Cao", icon: "▲" },
  medium: { label: "Trung bình", icon: "■" },
  low: { label: "Thấp", icon: "▼" },
};

type ListTab = "overdue" | "slipped" | "dueSoon" | "notStarted" | "unassigned";

const LIST_TABS: Array<{ key: ListTab; label: string; countKey: keyof ProgressMetrics["counts"] | null }> = [
  { key: "overdue", label: "Quá hạn", countKey: "overdue" },
  { key: "slipped", label: "Trễ so với baseline", countKey: "slipped" },
  { key: "dueSoon", label: "Hạn trong 7 ngày", countKey: null },
  { key: "notStarted", label: "Tới hạn bắt đầu nhưng chưa làm", countKey: "notStarted" },
  { key: "unassigned", label: "Chưa gán người", countKey: "unassigned" },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}

function signed(n: number): string {
  const v = Math.round(n * 10) / 10;
  return v > 0 ? `+${v}` : `${v}`;
}

export default function ProgressReportView({ tasks, focusReportId, onOpenEdit }: Props) {
  const [overview, setOverview] = useState<ProgressOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [shown, setShown] = useState<ProgressReport | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [tab, setTab] = useState<ListTab>("overdue");

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  // Refetched whenever the workspace's tasks change — an edit in the Gantt or a
  // write from the assistant moves these numbers, and the live layer is only
  // worth having if it actually is live.
  useEffect(() => {
    let alive = true;
    api
      .getProgress(todayIso())
      .then((data) => {
        if (!alive) return;
        setOverview(data);
        setLoadError(null);
      })
      .catch((e: Error) => alive && setLoadError(e.message));
    return () => {
      alive = false;
    };
  }, [tasks]);

  // Which report the narrative panel shows: an explicitly requested one (chat
  // card, history click) wins; otherwise the latest.
  useEffect(() => {
    if (!focusReportId) return;
    let alive = true;
    api
      .getProgressReport(focusReportId)
      .then((r) => alive && setShown(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [focusReportId]);

  const report = shown ?? overview?.latest ?? null;

  async function generate() {
    setGenerating(true);
    setGenError(null);
    try {
      const result = await api.generateProgressReport(todayIso());
      setShown(result.report);
      setWarnings(result.warnings);
      setOverview((prev) => (prev ? { ...prev, latest: result.report, history: result.history } : prev));
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Không tạo được báo cáo.");
    } finally {
      setGenerating(false);
    }
  }

  async function openReport(id: string) {
    try {
      setShown(await api.getProgressReport(id));
      setWarnings([]);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Không mở được báo cáo.");
    }
  }

  /**
   * Issue keys in the narrative and task lists open the same edit modal the
   * Gantt uses. A render function, not a nested component, so it isn't a new
   * component type on every render (which would remount every link).
   */
  const issueLink = (id: string) => {
    const task = taskById.get(id);
    return task ? (
      <button key={id} className="pr-issue" onClick={() => onOpenEdit(task)} title={task.summary}>
        {id}
      </button>
    ) : (
      <span key={id} className="pr-issue pr-issue-missing" title="Công việc này không còn trong dự án">
        {id}
      </span>
    );
  };

  if (loadError && !overview) {
    return (
      <div className="progress-view">
        <div className="rv-notice rv-notice-error">Không tải được số liệu tiến độ: {loadError}</div>
      </div>
    );
  }
  if (!overview) {
    return (
      <div className="progress-view">
        <div className="pr-loading">
          <span className="chat-spinner" /> Đang tính tiến độ dự án...
        </div>
      </div>
    );
  }

  const m = overview.metrics;
  const previous = overview.history.length >= 2 ? overview.history[overview.history.length - 2] : null;
  const latestPoint = overview.history[overview.history.length - 1] ?? null;

  return (
    <div className="progress-view">
      <div className="pr-header">
        <div>
          <h2>Báo cáo tiến độ</h2>
          <span className="pr-sub">
            Số liệu tính trực tiếp từ Jira tới ngày {fmtDate(m.asOf)} · {m.counts.total} công việc
          </span>
        </div>
        <button className="primary" onClick={generate} disabled={generating}>
          {generating ? "AI đang viết báo cáo..." : report ? "✦ Tạo báo cáo mới" : "✦ Tạo báo cáo AI"}
        </button>
      </div>

      <HealthBanner metrics={m} />

      <div className="pr-kpis">
        <Kpi
          label="Hoàn thành thực tế"
          value={`${m.actualPct}%`}
          hero
          sub={
            latestPoint && latestPoint.asOf !== m.asOf
              ? `${signed(m.actualPct - latestPoint.actualPct)} điểm từ báo cáo ${fmtDate(latestPoint.asOf)}`
              : `${m.counts.done}/${m.counts.total} công việc đã xong`
          }
        />
        <Kpi label="Theo kế hoạch" value={`${m.plannedPct}%`} sub="phần baseline lẽ ra phải xong tới hôm nay" />
        <Kpi
          label="SPI"
          value={m.spi !== null ? String(m.spi) : "—"}
          sub={m.spi !== null ? "thực tế ÷ kế hoạch · 1.0 là đúng tiến độ" : "dự án chưa tới giai đoạn đo được"}
        />
        <Kpi
          label="Quá hạn"
          value={String(m.counts.overdue)}
          tone={m.counts.overdue > 0 ? "bad" : undefined}
          sub={m.counts.criticalOpen > 0 ? `${m.overdue.filter((t) => t.critical).length} trên đường găng` : "không có việc trên đường găng"}
        />
        <Kpi
          label="Dự kiến kết thúc"
          value={fmtDate(m.schedule.plannedEnd)}
          tone={m.schedule.slipDays && m.schedule.slipDays > 0 ? "bad" : undefined}
          sub={
            m.schedule.slipDays && m.schedule.slipDays > 0
              ? `trễ ${m.schedule.slipDays} ngày so với baseline ${fmtDate(m.schedule.baselineEnd)}`
              : m.schedule.daysRemaining !== null
                ? `còn ${m.schedule.daysRemaining} ngày · đúng baseline`
                : "chưa có lịch"
          }
        />
      </div>

      {(() => {
        // Anything that makes the numbers above less trustworthy, said plainly
        // next to them rather than buried in a tooltip.
        const issues = [
          m.counts.undated > 0 && `${m.counts.undated} công việc chưa có ngày (không được tính vào %)`,
          m.counts.noBaseline > 0 &&
            `${m.counts.noBaseline} công việc chưa có baseline (kế hoạch đo theo lịch hiện tại nên không bao giờ hiện là chậm)`,
          m.counts.unassigned > 0 && `${m.counts.unassigned} công việc đang mở chưa gán người`,
        ].filter(Boolean);
        return issues.length > 0 ? (
          <div className="pr-quality">
            Độ tin cậy của số liệu: <b>{issues.join(" · ")}</b>
          </div>
        ) : null;
      })()}

      <div className="pr-columns">
        <section className="pr-card pr-narrative">
          {genError && <div className="rv-notice rv-notice-error">{genError}</div>}
          {report ? (
            <Narrative
              report={report}
              live={m}
              isLatest={report.id === overview.latest?.id}
              warnings={warnings}
              issueLink={issueLink}
            />
          ) : (
            <div className="pr-empty">
              <b>Chưa có báo cáo AI nào.</b>
              <p>
                Các con số bên trên luôn được tính trực tiếp. Bấm <i>Tạo báo cáo AI</i> để có phần nhận định:
                tóm tắt tình hình, rủi ro chính và việc cần làm ngay — viết dựa trên đúng những con số này.
              </p>
            </div>
          )}
        </section>

        <section className="pr-card pr-history">
          <h3>Xu hướng</h3>
          {overview.history.length >= 2 ? (
            <ProgressTrendChart points={overview.history} onSelect={openReport} />
          ) : (
            <p className="pr-muted">Cần ít nhất 2 báo cáo để thấy xu hướng theo thời gian.</p>
          )}
          {overview.history.length > 0 && (
            <table className="pr-table pr-history-table">
              <thead>
                <tr>
                  <th>Ngày</th>
                  <th>Tình trạng</th>
                  <th className="num">Thực tế</th>
                  <th className="num">Kế hoạch</th>
                </tr>
              </thead>
              <tbody>
                {[...overview.history].reverse().map((p) => (
                  <tr
                    key={p.id}
                    className={`clickable-row ${report?.id === p.id ? "is-current" : ""}`}
                    onClick={() => openReport(p.id)}
                    title={p.headline}
                  >
                    <td>{fmtDate(p.asOf)}</td>
                    <td>
                      <HealthChip health={p.health} small />
                    </td>
                    <td className="num">{p.actualPct}%</td>
                    <td className="num">{p.plannedPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {previous && latestPoint && (
            <p className="pr-muted">
              So với kỳ trước ({fmtDate(previous.asOf)}): thực tế {signed(latestPoint.actualPct - previous.actualPct)} điểm,
              kế hoạch {signed(latestPoint.plannedPct - previous.plannedPct)} điểm.
            </p>
          )}
        </section>
      </div>

      <section className="pr-card">
        <h3>Tiến độ theo giai đoạn</h3>
        <table className="pr-table pr-phases">
          <thead>
            <tr>
              <th>Giai đoạn</th>
              <th className="pr-meter-col">Thực tế so với kế hoạch</th>
              <th className="num">Xong</th>
              <th className="num">Quá hạn</th>
              <th>Kết thúc</th>
            </tr>
          </thead>
          <tbody>
            {m.phases.map((p) => (
              <tr key={p.id ?? "none"}>
                <td>
                  {p.id && issueLink(p.id)} <span className="pr-phase-name">{p.summary}</span>
                </td>
                <td>
                  <PhaseMeter actual={p.actualPct} planned={p.plannedPct} />
                </td>
                <td className="num">
                  {p.done}/{p.total}
                </td>
                <td className={`num ${p.overdue > 0 ? "pr-bad" : ""}`}>{p.overdue}</td>
                <td>
                  {fmtDate(p.end)}
                  {p.baselineEnd && p.end && p.end > p.baselineEnd && (
                    <span className="pr-slip"> (baseline {fmtDate(p.baselineEnd)})</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="pr-columns">
        <section className="pr-card pr-lists">
          <div className="pr-tabs" role="tablist">
            {LIST_TABS.map((t) => {
              const count = t.countKey ? m.counts[t.countKey] : m[t.key].length;
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  className={tab === t.key ? "active" : ""}
                  onClick={() => setTab(t.key)}
                >
                  {t.label} <span className="pr-count">{count}</span>
                </button>
              );
            })}
          </div>
          <TaskList tab={tab} metrics={m} issueLink={issueLink} />
        </section>

        <section className="pr-card pr-people">
          <h3>Theo người phụ trách</h3>
          <table className="pr-table">
            <thead>
              <tr>
                <th>Người</th>
                <th className="num">Đang mở</th>
                <th className="num">Đang làm</th>
                <th className="num">Quá hạn</th>
                <th className="num">Xong</th>
              </tr>
            </thead>
            <tbody>
              {m.people.map((p) => (
                <tr key={p.accountId ?? "none"}>
                  <td className={p.accountId ? "" : "pr-muted"}>{p.name}</td>
                  <td className="num">{p.open}</td>
                  <td className="num">{p.inProgress}</td>
                  <td className={`num ${p.overdue > 0 ? "pr-bad" : ""}`}>{p.overdue}</td>
                  <td className="num">{p.done}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function HealthChip({ health, small }: { health: Health; small?: boolean }) {
  const h = HEALTH[health];
  // Icon + label, never colour alone: the status palette's warning step sits
  // below 3:1 on white by design, and the label is what carries meaning.
  return (
    <span className={`pr-health pr-health-${health} ${small ? "pr-health-small" : ""}`}>
      <span className="pr-health-icon" aria-hidden="true">
        {h.icon}
      </span>
      {h.label}
    </span>
  );
}

function HealthBanner({ metrics }: { metrics: ProgressMetrics }) {
  return (
    <div className={`pr-banner pr-banner-${metrics.health}`}>
      <HealthChip health={metrics.health} />
      <ul>
        {metrics.healthReasons.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  hero,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  hero?: boolean;
  tone?: "bad";
}) {
  return (
    <div className={`pr-kpi ${hero ? "pr-kpi-hero" : ""}`}>
      <span className="pr-kpi-label">{label}</span>
      <span className={`pr-kpi-value ${tone === "bad" ? "pr-bad" : ""}`}>{value}</span>
      <span className="pr-kpi-sub">{sub}</span>
    </div>
  );
}

/**
 * Actual as the fill, planned as a tick on the same track — a bullet meter. The
 * fill's colour carries severity by how far actual trails planned, and the gap
 * is also written out in text, so the colour is never the only signal.
 */
function PhaseMeter({ actual, planned }: { actual: number; planned: number }) {
  const gap = Math.round((planned - actual) * 10) / 10;
  const severity = gap > 15 ? "crit" : gap > 5 ? "warn" : "ok";
  return (
    <div className="pr-meter-wrap">
      <div
        className="pr-meter"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={actual}
        aria-label={`Thực tế ${actual}%, kế hoạch ${planned}%`}
      >
        <div className={`pr-meter-fill pr-meter-${severity}`} style={{ width: `${Math.min(100, actual)}%` }} />
        <div className="pr-meter-plan" style={{ left: `${Math.min(100, planned)}%` }} title={`Kế hoạch ${planned}%`} />
      </div>
      <span className="pr-meter-text">
        {actual}% <span className="pr-muted">/ {planned}%</span>
        {gap > 5 && <span className={`pr-gap pr-gap-${severity}`}> chậm {gap} điểm</span>}
      </span>
    </div>
  );
}

function Narrative({
  report,
  live,
  isLatest,
  warnings,
  issueLink,
}: {
  report: ProgressReport;
  live: ProgressMetrics;
  isLatest: boolean;
  warnings: string[];
  issueLink: (id: string) => React.ReactNode;
}) {
  const n: ReportNarrative = report.narrative;
  const drifted =
    report.asOf !== live.asOf || Math.abs(report.actualPct - live.actualPct) >= 0.1 || report.health !== live.health;
  const tokens =
    (report.usage.promptTokens ?? 0) + (report.usage.outputTokens ?? 0) + (report.usage.thoughtTokens ?? 0);

  return (
    <>
      <div className="pr-narr-head">
        <HealthChip health={report.health} />
        <span className="pr-muted">
          {isLatest ? "Báo cáo mới nhất" : "Báo cáo cũ"} · viết lúc {fmtDateTime(report.createdAt)}
        </span>
      </div>

      {drifted && (
        <div className="pr-drift">
          Báo cáo này viết khi dự án hoàn thành {report.actualPct}% (ngày {fmtDate(report.asOf)}); số liệu hiện tại là{" "}
          {live.actualPct}%. Tạo báo cáo mới để phần nhận định khớp với số liệu hôm nay.
        </div>
      )}

      <h3 className="pr-headline">{n.headline}</h3>
      {n.summary && <p className="pr-summary">{n.summary}</p>}

      {n.highlights.length > 0 && (
        <>
          <h4>Điểm tích cực</h4>
          <ul className="pr-bullets">
            {n.highlights.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </>
      )}

      {n.risks.length > 0 && (
        <>
          <h4>Rủi ro</h4>
          <ul className="pr-risks">
            {n.risks.map((r, i) => (
              <li key={i} className={`pr-risk pr-risk-${r.severity}`}>
                <span className={`pr-sev pr-sev-${r.severity}`}>
                  <span aria-hidden="true">{SEVERITY[r.severity].icon}</span> {SEVERITY[r.severity].label}
                </span>
                <div>
                  <b>{r.title}</b>
                  <p>{r.detail}</p>
                  {r.issueKeys.length > 0 && (
                    <div className="pr-keys">
                      {r.issueKeys.map((k) => issueLink(k))}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {n.recommendations.length > 0 && (
        <>
          <h4>Việc cần làm</h4>
          <ol className="pr-recs">
            {n.recommendations.map((r, i) => (
              <li key={i}>
                <b>{r.action}</b>
                {r.rationale && <p>{r.rationale}</p>}
                {r.issueKeys.length > 0 && (
                  <div className="pr-keys">
                    {r.issueKeys.map((k) => issueLink(k))}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </>
      )}

      {warnings.length > 0 && (
        <details className="pr-warnings">
          <summary>{warnings.length} điều chỉnh tự động trên nội dung AI</summary>
          <ul>
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="pr-foot">
        Phần nhận định do AI ({report.model ?? "không rõ model"}) viết dựa trên số liệu đã tính sẵn; mọi con số và
        tình trạng do hệ thống tính, không phải AI ước lượng. {tokens > 0 && `${tokens.toLocaleString("vi-VN")} token.`}
      </div>
    </>
  );
}

function TaskList({
  tab,
  metrics,
  issueLink,
}: {
  tab: ListTab;
  metrics: ProgressMetrics;
  issueLink: (id: string) => React.ReactNode;
}) {
  const rows: Array<ProgressTaskRef & { extra?: string }> =
    tab === "overdue"
      ? metrics.overdue.map((t) => ({ ...t, extra: `trễ ${t.daysLate} ngày` }))
      : tab === "slipped"
        ? metrics.slipped.map((t) => ({ ...t, extra: `+${t.slipDays} ngày so với ${fmtDate(t.baselineDue)}` }))
        : tab === "dueSoon"
          ? metrics.dueSoon.map((t) => ({ ...t, extra: `hạn ${fmtDate(t.dueDate)}` }))
          : tab === "notStarted"
            ? metrics.notStarted.map((t) => ({ ...t, extra: `lẽ ra bắt đầu ${fmtDate(t.startDate)}` }))
            : metrics.unassigned.map((t) => ({ ...t, extra: t.dueDate ? `hạn ${fmtDate(t.dueDate)}` : "" }));

  if (rows.length === 0) return <p className="pr-muted pr-list-empty">Không có công việc nào.</p>;

  return (
    <table className="pr-table">
      <tbody>
        {rows.map((t) => (
          <tr key={t.id}>
            <td className="pr-key-col">
              {issueLink(t.id)}
            </td>
            <td>
              {t.summary}
              {t.critical && (
                <span className="pr-critical" title="Nằm trên đường găng — trễ ở đây đẩy lùi ngày kết thúc dự án">
                  đường găng
                </span>
              )}
            </td>
            <td className="pr-muted">{t.assignee ?? "chưa gán"}</td>
            <td className="pr-extra">{t.extra}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
