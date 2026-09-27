import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { computeCriticalPath } from "../criticalPath";
import { todayIso } from "../resourceAllocation";
import { isAssignableType, type Health, type ProgressOverview, type ProgressReport, type Task } from "../types";
import AiBrief from "./AiBrief";
import ProgressTrendChart from "./ProgressTrendChart";
import { PeopleBars, PhaseBars, ProgressGauge, ScheduleTimeline, StatusDonut, type WorkState } from "./progressCharts";

interface Props {
  tasks: Task[];
  /** A report to open on arrival — set when the user clicks a report card in the chat. */
  focusReportId: string | null;
  /**
   * Internal staff only: generating a report calls Gemini, which the server
   * gates with requireStaff. Guests still see live numbers and saved reports.
   */
  canGenerate: boolean;
  onOpenEdit: (task: Task) => void;
}

/**
 * The progress report tab — a dashboard and an analyst side by side.
 *
 * - **Left, the dashboard**: every figure computed server-side from the project
 *   as it is right now (no model, no cost, never stale), drawn as charts so the
 *   state reads at a glance. Every chart is a way in: clicking a segment, a bar
 *   or a tile opens the tasks behind it.
 * - **Right, the AI brief** (AiBrief): a dated piece of reasoning over the task
 *   graph — causes, forecast, owned actions — on its own surface so it is never
 *   mistaken for a measured number.
 */

const HEALTH: Record<Health, { label: string; icon: string }> = {
  on_track: { label: "Đúng tiến độ", icon: "✓" },
  at_risk: { label: "Có rủi ro", icon: "!" },
  off_track: { label: "Chậm tiến độ", icon: "✕" },
};

/** What a drill-down shows. Resolved against live `tasks`, so it is never capped like the metric lists. */
type Drill =
  | { kind: "state"; state: WorkState }
  | { kind: "overdue" | "slipped" | "notStarted" | "unassigned" | "undated" | "noBaseline" | "dueSoon" }
  | { kind: "phase"; id: string | null; label: string }
  | { kind: "person"; accountId: string | null; label: string }
  | { kind: "keys"; keys: string[]; label: string };

const DRILL_TITLE: Record<string, string> = {
  overdue: "Việc quá hạn",
  slipped: "Việc trễ so với baseline",
  notStarted: "Tới ngày nhưng chưa bắt đầu",
  unassigned: "Việc đang mở chưa gán người",
  undated: "Việc chưa có ngày",
  noBaseline: "Việc chưa có baseline",
  dueSoon: "Hạn trong 7 ngày tới",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

function short(iso: string | null): string {
  return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—";
}

function toUtc(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

const daysBetween = (from: string, to: string) => Math.round((toUtc(to) - toUtc(from)) / 86_400_000);

function signed(n: number): string {
  const v = Math.round(n * 10) / 10;
  return v > 0 ? `+${v}` : `${v}`;
}

export default function ProgressReportView({ tasks, focusReportId, canGenerate, onOpenEdit }: Props) {
  const [overview, setOverview] = useState<ProgressOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [shown, setShown] = useState<ProgressReport | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [drill, setDrill] = useState<Drill | null>(null);
  const [showReasons, setShowReasons] = useState(false);

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const critical = useMemo(() => computeCriticalPath(tasks), [tasks]);

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

  // Which report the AI panel shows: an explicitly requested one (chat card,
  // history click) wins; otherwise the latest.
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
   * Issue keys open the same edit modal the Gantt uses. A render function, not
   * a nested component, so it isn't a new component type on every render.
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
      <div className="progress-view progress-view-single">
        <div className="rv-notice rv-notice-error">Không tải được số liệu tiến độ: {loadError}</div>
      </div>
    );
  }
  if (!overview) {
    return (
      <div className="progress-view progress-view-single">
        <div className="pr-loading">
          <span className="chat-spinner" /> Đang tính tiến độ dự án...
        </div>
      </div>
    );
  }

  const m = overview.metrics;
  const latestPoint = overview.history.at(-1) ?? null;
  const moved = latestPoint && latestPoint.asOf !== m.asOf ? m.actualPct - latestPoint.actualPct : null;

  const attention: Array<{ kind: Drill["kind"]; label: string; value: number; tone: "crit" | "serious" | "warn" | "neutral"; icon: string }> = [
    { kind: "overdue", label: "Quá hạn", value: m.counts.overdue, tone: "crit", icon: "!" },
    { kind: "slipped", label: "Trễ baseline", value: m.counts.slipped, tone: "serious", icon: "⏱" },
    { kind: "notStarted", label: "Chưa bắt đầu", value: m.counts.notStarted, tone: "warn", icon: "▷" },
    { kind: "unassigned", label: "Chưa gán người", value: m.counts.unassigned, tone: "neutral", icon: "?" },
  ];

  // Anything that makes the charts less trustworthy, as clickable chips.
  const quality = [
    m.counts.undated > 0 && { kind: "undated" as const, text: `${m.counts.undated} việc chưa có ngày`, hint: "không được tính vào %" },
    m.counts.noBaseline > 0 && {
      kind: "noBaseline" as const,
      text: `${m.counts.noBaseline} việc chưa có baseline`,
      hint: "kế hoạch đo theo lịch hiện tại nên không bao giờ hiện là chậm",
    },
  ].filter((x): x is { kind: "undated" | "noBaseline"; text: string; hint: string } => !!x);

  const topAttention = m.overdue.slice(0, 5);

  return (
    <div className="progress-view">
      <div className="pr-main">
        <header className="pr-header">
          <div>
            <h2>Báo cáo tiến độ</h2>
            <span className="pr-sub">
              Tính trực tiếp từ Jira · {fmtDate(m.asOf)} · {m.counts.total} công việc
            </span>
          </div>
          <button
            className={`pr-status pr-status-${m.health}`}
            onClick={() => setShowReasons((v) => !v)}
            aria-expanded={showReasons}
          >
            <span className="pr-status-icon" aria-hidden="true">
              {HEALTH[m.health].icon}
            </span>
            {HEALTH[m.health].label}
            <span className="pr-status-why">{showReasons ? "Ẩn lý do" : "Vì sao?"}</span>
          </button>
        </header>

        {showReasons && (
          <ul className={`pr-reasons pr-reasons-${m.health}`}>
            {m.healthReasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        )}

        {/* ---- glance row: the three questions a PM asks first ---- */}
        <div className="pr-glance">
          <section className="pr-card pr-card-hero">
            <h3>Tiến độ</h3>
            <ProgressGauge actual={m.actualPct} planned={m.plannedPct} />
            <div className="pr-hero-meta">
              {m.spi !== null && (
                <span title="Thực tế ÷ kế hoạch. 1.0 là đúng tiến độ.">
                  SPI <b>{m.spi}</b>
                </span>
              )}
              {moved !== null && (
                <span title={`So với báo cáo ngày ${fmtDate(latestPoint!.asOf)}`}>
                  <b>{signed(moved)}</b> điểm từ {short(latestPoint!.asOf)}
                </span>
              )}
            </div>
          </section>

          <section className="pr-card">
            <h3>Trạng thái công việc</h3>
            <StatusDonut
              counts={{ done: m.counts.done, inProgress: m.counts.inProgress, todo: m.counts.todo }}
              onSelect={(state) => setDrill({ kind: "state", state })}
            />
          </section>

          <section className="pr-card pr-card-schedule">
            <h3>Thời hạn</h3>
            <ScheduleTimeline schedule={m.schedule} asOf={m.asOf} />
            <div className="pr-tiles">
              {attention.map((a) => (
                <button
                  key={a.kind}
                  className={`pr-tile ${a.value > 0 ? `pr-tile-${a.tone}` : "pr-tile-zero"}`}
                  onClick={() => setDrill({ kind: a.kind } as Drill)}
                  disabled={a.value === 0}
                >
                  <span className="pr-tile-icon" aria-hidden="true">
                    {a.value > 0 ? a.icon : "✓"}
                  </span>
                  <b>{a.value}</b>
                  <span>{a.label}</span>
                </button>
              ))}
            </div>
          </section>
        </div>

        {quality.length > 0 && (
          <div className="pr-quality">
            <span className="pr-quality-label">
              <span aria-hidden="true">⚠</span> Độ tin cậy số liệu
            </span>
            {quality.map((q) => (
              <button key={q.kind} className="pr-chip" title={q.hint} onClick={() => setDrill({ kind: q.kind })}>
                {q.text}
              </button>
            ))}
          </div>
        )}

        {topAttention.length > 0 && (
          <section className="pr-card">
            <div className="pr-card-head">
              <h3>Cần xử lý ngay</h3>
              {m.counts.overdue > topAttention.length && (
                <button className="ai-link" onClick={() => setDrill({ kind: "overdue" })}>
                  Xem tất cả {m.counts.overdue} →
                </button>
              )}
            </div>
            <ul className="pr-attn">
              {topAttention.map((t) => (
                <li key={t.id}>
                  {issueLink(t.id)}
                  <span className="pr-attn-summary" title={t.summary}>
                    {t.summary}
                  </span>
                  {t.critical && <span className="pr-critical">găng</span>}
                  <span className="pr-attn-who">{t.assignee ?? "chưa gán"}</span>
                  <span className="pr-late">trễ {t.daysLate}n</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="pr-columns">
          <section className="pr-card">
            <div className="pr-card-head">
              <h3>Theo giai đoạn</h3>
              <span className="pr-key-legend" aria-hidden="true">
                <i className="pr-swatch pr-swatch-done" /> thực tế <i className="pr-tick-key" /> kế hoạch
              </span>
            </div>
            <PhaseBars phases={m.phases} onSelect={(id, label) => setDrill({ kind: "phase", id, label })} />
          </section>

          <section className="pr-card">
            <h3>Theo người phụ trách</h3>
            <PeopleBars people={m.people} onSelect={(accountId, label) => setDrill({ kind: "person", accountId, label })} />
          </section>
        </div>

        <section className="pr-card">
          <div className="pr-card-head">
            <h3>Xu hướng qua các lần phân tích</h3>
          </div>
          {overview.history.length >= 2 ? (
            <ProgressTrendChart points={overview.history} onSelect={openReport} />
          ) : (
            <p className="pr-muted">Cần ít nhất 2 lần phân tích AI để thấy xu hướng theo thời gian.</p>
          )}
          {overview.history.length > 0 && (
            <div className="pr-history">
              {[...overview.history].reverse().map((p) => (
                <button
                  key={p.id}
                  className={`pr-history-chip ${report?.id === p.id ? "is-current" : ""}`}
                  onClick={() => openReport(p.id)}
                  title={p.headline}
                >
                  <span className={`pr-dot-status pr-dot-${p.health}`} aria-hidden="true" />
                  {short(p.asOf)}
                  <b>{p.actualPct}%</b>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      <AiBrief
        key={report?.id ?? "none"}
        report={report}
        live={m}
        isLatest={report?.id === overview.latest?.id}
        warnings={warnings}
        canGenerate={canGenerate}
        generating={generating}
        error={genError}
        onGenerate={generate}
        issueLink={issueLink}
        onShowKeys={(keys, label) => setDrill({ kind: "keys", keys, label })}
      />

      {drill && (
        <TaskDrawer
          drill={drill}
          tasks={tasks}
          asOf={m.asOf}
          critical={critical}
          onClose={() => setDrill(null)}
          onOpenEdit={onOpenEdit}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The detail behind any chart. Resolved client-side from the workspace's live
 * tasks with the same definitions progress.ts uses (leaf, assignable work
 * items), so it matches the numbers without being capped like the metric lists.
 */
function TaskDrawer({
  drill,
  tasks,
  asOf,
  critical,
  onClose,
  onOpenEdit,
}: {
  drill: Drill;
  tasks: Task[];
  asOf: string;
  critical: Set<string>;
  onClose: () => void;
  onOpenEdit: (task: Task) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The edit modal handles its own Escape; leave the drawer open under it.
      if (e.key === "Escape" && !document.querySelector(".modal-overlay")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { title, rows } = useMemo(() => resolveDrill(drill, tasks, asOf), [drill, tasks, asOf]);

  return (
    <div className="pr-drawer-backdrop" onClick={onClose}>
      <div className="pr-drawer" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="pr-drawer-head">
          <div>
            <b>{title}</b>
            <span className="pr-muted">{rows.length} công việc</span>
          </div>
          <button className="pr-drawer-close" onClick={onClose} aria-label="Đóng">
            ✕
          </button>
        </div>
        {rows.length === 0 ? (
          <p className="pr-muted pr-drawer-empty">Không có công việc nào.</p>
        ) : (
          <ul className="pr-drawer-list">
            {rows.map((t) => {
              const late = t.statusCategory !== "done" && t.dueDate && t.dueDate < asOf ? daysBetween(t.dueDate, asOf) : 0;
              const slip = t.baselineDue && t.dueDate && t.dueDate > t.baselineDue ? daysBetween(t.baselineDue, t.dueDate) : 0;
              return (
                <li key={t.id}>
                  <button className="pr-drawer-row" onClick={() => onOpenEdit(t)}>
                    <span className="pr-drawer-top">
                      <span className="pr-issue">{t.id}</span>
                      <span className={`pr-state-chip pr-state-chip-${t.statusCategory}`}>{t.statusName}</span>
                      {critical.has(t.id) && t.statusCategory !== "done" && <span className="pr-critical">găng</span>}
                      {late > 0 && <span className="pr-late">trễ {late} ngày</span>}
                      {slip > 0 && t.statusCategory !== "done" && <span className="pr-slip">+{slip}n baseline</span>}
                    </span>
                    <span className="pr-drawer-summary">{t.summary}</span>
                    <span className="pr-drawer-meta">
                      <span>{t.assigneeName ?? "Chưa gán"}</span>
                      <span>
                        {t.startDate ? `${short(t.startDate)} → ${short(t.dueDate)}` : "chưa có ngày"}
                      </span>
                      {t.statusCategory !== "done" && t.percentComplete > 0 && <span>{t.percentComplete}%</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function resolveDrill(drill: Drill, tasks: Task[], asOf: string): { title: string; rows: Task[] } {
  const byId = new Map(tasks.map((t) => [t.id, t]));

  if (drill.kind === "keys") {
    return {
      title: drill.label,
      rows: drill.keys.map((k) => byId.get(k)).filter((t): t is Task => !!t),
    };
  }

  const parentIds = new Set(tasks.map((t) => t.wbsParentId).filter((p): p is string => !!p));
  const work = tasks.filter((t) => isAssignableType(t.issueType) && !parentIds.has(t.id));
  const open = work.filter((t) => t.statusCategory !== "done");
  const weekAhead = new Date(toUtc(asOf) + 7 * 86_400_000).toISOString().slice(0, 10);

  const epicOf = (t: Task): string | null => {
    let cursor = t.wbsParentId ? byId.get(t.wbsParentId) : undefined;
    for (let guard = 0; cursor && guard < 20; guard++) {
      if (!isAssignableType(cursor.issueType)) return cursor.id;
      cursor = cursor.wbsParentId ? byId.get(cursor.wbsParentId) : undefined;
    }
    return null;
  };

  // Late first, then by due date: the drawer is usually opened to act.
  const urgency = (a: Task, b: Task) => {
    const lateA = a.statusCategory !== "done" && a.dueDate && a.dueDate < asOf ? 1 : 0;
    const lateB = b.statusCategory !== "done" && b.dueDate && b.dueDate < asOf ? 1 : 0;
    if (lateA !== lateB) return lateB - lateA;
    return (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
  };

  let title: string;
  let rows: Task[];
  switch (drill.kind) {
    case "state": {
      const cat = drill.state === "done" ? "done" : drill.state === "inProgress" ? "indeterminate" : "new";
      title = drill.state === "done" ? "Việc đã xong" : drill.state === "inProgress" ? "Việc đang làm" : "Việc chưa làm";
      rows = work.filter((t) => t.statusCategory === cat);
      break;
    }
    case "overdue":
      title = DRILL_TITLE.overdue;
      rows = open.filter((t) => t.dueDate && t.dueDate < asOf);
      break;
    case "slipped":
      title = DRILL_TITLE.slipped;
      rows = open.filter((t) => t.baselineDue && t.dueDate && t.dueDate > t.baselineDue);
      break;
    case "notStarted":
      title = DRILL_TITLE.notStarted;
      rows = open.filter((t) => t.statusCategory === "new" && t.startDate && t.startDate < asOf);
      break;
    case "unassigned":
      title = DRILL_TITLE.unassigned;
      rows = open.filter((t) => !t.assigneeAccountId);
      break;
    case "undated":
      title = DRILL_TITLE.undated;
      rows = work.filter((t) => !t.startDate);
      break;
    case "noBaseline":
      title = DRILL_TITLE.noBaseline;
      rows = work.filter((t) => t.startDate && !t.baselineStart && !t.baselineDue);
      break;
    case "dueSoon":
      title = DRILL_TITLE.dueSoon;
      rows = open.filter((t) => t.dueDate && t.dueDate >= asOf && t.dueDate <= weekAhead);
      break;
    case "phase":
      title = drill.id ? `${drill.id} · ${drill.label}` : drill.label;
      rows = work.filter((t) => epicOf(t) === drill.id);
      break;
    case "person":
      title = drill.label;
      rows = work.filter((t) => (t.assigneeAccountId ?? null) === drill.accountId);
      break;
  }
  return { title, rows: [...rows].sort(urgency) };
}
