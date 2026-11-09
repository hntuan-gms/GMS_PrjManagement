import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import DateField from "./DateField";
import { api } from "../api";
import { computeCriticalPath } from "../criticalPath";
import { addDays, buildResourceLoad, todayIso, type ResourceLoad } from "../resourceAllocation";
import { csvName, downloadCsv } from "../csv";
import {
  isAssignableType,
  type JiraUser,
  type ProgressMetrics,
  type ProgressOverview,
  type ProgressReport,
  type ProgressScope,
  type ResourceAbsence,
  type ResourceProfile,
  type Task,
  type TaskUpdateInput,
} from "../types";
import { isViewFresh, readViewCache, writeViewCache } from "../viewCache";
import { overviewParams, warmInFlight } from "../warmViews";
import { buildReportLink } from "../deepLink";
import type { SlaView } from "../sla";
import AgileReports from "./AgileReports";
import AiBrief from "./AiBrief";
import ProgressTrendChart from "./ProgressTrendChart";
import ReportCompare from "./ReportCompare";
import PersonPicker from "./PersonPicker";
import Popover from "./Popover";
import Spinner from "./Spinner";
import { EpicTable, PeopleTable, ProgressLine } from "./progressCharts";
import { useDialogs } from "./dialogContext";
import { pct, pulseDecisions, pulseHeadline, STATE_LABEL, type PulseAction, type PulseDecision, type WorkState } from "../projectPulse";
import { scopeFromTaskFilter } from "../reportScope";
import { changeSchedule, scheduleOf } from "../scheduleFields";
import { formatDayMonth } from "../humanDate";
import type { TaskFilter } from "../taskFilter";
import { useWorkCalendar } from "./workCalendarContext";
import { Icon } from "./Icons";
import { toast } from "../toast";

/** What Nhân lực knows about people that Jira does not: hours a day and leave. Optional: without it, 8h and no leave. */
export interface ReportPool {
  profiles: ResourceProfile[];
  absences: ResourceAbsence[];
  defaultCapacityHours?: number;
}

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
  /** Site + account + project, to key the last answer shown (viewCache.ts). */
  cacheScope: string;
  /** For the shareable link to a report. */
  projectKey: string;
  /** The workspace is still on its saved copy of the tasks; asking now would be answered twice. */
  refreshing?: boolean;
  /** The project's computed SLA; null while SLA is off (no SLA counts). */
  sla?: SlaView | null;
  /** For "Cần bạn quyết": who can be picked, and the one-click actions. */
  users?: JiraUser[];
  /** The signed-in account, for "Của tôi" in the scope menu. */
  meAccountId?: string;
  onAssign?: (taskId: string, accountId: string) => Promise<void>;
  /** One field edit, the way the task panel saves it (shown at once, put back if Jira refuses). */
  onUpdateTask?: (taskId: string, patch: TaskUpdateInput) => Promise<void>;
  /** "Chụp baseline": freezes the current dates of these tasks as their baseline. */
  onSaveBaseline?: (taskIds: string[]) => Promise<void>;
  onOpenResources?: () => void;
  /**
   * "Xem lịch Anh" on an overload row: Nhân lực, that person opened, scrolled to the first overloaded day.
   * Without it the row falls back to onOpenResources (the tab, no person).
   */
  onOpenPersonLoad?: (accountId: string, date?: string) => void;
  /** The next two weeks' load as Nhân lực computes it — the same object behind the lens badge. */
  nearLoad?: ResourceLoad | null;
  /** Profiles and leave, for the person picker's "rảnh / trùng n ngày" hints. */
  pool?: ReportPool | null;
  /** The plan's filter: what it holds that the report can say (one person, one Epic, types) is where this page starts. */
  taskFilter?: TaskFilter;
}

/**
 * "Nhịp dự án". The page answers three questions, top to bottom: are we on time (one sentence and one bar),
 * why ("Vì sao?" under the bar), and what do I need to do ("Cần bạn quyết", each row with its action). Epics
 * and people follow as two plain tables whose cells are words, then the trend once there are three days of
 * it. Every figure is computed (server/src/progress.ts, projectPulse.ts); the AI brief is a separate,
 * dated layer on its own surface to the right, offered by one button.
 */

/** What a drill-down shows. Resolved against live `tasks`, so it is never capped like the metric lists. */
type Drill =
  | { kind: "state"; state: WorkState }
  | { kind: "overdue" | "slipped" | "notStarted" | "unassigned" | "undated" | "noBaseline" | "dueSoon" | "slaBreached" | "slaWarn" }
  | { kind: "phase"; id: string | null; label: string }
  | { kind: "person"; accountId: string | null; label: string }
  | { kind: "keys"; keys: string[]; label: string };

const DRILL_TITLE: Record<string, string> = {
  overdue: "Việc quá hạn",
  slipped: "Việc trễ so với baseline",
  notStarted: "Tới ngày nhưng chưa bắt đầu",
  unassigned: "Việc đang mở chưa có người",
  undated: "Việc chưa có ngày",
  noBaseline: "Việc chưa có baseline",
  dueSoon: "Hạn trong 7 ngày tới",
  slaBreached: "Việc trễ SLA (chưa xong)",
  slaWarn: "Việc sắp trễ SLA",
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

/** A server message in Vietnamese is shown as it is; anything else ("Not Found") is not a sentence for this page. */
function vietnameseOr(message: string, fallback: string): string {
  return /[àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]/i.test(message) ? message : fallback;
}

export default function ProgressReportView({
  tasks,
  focusReportId,
  canGenerate,
  onOpenEdit,
  cacheScope,
  projectKey,
  refreshing,
  sla = null,
  users,
  meAccountId,
  onAssign,
  onUpdateTask,
  onSaveBaseline,
  onOpenResources,
  onOpenPersonLoad,
  nearLoad = null,
  pool = null,
  taskFilter,
}: Props) {
  const dialogs = useDialogs();
  // Where the page starts: the plan's filter, as far as the report can say it (reportScope.ts). Read once.
  const [start] = useState(() => scopeFromTaskFilter(taskFilter));
  // The last figures this tab showed for the scope it opens on, so reopening it paints at once.
  const [overview, setOverview] = useState<ProgressOverview | null>(
    () =>
      readViewCache<ProgressOverview>(
        cacheScope,
        "progress",
        overviewParams(todayIso(), { assignee: start.assignee || undefined, epic: start.epic || undefined, types: start.types })
      ) ?? null
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [shown, setShown] = useState<ProgressReport | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [drill, setDrill] = useState<Drill | null>(null);
  const [showReasons, setShowReasons] = useState(false);
  const [agileOpen, setAgileOpen] = useState(false);
  const agileRef = useRef<HTMLDivElement>(null);
  // What the dashboard is looking at. The AI report beside it is always the whole
  // project as of its own day; only the live figures follow these.
  const today = useMemo(() => todayIso(), []);
  const [asOf, setAsOf] = useState(today);
  const [assignee, setAssignee] = useState(start.assignee);
  const [epic, setEpic] = useState(start.epic);
  const [types, setTypes] = useState<Set<string>>(() => new Set(start.types));
  const [reloadTick, setReloadTick] = useState(0);
  const [comparing, setComparing] = useState(false);
  const calendar = useWorkCalendar();
  const scope = useMemo<ProgressScope>(
    () => ({ assignee: assignee || undefined, epic: epic || undefined, types: [...types] }),
    [assignee, epic, types]
  );
  const scoped = !!(assignee || epic || types.size > 0);

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  // Worked out over the whole plan (the critical path needs every edge), then cut to the scope on screen:
  // looking at one person, only the rows about their work — or their overload — are theirs to decide.
  const decisions = useMemo(() => {
    if (!overview) return [];
    const all = pulseDecisions(overview.metrics, tasks, users ?? [], todayIso(), calendar, nearLoad);
    if (!scoped) return all;
    const ids = scopedTaskIds(tasks, scope);
    return all.filter((d) =>
      d.kind === "overloaded" ? !scope.assignee || d.actions.some((a) => a.accountId === scope.assignee) : d.taskIds.some((id) => ids.has(id))
    );
  }, [overview, tasks, users, calendar, nearLoad, scoped, scope]);
  const critical = useMemo(() => computeCriticalPath(tasks), [tasks]);

  // Refetched whenever the workspace's tasks change — an edit in the Gantt or a
  // write from the assistant moves these numbers, and the live layer is only
  // worth having if it actually is live.
  useEffect(() => {
    if (refreshing) return;
    // Fetched ahead when the project opened (warmViews.ts) and nothing changed since: no second read of Jira.
    const params = overviewParams(asOf, scope);
    const showAhead = () => {
      if (reloadTick !== 0 || !isViewFresh(cacheScope, "progress", params)) return false;
      const ahead = readViewCache<ProgressOverview>(cacheScope, "progress", params);
      if (!ahead) return false;
      setOverview(ahead);
      setLoadError(null);
      return true;
    };
    let alive = true;
    const fetchNow = () =>
      api
        .getProgress(asOf, scope)
        .then((data) => {
          writeViewCache(cacheScope, "progress", params, data);
          if (!alive) return;
          setOverview(data);
          setLoadError(null);
        })
        .catch((e: Error) => alive && setLoadError(e.message));
    if (showAhead()) return;
    // Still on its way: wait for that answer rather than send the same request again.
    const pending = reloadTick === 0 ? warmInFlight(cacheScope, "progress", params) : null;
    if (pending) void pending.then(() => alive && !showAhead() && fetchNow());
    else void fetchNow();
    return () => {
      alive = false;
    };
  }, [tasks, asOf, scope, reloadTick, refreshing, cacheScope]);

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

  // Opened from the ⋯ menu: brought into view, since it is drawn at the foot of the page.
  useEffect(() => {
    if (agileOpen) agileRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [agileOpen]);

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
      const msg = vietnameseOr(e instanceof Error ? e.message : "", "Không phân tích được lúc này. Thử lại sau.");
      setGenError(msg);
      // A toast, not a strip pushed in above the figures.
      toast(msg, { tone: "error" });
    } finally {
      setGenerating(false);
    }
  }

  async function removeReport(id: string) {
    if (!(await dialogs.confirm({ message: "Xoá báo cáo này khỏi lịch sử? Không hoàn tác được.", tone: "danger" }))) return;
    try {
      await api.deleteProgressReport(id);
      setShown((s) => (s?.id === id ? null : s));
      // `latest` may have been the one deleted, so re-read rather than patch.
      setReloadTick((n) => n + 1);
    } catch (e) {
      toast(vietnameseOr(e instanceof Error ? e.message : "", "Không xoá được báo cáo."), { tone: "error" });
    }
  }

  /** A link that opens this report for anyone who can browse the project (see deepLink.ts). */
  async function copyLink(id: string) {
    const link = buildReportLink(window.location.origin, projectKey, id);
    try {
      await navigator.clipboard.writeText(link);
      toast("Đã sao chép liên kết. Người nhận cần có quyền xem dự án này trên Jira.", { tone: "success" });
    } catch {
      // No clipboard permission (or an insecure context): show it so it can still be copied by hand.
      await dialogs.prompt({ title: "Liên kết tới báo cáo này", initial: link });
    }
  }

  async function openReport(id: string) {
    try {
      setShown(await api.getProgressReport(id));
      setWarnings([]);
    } catch (e) {
      toast(vietnameseOr(e instanceof Error ? e.message : "", "Không mở được báo cáo."), { tone: "error" });
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
      <span key={id} className="pr-issue pr-issue-missing" title="Việc này không còn trong dự án">
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
          <Spinner block label="Đang tính tiến độ dự án" />
        </div>
      </div>
    );
  }

  const m = overview.metrics;
  const people = new Map<string, string>();
  const epics: Array<{ id: string; summary: string }> = [];
  const workTypes = new Set<string>();
  for (const t of tasks) {
    if (!isAssignableType(t.issueType)) {
      epics.push({ id: t.id, summary: t.summary });
      continue;
    }
    workTypes.add(t.issueType);
    if (t.assigneeAccountId) people.set(t.assigneeAccountId, t.assigneeName ?? t.assigneeAccountId);
  }
  const latestPoint = overview.history.at(-1) ?? null;
  // History points are whole-project, so the delta means nothing on a slice.
  const moved = !scoped && latestPoint && latestPoint.asOf !== m.asOf ? Math.round(m.actualPct - latestPoint.actualPct) : null;

  // The counts that open a list, in the order of how much they hurt. A zero is not drawn.
  const attention: Array<{ kind: Drill["kind"]; label: string; value: number; tone?: "risk" | "warn" }> = [
    { kind: "overdue", label: "quá hạn", value: m.counts.overdue, tone: "risk" },
    { kind: "slipped", label: "trễ baseline", value: m.counts.slipped, tone: "risk" },
    { kind: "notStarted", label: "đến ngày chưa làm", value: m.counts.notStarted, tone: "warn" },
    { kind: "dueSoon", label: "sắp đến hạn", value: m.counts.dueSoon ?? m.dueSoon.length, tone: "warn" },
    { kind: "unassigned", label: "chưa gán", value: m.counts.unassigned },
  ];
  // SLA is measured against the clock, not the report's date, so it only sits beside today's figures.
  // Counted with resolveDrill itself, so a count and the list it opens always agree.
  if (sla && m.asOf === today) {
    attention.splice(
      1,
      0,
      { kind: "slaBreached", label: "trễ SLA", value: resolveDrill({ kind: "slaBreached" }, tasks, m.asOf, scope, sla).rows.length, tone: "risk" },
      { kind: "slaWarn", label: "sắp trễ SLA", value: resolveDrill({ kind: "slaWarn" }, tasks, m.asOf, scope, sla).rows.length, tone: "warn" }
    );
  }

  // Which Epics have any dated work: without dates an Epic's plan is 0% by construction, which is not "chưa tới lịch".
  const datedEpics = datedPhases(tasks);
  // An Epic table only means something when there are Epics; "Ngoài Epic" alone would be the whole project again.
  const showEpics = m.phases.some((p) => p.id !== null);

  const meName = meAccountId ? (people.get(meAccountId) ?? users?.find((u) => u.accountId === meAccountId)?.displayName) : undefined;
  const scopeParts = [
    assignee ? (assignee === meAccountId ? "Của tôi" : assignee === "none" ? "Chưa gán" : (people.get(assignee) ?? "Một người")) : "",
    epic ? epic : "",
    types.size === 1 ? [...types][0] : types.size > 1 ? `${types.size} loại việc` : "",
  ].filter(Boolean);
  const reset = () => {
    setAssignee("");
    setEpic("");
    setTypes(new Set());
    setAsOf(today);
  };

  return (
    <div className={`progress-view${report || generating ? "" : " is-solo"}`}>
      <div className="pr-main">
        <div className="np-page">
          <header className="pr-header np-bar">
            <div className="np-bar-left">
              <Popover
                className={`np-pick np-scope${scoped ? " is-on" : ""}`}
                menuClassName="np-scope-menu"
                menuLabel="Phạm vi"
                title={start.note ?? undefined}
                label={
                  <>
                    <span className="np-pick-k">Phạm vi</span>
                    <span className="np-pick-v">{scopeParts.join(" · ") || "Cả dự án"}</span>
                  </>
                }
              >
                <ScopeOptions
                  heading="Người"
                  value={assignee}
                  onPick={setAssignee}
                  options={[
                    { value: "", label: "Cả nhóm" },
                    ...(meAccountId ? [{ value: meAccountId, label: meName ? `Của tôi · ${meName}` : "Của tôi" }] : []),
                    ...[...people]
                      .filter(([id]) => id !== meAccountId)
                      .sort((a, b) => a[1].localeCompare(b[1], "vi"))
                      .map(([id, name]) => ({ value: id, label: name })),
                    { value: "none", label: "Chưa gán" },
                  ]}
                />
                {epics.length > 0 && (
                  <ScopeOptions
                    heading="Epic"
                    value={epic}
                    onPick={setEpic}
                    options={[{ value: "", label: "Mọi Epic" }, ...epics.map((x) => ({ value: x.id, label: x.summary, key: x.id }))]}
                  />
                )}
                {workTypes.size > 1 && (
                  <div className="np-scope-group" role="group" aria-label="Loại việc">
                    <div className="menu-heading">Loại việc</div>
                    {[...workTypes]
                      .sort((a, b) => a.localeCompare(b, "vi"))
                      .map((v) => (
                        <label key={v} className="np-opt np-check">
                          <input
                            type="checkbox"
                            checked={types.has(v)}
                            onChange={() =>
                              setTypes((prev) => {
                                const next = new Set(prev);
                                if (next.has(v)) next.delete(v);
                                else next.add(v);
                                return next;
                              })
                            }
                          />
                          {v}
                        </label>
                      ))}
                  </div>
                )}
              </Popover>
              <Popover
                className={`np-pick np-date${asOf !== today ? " is-on" : ""}`}
                menuClassName="np-date-menu"
                menuLabel="Tính đến ngày"
                label={
                  <>
                    <span className="np-pick-k">Đến</span>
                    <span className="np-pick-v">{asOf === today ? "hôm nay" : fmtDate(asOf)}</span>
                  </>
                }
              >
                {({ close }) => (
                  <div className="np-date-body">
                    <DateField value={asOf} onChange={(v) => v && setAsOf(v)} ariaLabel="Tính đến ngày" />
                    {asOf !== today && (
                      <button
                        type="button"
                        className="text-btn"
                        onClick={() => {
                          setAsOf(today);
                          close();
                        }}
                      >
                        Về hôm nay
                      </button>
                    )}
                  </div>
                )}
              </Popover>
              {(scoped || asOf !== today) && (
                <button type="button" className="text-btn np-reset" onClick={reset}>
                  Đặt lại
                </button>
              )}
            </div>
            <div className="pr-header-tools">
              {/* No analysis yet: the offer is a button here, not a panel taking a third of the page. */}
              {canGenerate && !report && (
                <button className="pr-analyze" onClick={() => void generate()} disabled={generating}>
                  <span className="ai-tag">AI</span>
                  {generating ? "Đang phân tích…" : "Phân tích"}
                </button>
              )}
              <Popover className="np-more" role="menu" align="end" caret={false} menuLabel="Thêm" ariaLabel="Thêm" title="Thêm" label={<Icon name="more" size={16} />}>
                {({ close }) => (
                  <>
                    {overview.history.length >= 2 && (
                      <button type="button" role="menuitem" className="menu-item" onClick={() => {
                          close();
                          setComparing(true);
                        }}>
                        <span className="menu-item-text">So sánh các lần phân tích</span>
                      </button>
                    )}
                    {report && (
                      <button type="button" role="menuitem" className="menu-item" onClick={() => {
                          close();
                          void copyLink(report.id);
                        }}>
                        <Icon name="link" />
                        <span className="menu-item-text">Sao chép liên kết báo cáo</span>
                      </button>
                    )}
                    <button type="button" role="menuitem" className="menu-item" onClick={() => {
                        close();
                        setAgileOpen((v) => !v);
                      }}>
                      <Icon name="board" />
                      <span className="menu-item-text">{agileOpen ? "Ẩn báo cáo Agile" : "Báo cáo Agile"}</span>
                    </button>
                    <button type="button" role="menuitem" className="menu-item" onClick={() => {
                        close();
                        window.print();
                      }}>
                      <Icon name="print" />
                      <span className="menu-item-text">In</span>
                    </button>
                  </>
                )}
              </Popover>
            </div>
          </header>

          <Summary
            metrics={m}
            decisions={decisions}
            attention={attention}
            moved={moved}
            movedFrom={latestPoint?.asOf ?? null}
            showReasons={showReasons}
            onToggleReasons={() => setShowReasons((v) => !v)}
            onDrill={setDrill}
          />

          <Decisions
            decisions={decisions}
            tasks={tasks}
            users={users ?? []}
            meAccountId={meAccountId}
            pool={pool}
            today={today}
            onOpenEdit={onOpenEdit}
            onAssign={onAssign}
            onUpdateTask={onUpdateTask}
            onSaveBaseline={onSaveBaseline}
            onOpenResources={onOpenResources}
            onOpenPersonLoad={onOpenPersonLoad}
          />

          {showEpics && (
            <section className="np-section" aria-label="Theo Epic">
              <h2>Theo Epic</h2>
              <EpicTable phases={m.phases} dated={(id) => datedEpics.has(id)} onSelect={(id, label) => setDrill({ kind: "phase", id, label })} />
            </section>
          )}

          {m.people.length > 0 && (
            <section className="np-section" aria-label="Theo người">
              <h2>Theo người</h2>
              <PeopleTable people={m.people} load={nearLoad} onSelect={(accountId, label) => setDrill({ kind: "person", accountId, label })} />
            </section>
          )}

          {/* Two points draw a straight line and say nothing; from three a direction can be read. The trend is
              measured over the whole project, so it is not shown beside a slice of it. */}
          {!scoped && (overview.trend?.length ?? 0) >= 3 && (
            <section className="np-section" aria-label="Xu hướng theo ngày">
              <h2>Xu hướng theo ngày</h2>
              <ProgressTrendChart unit="ngày" points={overview.trend!.map((p) => ({ asOf: p.date, actualPct: p.actualPct, plannedPct: p.plannedPct }))} />
            </section>
          )}

          {overview.history.length > 0 && (
            <section className="np-section" aria-label="Các lần phân tích">
              <h2>
                Các lần phân tích <span className="ai-tag">AI</span>
              </h2>
              {overview.history.length >= 3 && <ProgressTrendChart points={overview.history} onSelect={openReport} />}
              <div className="pr-history">
                {[...overview.history].reverse().map((p) => (
                  <span key={p.id} className="pr-history-item">
                    <button className={`pr-history-chip ${report?.id === p.id ? "is-current" : ""}`} onClick={() => openReport(p.id)} title={p.headline}>
                      <span className={`pr-dot-status pr-dot-${p.health}`} aria-hidden="true" />
                      {short(p.asOf)}
                      <b>{pct(p.actualPct)}</b>
                    </button>
                    {canGenerate && (
                      <button className="pr-history-del" onClick={() => removeReport(p.id)} aria-label={`Xoá báo cáo ngày ${short(p.asOf)}`} title="Xoá báo cáo này">
                        ×
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </section>
          )}

          {agileOpen && (
            <div ref={agileRef} className="np-agile">
              <AgileReports cacheScope={cacheScope} projectKey={projectKey} issueLink={(key) => issueLink(key)} onClose={() => setAgileOpen(false)} />
            </div>
          )}
        </div>
      </div>

      <AiBrief
        key={report?.id ?? "none"}
        report={report}
        live={scoped || asOf !== today ? null : m}
        isLatest={report?.id === overview.latest?.id}
        warnings={warnings}
        canGenerate={canGenerate}
        generating={generating}
        error={genError}
        onGenerate={generate}
        issueLink={issueLink}
        onShowKeys={(keys, label) => setDrill({ kind: "keys", keys, label })}
      />

      {comparing && <ReportCompare history={overview.history} currentId={report?.id ?? null} onClose={() => setComparing(false)} />}

      {drill && (
        <TaskDrawer
          drill={drill}
          tasks={tasks}
          asOf={m.asOf}
          scope={scope}
          sla={sla}
          critical={critical}
          onClose={() => setDrill(null)}
          onOpenEdit={onOpenEdit}
        />
      )}
    </div>
  );
}

/** One radio list in the scope menu (people, Epics), scrolling on its own when long. */
function ScopeOptions({
  heading,
  value,
  options,
  onPick,
}: {
  heading: string;
  value: string;
  options: Array<{ value: string; label: string; key?: string }>;
  onPick: (value: string) => void;
}) {
  return (
    <div className="np-scope-group" role="radiogroup" aria-label={heading}>
      <div className="menu-heading">{heading}</div>
      <div className="np-scope-list">
        {options.map((o) => (
          <button
            key={o.value || "all"}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            className={`np-opt${value === o.value ? " is-on" : ""}`}
            onClick={() => onPick(o.value)}
          >
            <span className="np-opt-mark" aria-hidden="true">
              {value === o.value && <Icon name="check" size={14} />}
            </span>
            {o.key && <span className="np-key">{o.key}</span>}
            <span className="np-ellipsis">{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** The tasks the dashboard's scope covers (person, Epic, types), the narrowing resolveDrill applies. */
function scopedTaskIds(tasks: Task[], scope: ProgressScope): Set<string> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const epicOf = (t: Task): string | null => {
    let cursor = t.wbsParentId ? byId.get(t.wbsParentId) : undefined;
    for (let guard = 0; cursor && guard < 20; guard++) {
      if (!isAssignableType(cursor.issueType)) return cursor.id;
      cursor = cursor.wbsParentId ? byId.get(cursor.wbsParentId) : undefined;
    }
    return null;
  };
  return new Set(
    tasks
      .filter(
        (t) =>
          (!scope.assignee || (t.assigneeAccountId ?? "none") === scope.assignee) &&
          (!scope.epic || epicOf(t) === scope.epic) &&
          (!scope.types?.length || scope.types.includes(t.issueType))
      )
      .map((t) => t.id)
  );
}

/** Epic id → whether any work under it (or, for null, outside every Epic) has a start date. */
function datedPhases(tasks: Task[]): Set<string | null> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out = new Set<string | null>();
  for (const t of tasks) {
    if (!t.startDate || !isAssignableType(t.issueType)) continue;
    let cursor = t.wbsParentId ? byId.get(t.wbsParentId) : undefined;
    let epicId: string | null = null;
    for (let guard = 0; cursor && guard < 20; guard++) {
      if (!isAssignableType(cursor.issueType)) {
        epicId = cursor.id;
        break;
      }
      cursor = cursor.wbsParentId ? byId.get(cursor.wbsParentId) : undefined;
    }
    out.add(epicId);
  }
  return out;
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
  scope,
  sla,
  critical,
  onClose,
  onOpenEdit,
}: {
  drill: Drill;
  tasks: Task[];
  asOf: string;
  scope: ProgressScope;
  sla: SlaView | null;
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

  const { title, rows: all } = useMemo(() => resolveDrill(drill, tasks, asOf, scope, sla), [drill, tasks, asOf, scope, sla]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"urgency" | "due" | "assignee" | "key">("urgency");
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? all.filter((t) => `${t.id} ${t.summary} ${t.assigneeName ?? ""} ${t.statusName}`.toLowerCase().includes(q))
      : [...all];
    // "urgency" is the order resolveDrill already returned.
    if (sort === "due") list.sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
    else if (sort === "assignee") list.sort((a, b) => (a.assigneeName ?? "￿").localeCompare(b.assigneeName ?? "￿", "vi"));
    else if (sort === "key") list.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    return list;
  }, [all, query, sort]);

  function exportCsv() {
    downloadCsv(csvName("bao-cao", asOf), [
      ["Mã", "Tên việc", "Trạng thái", "Phụ trách", "Bắt đầu", "Hạn", "Hạn baseline", "% hoàn thành", "Đường găng"],
      ...rows.map((t) => [
        t.id,
        t.summary,
        t.statusName,
        t.assigneeName,
        t.startDate,
        t.dueDate,
        t.baselineDue,
        t.statusCategory === "done" ? 100 : t.percentComplete,
        critical.has(t.id) && t.statusCategory !== "done" ? "x" : "",
      ]),
    ]);
  }

  return (
    <div className="pr-drawer-backdrop" onClick={onClose}>
      <div className="pr-drawer" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="pr-drawer-head">
          <div>
            <b>{title}</b>
            <span className="pr-muted">
              {rows.length === all.length ? `${all.length} việc` : `${rows.length}/${all.length} việc`}
            </span>
          </div>
          <button className="pr-drawer-close" onClick={onClose} aria-label="Đóng">
            ✕
          </button>
        </div>
        <div className="pr-drawer-tools">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Tìm trong danh sách"
          />
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sắp xếp">
            <option value="urgency">Khẩn cấp trước</option>
            <option value="due">Theo hạn</option>
            <option value="assignee">Theo người</option>
            <option value="key">Theo mã</option>
          </select>
          <button className="text-btn" onClick={exportCsv} disabled={rows.length === 0}>
            Xuất CSV
          </button>
        </div>
        {rows.length === 0 ? (
          <p className="pr-muted pr-drawer-empty">{all.length > 0 ? "Không có việc nào khớp tìm kiếm." : "Không có việc nào."}</p>
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

function resolveDrill(drill: Drill, tasks: Task[], asOf: string, scope: ProgressScope, sla: SlaView | null = null): { title: string; rows: Task[] } {
  const byId = new Map(tasks.map((t) => [t.id, t]));

  if (drill.kind === "keys") {
    return {
      title: drill.label,
      rows: drill.keys.map((k) => byId.get(k)).filter((t): t is Task => !!t),
    };
  }

  const parentIds = new Set(tasks.map((t) => t.wbsParentId).filter((p): p is string => !!p));

  const epicOf = (t: Task): string | null => {
    let cursor = t.wbsParentId ? byId.get(t.wbsParentId) : undefined;
    for (let guard = 0; cursor && guard < 20; guard++) {
      if (!isAssignableType(cursor.issueType)) return cursor.id;
      cursor = cursor.wbsParentId ? byId.get(cursor.wbsParentId) : undefined;
    }
    return null;
  };

  const inScope = (t: Task) => {
    if (scope.assignee && (t.assigneeAccountId ?? "none") !== scope.assignee) return false;
    if (scope.epic && epicOf(t) !== scope.epic) return false;
    if (scope.types && scope.types.length > 0 && !scope.types.includes(t.issueType)) return false;
    return true;
  };

  // SLA is per issue, whatever its place in the WBS — a Story with sub-tasks has its own
  // deadline — so it skips the leaf test and lists the same issues the Gantt's "Trễ SLA"
  // button does (within the dashboard's scope), most late first.
  if (drill.kind === "slaBreached" || drill.kind === "slaWarn") {
    const state = drill.kind === "slaBreached" ? "breached" : "warn";
    const rows = sla ? tasks.filter((t) => sla.byId.get(t.id)?.state === state && inScope(t)) : [];
    const left = (t: Task) => sla?.byId.get(t.id)?.remainingMs ?? 0;
    return { title: DRILL_TITLE[drill.kind], rows: rows.sort((a, b) => left(a) - left(b)) };
  }

  // The same narrowing server/src/progress.ts applies, after the leaf test, so a
  // drawer opened from a filtered dashboard lists exactly the tasks counted there.
  const work = tasks.filter((t) => isAssignableType(t.issueType) && !parentIds.has(t.id) && inScope(t));
  const open = work.filter((t) => t.statusCategory !== "done");
  const weekAhead = new Date(toUtc(asOf) + 7 * 86_400_000).toISOString().slice(0, 10);

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

/**
 * The top of "Nhịp dự án": the verdict and the forecast in one line, one bar (done as the fill, the plan as
 * a tick), the figures under it once, "Vì sao?" for the reasons, then the counts that open a list. Built by
 * code from the measured figures (projectPulse.ts), never the model, so it is always there and always
 * agrees with the tables under it.
 */
function Summary({
  metrics: m,
  decisions,
  attention,
  moved,
  movedFrom,
  showReasons,
  onToggleReasons,
  onDrill,
}: {
  metrics: ProgressMetrics;
  decisions: PulseDecision[];
  attention: Array<{ kind: Drill["kind"]; label: string; value: number; tone?: "risk" | "warn" }>;
  /** Points moved since the last saved analysis, and its date; null when there is none or the page is a slice. */
  moved: number | null;
  movedFrom: string | null;
  showReasons: boolean;
  onToggleReasons: () => void;
  onDrill: (d: Drill) => void;
}) {
  // "Vì sao?" leaves out a cause that is already one of the rows below it.
  const head = useMemo(() => pulseHeadline(m, decisions), [m, decisions]);
  const verdictClass = head.verdict === "bad" ? "is-bad" : head.verdict === "watch" ? "is-watch" : "is-good";
  const states: WorkState[] = ["done", "inProgress", "todo"];
  const stateCount: Record<WorkState, number> = { done: m.counts.done, inProgress: m.counts.inProgress, todo: m.counts.todo };
  const remaining = m.schedule.daysRemaining;
  const counts = attention.filter((a) => a.value > 0);

  return (
    <section className="pulse np-summary" aria-label="Report">
      <p className="pulse-lead">
        <span className={`np-verdict ${verdictClass}`}>{head.lead}</span>
        {head.forecast && <span className="np-forecast">{head.forecast}</span>}
      </p>
      {m.counts.total > 0 && (
        <>
          <ProgressLine actual={m.actualPct} planned={m.plannedPct} />
          <div className="np-meta">
            <span>
              Đã xong <b>{pct(m.actualPct)}</b>
              <span className="np-sep">·</span>kế hoạch đến nay {pct(m.plannedPct)}
              {remaining !== null && remaining > 0 && (
                <>
                  <span className="np-sep">·</span>còn {remaining} ngày
                </>
              )}
              {moved !== null && moved !== 0 && movedFrom && (
                <>
                  <span className="np-sep">·</span>
                  {moved > 0 ? "+" : ""}
                  {moved} điểm từ {short(movedFrom)}
                </>
              )}
            </span>
            {head.reasons.length > 0 && (
              <button type="button" className="text-btn np-why" aria-expanded={showReasons} onClick={onToggleReasons}>
                {showReasons ? "Ẩn lý do" : "Vì sao?"}
              </button>
            )}
          </div>
          {showReasons && (
            <ul className="pulse-reasons">
              {head.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
          <div className="np-facts">
            <span className="np-facts-group">
              <span className="np-total">{m.counts.total} việc</span>
              {states.map(
                (k) =>
                  stateCount[k] > 0 && (
                    <button key={k} type="button" className="np-fact" onClick={() => onDrill({ kind: "state", state: k })}>
                      <b>{stateCount[k]}</b> {STATE_LABEL[k]}
                    </button>
                  )
              )}
              {m.counts.undated > 0 && (
                <button type="button" className="np-fact is-quiet" title="Không được tính vào %" onClick={() => onDrill({ kind: "undated" })}>
                  <b>{m.counts.undated}</b> chưa có ngày
                </button>
              )}
            </span>
            {counts.length > 0 && (
              <span className="np-facts-group">
                {counts.map((a) => (
                  <button
                    key={a.kind}
                    type="button"
                    className={`np-fact pr-tile${a.tone ? ` is-${a.tone}` : ""}`}
                    onClick={() => onDrill({ kind: a.kind } as Drill)}
                  >
                    <b>{a.value}</b> {a.label}
                  </button>
                ))}
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** "DEMO-3 trễ 1 ngày" with the key as a link to the task. */
function withKeys(text: string, open: (id: string) => void, known: (id: string) => boolean): ReactNode[] {
  return text.split(/([A-Z][A-Z0-9]+-\d+)/).map((part, i) =>
    i % 2 === 1 && known(part) ? (
      <button key={i} type="button" className="np-keylink" onClick={() => open(part)}>
        {part}
      </button>
    ) : (
      part
    )
  );
}

/**
 * "Cần bạn quyết": at most three things only a person can decide, each a line with its actions at the end.
 * The actions do the thing (a new due date, another person, a baseline) rather than open a task and leave
 * the reader to find the field; a row that is dealt with drops out because the figures under it change.
 */
function Decisions({
  decisions,
  tasks,
  users,
  meAccountId,
  pool,
  today,
  onOpenEdit,
  onAssign,
  onUpdateTask,
  onSaveBaseline,
  onOpenResources,
  onOpenPersonLoad,
}: {
  decisions: PulseDecision[];
  tasks: Task[];
  users: JiraUser[];
  meAccountId?: string;
  pool: ReportPool | null;
  today: string;
  onOpenEdit: (task: Task) => void;
  onAssign?: (taskId: string, accountId: string) => Promise<void>;
  onUpdateTask?: (taskId: string, patch: TaskUpdateInput) => Promise<void>;
  onSaveBaseline?: (taskIds: string[]) => Promise<void>;
  onOpenResources?: () => void;
  onOpenPersonLoad?: (accountId: string, date?: string) => void;
}) {
  const calendar = useWorkCalendar();
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const [picking, setPicking] = useState<{ taskId: string; anchor: DOMRect } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const pickTask = picking ? byId.get(picking.taskId) : undefined;
  // The picker's "rảnh / trùng n ngày" is measured inside the task's own dates, like everywhere else.
  const pickLoad = useMemo(() => {
    if (!pickTask?.startDate) return null;
    const to = pickTask.dueDate && pickTask.dueDate >= pickTask.startDate ? pickTask.dueDate : pickTask.startDate;
    return buildResourceLoad({
      tasks,
      users,
      profiles: pool?.profiles ?? [],
      absences: pool?.absences ?? [],
      defaultCapacityHours: pool?.defaultCapacityHours,
      from: pickTask.startDate,
      to,
      includeIdle: true,
      calendar,
    });
  }, [pickTask, tasks, users, pool, calendar]);

  if (decisions.length === 0) return null;
  const open = (id: string) => {
    const t = byId.get(id);
    if (t) onOpenEdit(t);
  };

  async function assign(taskId: string, accountId: string) {
    if (!onAssign) return;
    try {
      await onAssign(taskId, accountId);
      const name = users.find((u) => u.accountId === accountId)?.displayName;
      toast(`Đã giao ${taskId}${name ? ` cho ${name}` : ""}.`, { tone: "success" });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Không giao được.", { tone: "error" });
    }
  }

  async function run(d: PulseDecision, a: PulseAction, target: HTMLElement) {
    const taskId = a.taskId ?? d.taskIds[0];
    switch (a.kind) {
      case "assign":
        if (a.taskId && a.suggestedAccountId) await assign(a.taskId, a.suggestedAccountId);
        return;
      case "reassign":
      case "pick":
        if (taskId) setPicking({ taskId, anchor: target.getBoundingClientRect() });
        return;
      case "rebalance":
        if (a.accountId && onOpenPersonLoad) onOpenPersonLoad(a.accountId, a.date);
        else onOpenResources?.();
        return;
      case "set-baseline": {
        if (!onSaveBaseline) return;
        setBusy(d.kind);
        try {
          await onSaveBaseline(d.taskIds);
        } finally {
          setBusy(null);
        }
        return;
      }
      default:
        if (taskId) open(taskId);
    }
  }

  return (
    <section className="np-section np-decide" aria-label="Cần bạn quyết">
      <h2>
        Cần bạn quyết <span className="np-count">{decisions.length}</span>
      </h2>
      <ul className="pulse-decisions">
        {decisions.map((d) => {
          const severe = d.kind === "late-blocking" || d.kind === "unassigned-critical";
          return (
            <li key={`${d.kind}:${d.taskIds.join(",")}`} className={`pulse-row ${severe ? "is-bad" : "is-watch"}`}>
              <div className="pulse-row-text">
                <h3>{withKeys(d.title, open, (id) => byId.has(id))}</h3>
                <p>{withKeys(d.body, open, (id) => byId.has(id))}</p>
              </div>
              <div className="pulse-actions">
                {d.actions.map((a, i) => {
                  const main = i === d.actions.length - 1;
                  const task = a.taskId ? byId.get(a.taskId) : undefined;
                  if (a.kind === "reschedule") {
                    if (!task || !onUpdateTask) return null;
                    return <RescheduleButton key={a.kind} task={task} today={today} main={main} onSave={onUpdateTask} />;
                  }
                  if ((a.kind === "reassign" || a.kind === "pick" || a.kind === "assign") && !onAssign) return null;
                  if (a.kind === "set-baseline" && !onSaveBaseline) return null;
                  return (
                    <button
                      key={`${a.kind}:${i}`}
                      type="button"
                      className={main ? "np-act is-main" : "np-act"}
                      disabled={busy === d.kind}
                      title={a.taskId && a.kind !== "assign" ? `${a.label} ${a.taskId}` : undefined}
                      onClick={(e) => void run(d, a, e.currentTarget)}
                    >
                      {a.label}
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
      {picking && pickTask && (
        <PersonPicker
          anchor={picking.anchor}
          people={users}
          task={pickTask}
          load={pickLoad}
          calendar={calendar}
          currentAccountId={pickTask.assigneeAccountId}
          meAccountId={meAccountId}
          allowUnassign={false}
          onPick={(id) => {
            const taskId = picking.taskId;
            setPicking(null);
            if (id && id !== pickTask.assigneeAccountId) void assign(taskId, id);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </section>
  );
}

/** "Dời hạn": a new due date for one task, with tomorrow / +3 / +7 as one click. The start stays. */
function RescheduleButton({
  task,
  today,
  main,
  onSave,
}: {
  task: Task;
  today: string;
  main: boolean;
  onSave: (taskId: string, patch: TaskUpdateInput) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => addDays(today, 1));
  const [saving, setSaving] = useState(false);
  const quick: Array<[string, number]> = [
    ["Mai", 1],
    ["+3 ngày", 3],
    ["+1 tuần", 7],
  ];

  async function save(close: () => void) {
    const next = changeSchedule(scheduleOf(task.startDate, task.durationDays), "due", draft);
    if (next.rejected) {
      toast(
        next.rejected === "due-before-start" && task.startDate
          ? `Hạn mới không được trước ngày bắt đầu (${formatDayMonth(task.startDate, today)}).`
          : "Ngày chưa hợp lệ.",
        { tone: "error" }
      );
      return;
    }
    setSaving(true);
    try {
      await onSave(task.id, { startDate: next.start, durationDays: next.durationDays });
      close();
      toast(`Đã dời hạn ${task.id} sang ${formatDayMonth(draft, today)}.`, { tone: "success" });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Không dời được hạn.", { tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover
      className={main ? "np-act is-main" : "np-act"}
      caret={false}
      align="end"
      menuLabel={`Dời hạn ${task.id}`}
      menuClassName="np-resched"
      title={`Dời hạn ${task.id}`}
      label="Dời hạn"
    >
      {({ close }) => (
        <form
          className="np-resched-body"
          onSubmit={(e) => {
            e.preventDefault();
            void save(close);
          }}
        >
          <div className="menu-heading">
            Hạn mới cho {task.id}
            {task.dueDate && <span className="np-muted"> · đang là {formatDayMonth(task.dueDate, today)}</span>}
          </div>
          <div className="np-resched-quick">
            {quick.map(([label, n]) => (
              <button key={n} type="button" className={draft === addDays(today, n) ? "is-on" : ""} onClick={() => setDraft(addDays(today, n))}>
                {label}
              </button>
            ))}
          </div>
          <DateField value={draft} onChange={(v) => v && setDraft(v)} ariaLabel="Hạn mới" />
          <button type="submit" className="primary" disabled={saving || !draft || draft === task.dueDate}>
            {saving ? "Đang dời…" : "Dời hạn"}
          </button>
        </form>
      )}
    </Popover>
  );
}
