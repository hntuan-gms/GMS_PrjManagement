import { useCallback, useMemo, useState } from "react";
import { csvName, downloadCsv } from "../csv";
import { localToday, roundHours } from "../taskForm";
import type { Session, Task } from "../types";
import { addDays, dm, eachDay, rangeOf, type TimesheetMode } from "../timesheetRange";
import { viewCacheScope } from "../viewCache";
import { buildTeamRows, filterTeam, fmtHours, teamCounts, type TeamFilter } from "../timesheetModel";
import { useTimesheet } from "../useTimesheet";
import { Icon } from "./Icons";
import Metric, { MetricRow } from "./Metric";
import Spinner from "./Spinner";
import TimesheetMine from "./TimesheetMine";
import TimesheetTeam from "./TimesheetTeam";
import { useWorkCalendar } from "./workCalendarContext";

/**
 * Clockwork: the hours logged in Jira, per day, against capacity and against what was booked.
 *
 * A place on the rail, so it is a person across projects: "Của tôi" is my hours on every project,
 * "Cả nhóm" the projects I manage (project and resource managers only; server/src/routes/clockwork.ts).
 *
 * Everything here is Jira's worklogs (server/src/timesheet.ts) and logging here is logging in Jira, under the
 * signed-in user's name — the only author Jira accepts. So the page has two faces:
 *   Của tôi   — the grid you fill in: task × day, each cell a field (TimesheetMine).
 *   Cả nhóm   — who has logged and who is behind, read-only (TimesheetTeam).
 * Capacity and leave come from the Mức tải lens's profiles (8h by default); which days are worked comes from the
 * project's calendar (a holiday expects nothing, a make-up day expects a day's work).
 */

type Scope = "mine" | "team";

const scopeKey = (session: Session) => `gms.ts.scope.${session.site.cloudId}.${session.project?.key ?? ""}`;
function readScope(session: Session): Scope {
  try {
    return localStorage.getItem(scopeKey(session)) === "team" ? "team" : "mine";
  } catch {
    return "mine";
  }
}

export default function TimesheetView({
  session,
  tasks,
  onOpenEdit,
  onTasksChanged,
}: {
  session: Session;
  tasks: Task[];
  onOpenEdit: (task: Task) => void;
  onTasksChanged: () => void;
}) {
  const today = localToday();
  const calendar = useWorkCalendar();
  const me = session.user.accountId;
  const [scope, setScopeState] = useState<Scope>(() => readScope(session));
  const [mode, setMode] = useState<TimesheetMode>("week");
  const [anchor, setAnchor] = useState(today);
  const { from, to } = rangeOf(mode, anchor);
  const range = `${from}|${to}`;
  const month = mode === "month";
  const [text, setText] = useState("");
  const [teamProject, setTeamProject] = useState<string | null>(null);
  const [teamFilter, setTeamFilter] = useState<TeamFilter>("all");
  const [focusDate, setFocusDate] = useState<string | null>(null);

  const setScope = (s: Scope) => {
    setScopeState(s);
    try {
      localStorage.setItem(scopeKey(session), s);
    } catch {
      /* private window: the choice just is not remembered */
    }
  };

  const cacheScope = viewCacheScope(session.site.cloudId, me, session.project?.key ?? "");
  // My own hours are always read (they are what is typed into, and they say whether a team view is offered);
  // the team's only when that face is showing.
  const mine = useTimesheet({ from, to, cacheScope, me, meName: session.user.displayName, onTasksChanged });
  const mayTeam = (mine.sheet?.role ?? "member") !== "member";
  const scopeShown: Scope = scope === "team" && mine.sheet && !mayTeam ? "mine" : scope;
  const team = useTimesheet({ from, to, cacheScope, me, meName: session.user.displayName, onTasksChanged, source: "team", project: teamProject, skip: scopeShown !== "team" || !mayTeam });
  const { sheet, loading, error } = scopeShown === "team" ? team : mine;
  const ops = mine.ops;
  const days = useMemo(() => eachDay(from, to), [from, to]);

  const allRows = useMemo(
    () => (sheet ? buildTeamRows({ people: sheet.people, entries: sheet.entries, days, today, calendar, me, bookings: sheet.bookings }) : []),
    [sheet, days, today, calendar, me]
  );
  const managed = team.sheet?.managed ?? [];
  const counts = useMemo(() => teamCounts(allRows), [allRows]);
  const teamRows = useMemo(() => filterTeam(allRows, text, teamFilter), [allRows, text, teamFilter]);
  const logged = useMemo(() => roundHours(allRows.reduce((s, r) => s + r.total, 0)), [allRows]);

  function shift(dir: -1 | 1) {
    if (mode === "week") setAnchor(addDays(from, dir * 7));
    else {
      const d = new Date(from + "T00:00:00Z");
      d.setUTCMonth(d.getUTCMonth() + dir);
      setAnchor(d.toISOString().slice(0, 10));
    }
  }

  function exportCsv() {
    const header = ["Thành viên", ...days, "Tổng (giờ)", "Kỳ vọng (giờ)", "Book (giờ)"];
    const rows = (scopeShown === "team" ? teamRows : allRows).map((r) => [
      r.person.displayName,
      ...days.map((d) => roundHours(r.hoursByDay.get(d) ?? 0)),
      r.total,
      r.expected,
      r.booked,
    ]);
    downloadCsv(csvName("cham-cong", from), [header, ...rows]);
  }

  const onFocusDone = useCallback(() => setFocusDate(null), []);
  const rangeLabel = month ? `Tháng ${Number(from.slice(5, 7))}/${from.slice(0, 4)}` : `${dm(from)} – ${dm(to)}/${to.slice(0, 4)}`;
  const includesToday = today >= from && today <= to;

  return (
    <div className="ts-wrap">
      <div className="tf-bar ts-toolbar">
        <div className="seg-group" role="tablist" aria-label="Phạm vi">
          <button role="tab" data-scope="mine" aria-selected={scopeShown === "mine"} className={scopeShown === "mine" ? "active" : ""} onClick={() => setScope("mine")}>
            Của tôi
          </button>
          {mayTeam && (
            <button role="tab" data-scope="team" title="Chỉ xem. Jira chỉ cho mỗi người tự ghi giờ của mình" aria-selected={scopeShown === "team"} className={scopeShown === "team" ? "active" : ""} onClick={() => setScope("team")}>
              Cả nhóm
            </button>
          )}
        </div>
        <div className="seg-group" role="group" aria-label="Độ dài kỳ">
          <button className={mode === "week" ? "active" : ""} onClick={() => setMode("week")}>Tuần</button>
          <button className={mode === "month" ? "active" : ""} onClick={() => setMode("month")}>Tháng</button>
        </div>
        <button className="tb-btn ts-nav" onClick={() => shift(-1)} aria-label="Kỳ trước">
          <Icon name="chevronLeft" size={14} />
        </button>
        <b className="ts-range">{rangeLabel}</b>
        <button className="tb-btn ts-nav" onClick={() => shift(1)} aria-label="Kỳ sau">
          <Icon name="chevronRight" size={14} />
        </button>
        <button className="tb-btn" onClick={() => setAnchor(today)} disabled={includesToday} title="Về kỳ chứa hôm nay">
          Hôm nay
        </button>
        {scopeShown === "team" && (
          <>
            <div className="tf-search ts-member-search">
              <Icon name="search" size={14} className="tf-search-icon" />
              <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search people" aria-label="Tìm thành viên" />
            </div>
            {managed.length > 1 && (
              <select className="ts-team-project" value={teamProject ?? ""} onChange={(e) => setTeamProject(e.target.value || null)} aria-label="Dự án">
                <option value="">Mọi dự án</option>
                {managed.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.key}
                  </option>
                ))}
              </select>
            )}
          </>
        )}
        <span className="bd-spacer" />
        {loading && sheet && <span className="bd-muted">Đang tải từ Jira…</span>}
        <button className="tb-btn" onClick={exportCsv} disabled={!sheet || allRows.length === 0} title="Tải bảng chấm công về file CSV mở được bằng Excel">
          Xuất CSV
        </button>
      </div>

      <div className="ts-body">
        {error && (
          <div className="notice notice-error">
            <span>{error}</span>
          </div>
        )}
        {!sheet && !error && <Spinner block label="Đang tải giờ đã ghi" />}

        {sheet && scopeShown === "mine" && (
          <TimesheetMine
            sheet={sheet}
            homeProject={session.project?.key ?? null}
            days={days}
            month={month}
            today={today}
            me={me}
            tasks={tasks}
            ops={ops}
            focusDate={focusDate}
            onFocusDone={onFocusDone}
            onOpenTask={onOpenEdit}
            rangeKey={range}
          />
        )}

        {sheet && scopeShown === "team" && (
          <>
            <MetricRow className="ts-tiles">
              <Metric value={`${fmtHours(logged)}h`} label="Cả nhóm đã ghi" />
              {counts.missing > 0 && (
                <Metric
                  value={counts.missing}
                  label="người còn ngày chưa ghi"
                  tone="warn"
                  className={`ts-tile-missing${teamFilter === "missing" ? " is-on" : ""}`}
                  title={teamFilter === "missing" ? "Xem tất cả" : "Chỉ xem người còn thiếu"}
                  onClick={() => setTeamFilter(teamFilter === "missing" ? "all" : "missing")}
                />
              )}
              {counts.overDays > 0 && (
                <Metric
                  value={counts.overDays}
                  label="ngày-người vượt công suất"
                  tone="serious"
                  className={`ts-tile-over${teamFilter === "over" ? " is-on" : ""}`}
                  title={teamFilter === "over" ? "Xem tất cả" : "Chỉ xem người vượt"}
                  onClick={() => setTeamFilter(teamFilter === "over" ? "all" : "over")}
                />
              )}
              {counts.off > 0 && (
                <Metric
                  value={counts.off}
                  label="người lệch booking"
                  tone="warn"
                  className={`ts-tile-off${teamFilter === "off" ? " is-on" : ""}`}
                  title={teamFilter === "off" ? "Xem tất cả" : "Giờ đã ghi khác giờ được book quá 20%"}
                  onClick={() => setTeamFilter(teamFilter === "off" ? "all" : "off")}
                />
              )}
            </MetricRow>
            <TimesheetTeam
              sheet={sheet}
              rows={teamRows}
              days={days}
              month={month}
              today={today}
              me={me}
              tasks={tasks}
              onOpenTask={onOpenEdit}
              onEditMine={(d) => {
                setScope("mine");
                setFocusDate(d);
              }}
            />
          </>
        )}

        {sheet && (
          <div className="ts-legend">
            <span><i className="ts-sw-tint" /> đậm dần theo số giờ trong ngày</span>
            <span><i className="ts-sw-over" />▲ vượt công suất</span>
            <span><i className="ts-sw-away" /> nghỉ phép</span>
            <span><i className="ts-sw-off" /> ngày nghỉ của dự án</span>
          </div>
        )}
      </div>
    </div>
  );
}
