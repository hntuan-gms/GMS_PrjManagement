import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  autoGranularity,
  buildResourceLoad,
  defaultWindow,
  shiftWindow,
  todayIso,
  type Granularity,
} from "../resourceAllocation";
import {
  columnSpans,
  currentPreset,
  filterPeople,
  pct,
  peopleCounts,
  RANGE_PRESETS,
  rangeForPreset,
  type PeopleView,
  type RangePresetId,
} from "../resourceColumns";
import { formatDate, monthLabel, scrubExtent, unionWindow, type DateWindow, type MonthLabel } from "../resourceTimeline";
import type { JiraUser, ResourceAbsence, ResourceProfile, ResourcePool, Task } from "../types";
import { csvName, downloadCsv } from "../csv";
import { buildEpicIndex, isTaskFiltering, matchesTaskFilter, type TaskFilter } from "../taskFilter";
import FilterBar from "./FilterBar";
import { Icon } from "./Icons";
import InfoTip from "./InfoTip";
import Popover from "./Popover";
import ResourcePersonBlock from "./ResourcePersonBlock";
import ResourceProfileDrawer from "./ResourceProfileDrawer";
import ResourceScrubber from "./ResourceScrubber";
import ResourceUnassigned, { type DragState } from "./ResourceUnassigned";
import SavedFilterMenu from "./SavedFilterMenu";
import SkillMatrixView from "./SkillMatrixView";

interface Props {
  tasks: Task[];
  users: JiraUser[];
  /** Capacity and absences, fetched once by the workspace. null while loading. */
  pool: ResourcePool | null;
  poolError: string | null;
  onPoolChange: (next: ResourcePool) => void;
  /** null as accountId means "take it off whoever holds it". */
  onAssign: (taskId: string, accountId: string | null) => void;
  onOpenEdit: (task: Task) => void;
  /** Shared with the Gantt. Its `people` and `text` facets are ignored here. */
  filter: TaskFilter;
  onFilterChange: (f: TaskFilter) => void;
  myAccountId: string;
  /** Issue keys Jira returned for the filter's JQL (null until they arrive). */
  jqlKeys?: Set<string> | null;
}

/** Sentinel for the "remove from whoever holds it" drop zone. */
const UNASSIGNED_ZONE = "__unassigned__";

const GRANULARITIES: Array<{ value: Granularity | "auto"; label: string }> = [
  { value: "auto", label: "Tự động" },
  { value: "day", label: "Ngày" },
  { value: "week", label: "Tuần" },
  { value: "month", label: "Tháng" },
];

const LEGEND: Array<{ band: string; short: string; title: string }> = [
  { band: "light", short: "<50%", title: "Nhẹ tải: dưới 50% công suất — còn chỗ nhận thêm việc" },
  { band: "healthy", short: "50–100%", title: "Hợp lý: từ 50% đến 100% công suất" },
  { band: "over", short: ">100%", title: "Quá tải: trên 100% công suất" },
  {
    band: "off",
    short: "Ngày nghỉ",
    title: "Cuối tuần hoặc ngày nghỉ phép (sọc xám). Sọc đỏ: có việc bị xếp vào ngày nghỉ — không ai làm được. Ô trống: chưa có việc.",
  },
];

/**
 * The resource tab: who is overloaded, when, and by how much.
 *
 * Load is computed here from tasks the workspace already holds (see
 * resourceAllocation.ts), so dragging a bar in the Gantt recolours this tab on
 * the same render rather than after a round trip. Only the two things Jira has
 * no field for — capacity and absence — are fetched.
 *
 * Two rows of chrome and then the table: the toolbar (view, search, filters, window, columns,
 * export) and the KPI pills, which are also the people filter. A person opens *inside* the
 * table (their tasks on the same date columns); what is edited about them — role, hours, leave,
 * skills — is a slide-over; work nobody owns is a floating card, closed until asked for.
 */
export default function ResourceView({
  tasks,
  users,
  pool,
  poolError,
  onPoolChange,
  onAssign,
  onOpenEdit,
  filter,
  jqlKeys,
  onFilterChange,
  myAccountId,
}: Props) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [profileId, setProfileId] = useState<string | null>(null);
  // Everyone on the project by default. Showing only people who already hold
  // dated work makes the tab go blank on a project nobody has assigned yet,
  // which reads as "broken" rather than as "nothing is assigned" — and the
  // whole point of a resource tab is to see who is free.
  const [peopleView, setPeopleView] = useState<PeopleView>("all");
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [unassignedOpen, setUnassignedOpen] = useState(false);
  // The heatmap (load over time) or the skills matrix (who can do what): two views of the same people.
  const [mode, setMode] = useState<"load" | "skills">("load");
  const [granularityChoice, setGranularityChoice] = useState<Granularity | "auto">("auto");
  const unassignedBtn = useRef<HTMLButtonElement>(null);
  const unassignedId = useId();

  const today = useMemo(() => todayIso(), []);

  // The window follows the project until the user touches it, then stops —
  // otherwise every drag that extends the plan would yank the view they are
  // reading out from under them.
  const span = useMemo(() => range ?? defaultWindow(tasks, today), [range, tasks, today]);

  // What the slider's track covers. It only ever grows: if exact dates typed in the menu land outside
  // the project, the track stretches to hold them — but must not shrink back while the thumb is being
  // dragged, or the ground would move under the pointer.
  const [reach, setReach] = useState<DateWindow | null>(null);
  const natural = useMemo(() => scrubExtent(tasks, today, { from: today, to: today }), [tasks, today]);
  const extent = unionWindow(natural, reach);
  if (span.from < extent.from || span.to > extent.to) setReach(unionWindow(extent, span));

  // The heatmap has its own member search, and a person picked on the Gantt would
  // blank everyone else's rows here — so only the task facets apply.
  const taskFacets = useMemo<TaskFilter>(() => ({ ...filter, text: "", people: new Set() }), [filter]);
  const filtering = isTaskFiltering(taskFacets);
  const filteredTasks = useMemo(() => {
    if (!filtering) return tasks;
    const ctx = { today, epicOf: buildEpicIndex(tasks), jqlKeys };
    return tasks.filter((t) => matchesTaskFilter(t, taskFacets, ctx));
  }, [tasks, taskFacets, filtering, today, jqlKeys]);

  // Always everyone: "Có việc" and "Đang quá tải" are pills over this list, not a different
  // computation, so the counts on the pills and the average beside them stay one set of numbers.
  const load = useMemo(
    () =>
      buildResourceLoad({
        tasks: filteredTasks,
        users,
        profiles: pool?.profiles ?? [],
        absences: pool?.absences ?? [],
        defaultCapacityHours: pool?.defaultCapacityHours,
        from: span.from,
        to: span.to,
        includeIdle: true,
      }),
    [filteredTasks, users, pool, span]
  );

  const granularity: Granularity = granularityChoice === "auto" ? autoGranularity(span.from, span.to) : granularityChoice;
  const spans = useMemo(() => columnSpans(load.dates, granularity), [load.dates, granularity]);
  const counts = useMemo(() => peopleCounts(load.people), [load.people]);
  const utilisation = load.people.length > 0 ? load.people.reduce((n, p) => n + p.utilisation, 0) / load.people.length : 0;

  const visiblePeople = useMemo(() => {
    const base = filterPeople(load.people, peopleView);
    const needle = query.trim().toLowerCase();
    if (!needle) return base;
    return base.filter(
      (p) => p.displayName.toLowerCase().includes(needle) || (p.role ?? "").toLowerCase().includes(needle)
    );
  }, [load.people, peopleView, query]);

  const profilePerson = load.people.find((p) => p.accountId === profileId) ?? null;

  // Everyone on the project, not just the rows on screen: with "Có việc" on,
  // the idle members are exactly who you would hand something to.
  const assignable = useMemo(
    () => users.map((u) => ({ accountId: u.accountId, displayName: u.displayName })),
    [users]
  );

  function exportCsv() {
    const header = ["Thành viên", "Vai trò", "Giờ/ngày", ...load.dates];
    const rows = visiblePeople.map((p) => [
      p.displayName,
      p.role,
      p.capacityHoursPerDay,
      ...p.days.map((d) => Math.round(d.allocatedHours * 10) / 10),
    ]);
    downloadCsv(csvName("nguon-luc", today), [header, ...rows]);
  }

  // One step earlier or later: a whole calendar month moves by month, anything else by its own length.
  function shiftRange(dir: -1 | 1) {
    setRange(shiftWindow(span, dir));
  }

  const skillSuggestions = useMemo(
    () => [...new Set((pool?.profiles ?? []).flatMap((p) => p.skills))].sort((a, b) => a.localeCompare(b, "vi")),
    [pool]
  );

  function applyPreset(id: RangePresetId) {
    setRange(rangeForPreset(id, span, today, tasks));
  }
  const activePreset = currentPreset(range, today, tasks);

  // Saves are applied to the cached pool rather than triggering a refetch: the
  // response is the authoritative row, and a round trip here would make the
  // heatmap flicker back to the old colour before settling.
  function upsertProfile(profile: ResourceProfile) {
    if (!pool) return;
    const others = pool.profiles.filter((p) => p.accountId !== profile.accountId);
    onPoolChange({ ...pool, profiles: [...others, profile] });
  }

  function replaceAbsence(absence: ResourceAbsence) {
    if (!pool) return;
    onPoolChange({ ...pool, absences: pool.absences.map((a) => (a.id === absence.id ? absence : a)) });
  }

  function addAbsence(absence: ResourceAbsence) {
    if (!pool) return;
    onPoolChange({ ...pool, absences: [...pool.absences, absence] });
  }

  function removeAbsence(id: string) {
    if (!pool) return;
    onPoolChange({ ...pool, absences: pool.absences.filter((a) => a.id !== id) });
  }

  function toggleExpanded(accountId: string) {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (!next.delete(accountId)) next.add(accountId);
      return next;
    });
  }

  function beginDrag(task: Task) {
    setDrag({ taskId: task.id, summary: task.summary, fromAccountId: task.assigneeAccountId });
  }

  function endDrag() {
    setDrag(null);
    setDropTarget(null);
  }

  /** A drop only counts when it would actually change who holds the task. */
  function canDropOn(accountId: string | null): boolean {
    return drag !== null && drag.fromAccountId !== accountId;
  }

  function dropOn(accountId: string | null) {
    if (drag && canDropOn(accountId)) onAssign(drag.taskId, accountId);
    endDrag();
  }

  const pills: Array<{ view: PeopleView; label: string; n: number; tone?: "danger" }> = [
    { view: "all", label: "Tất cả", n: counts.all },
    { view: "busy", label: "Có việc", n: counts.busy },
    { view: "over", label: "Đang quá tải", n: counts.over, tone: counts.over > 0 ? "danger" : undefined },
  ];

  return (
    <div className="resource-view" onDragEnd={endDrag}>
      <FilterBar
        tasks={tasks}
        filter={taskFacets}
        onChange={(f) => onFilterChange({ ...filter, ...f, text: filter.text, people: filter.people })}
        myAccountId={myAccountId}
        facets={["statuses", "types", "epics", "labels", "priorities", "overdue"]}
        matched={filteredTasks.length}
        total={tasks.length}
        leading={
          <>
            <div className="segmented-control rv-modes" role="tablist" aria-label="Kiểu xem nguồn lực">
              <button
                role="tab"
                aria-selected={mode === "load"}
                className={`segmented-btn ${mode === "load" ? "active" : ""}`}
                onClick={() => setMode("load")}
              >
                Mức tải
              </button>
              <button
                role="tab"
                aria-selected={mode === "skills"}
                className={`segmented-btn ${mode === "skills" ? "active" : ""}`}
                onClick={() => setMode("skills")}
              >
                Kỹ năng
              </button>
            </div>
            {mode === "load" && (
              <div className="tf-search rv-member-search">
                <Icon name="search" size={14} className="tf-search-icon" />
                <input
                  type="search"
                  className="rv-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setQuery("")}
                  placeholder="Tìm thành viên..."
                  aria-label="Tìm thành viên"
                />
              </div>
            )}
            {/* Applies the whole shared filter, people included, so the Gantt shows
                the same saved view when you switch back. */}
            <SavedFilterMenu filter={filter} onApply={onFilterChange} myAccountId={myAccountId} />
          </>
        }
        trailing={
          mode === "load" ? (
            <div className="rv-range">
              <button type="button" className="tb-btn tb-icon rv-step" onClick={() => shiftRange(-1)} aria-label="Kỳ trước" title="Kỳ trước">
                <Icon name="chevronLeft" />
              </button>
              <button type="button" className="tb-btn tb-icon rv-step" onClick={() => shiftRange(1)} aria-label="Kỳ sau" title="Kỳ sau">
                <Icon name="chevronRight" />
              </button>
              <ResourceScrubber extent={extent} span={span} today={today} onChange={setRange} />
              <Popover
                className="tf-btn rv-preset"
                align="end"
                menuLabel="Khoảng thời gian"
                menuClassName="rv-range-menu"
                title="Chọn nhanh một khoảng, hoặc nhập ngày chính xác"
                label={`Khoảng: ${RANGE_PRESETS.find((p) => p.id === activePreset)?.label ?? "Tuỳ chọn"}`}
              >
                {({ close }) => (
                  <>
                    {RANGE_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={activePreset === p.id}
                        className="menu-item rv-preset-item"
                        onClick={() => {
                          close();
                          applyPreset(p.id);
                        }}
                      >
                        <span className="rv-menu-check">{activePreset === p.id && <Icon name="check" size={14} />}</span>
                        {p.label}
                      </button>
                    ))}
                    <div className="menu-sep" role="separator" />
                    <div className="rv-exact">
                      <label>
                        <span>Từ</span>
                        <input
                          type="date"
                          value={span.from}
                          // Either end dragged past the other takes the other with it, rather than being refused.
                          onChange={(e) => e.target.value && setRange({ from: e.target.value, to: e.target.value > span.to ? e.target.value : span.to })}
                        />
                      </label>
                      <label>
                        <span>Đến</span>
                        <input
                          type="date"
                          value={span.to}
                          onChange={(e) => e.target.value && setRange({ from: e.target.value < span.from ? e.target.value : span.from, to: e.target.value })}
                        />
                      </label>
                    </div>
                  </>
                )}
              </Popover>
              <select
                className="rv-granularity"
                value={granularityChoice}
                onChange={(e) => setGranularityChoice(e.target.value as Granularity | "auto")}
                aria-label="Mỗi cột là"
                title={`Mỗi cột của bản đồ nhiệt là một ngày, tuần hay tháng${
                  granularityChoice === "auto" ? ` (đang tự chọn: ${{ day: "ngày", week: "tuần", month: "tháng" }[granularity]})` : ""
                }`}
              >
                {GRANULARITIES.map((g) => (
                  <option key={g.value} value={g.value}>
                    Cột: {g.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="tb-btn"
                onClick={exportCsv}
                aria-label="Xuất CSV"
                title="Tải giờ phân bổ từng người theo ngày về file CSV"
              >
                <Icon name="download" />
                <span className="tb-label">Xuất CSV</span>
              </button>
            </div>
          ) : undefined
        }
      />

      {mode === "skills" && <SkillMatrixView users={users} profiles={pool?.profiles ?? []} onProfileSaved={upsertProfile} />}
      {mode === "load" && filtering && (
        <div className="rv-notice">
          Đang lọc: mức tải bên dưới chỉ tính các công việc khớp bộ lọc, không phải toàn bộ khối lượng của mỗi người.
        </div>
      )}
      {mode === "load" && (
        <>
          <div className="rv-kpis">
            <div className="rv-pills" role="group" aria-label="Lọc thành viên">
              {pills.map((p) => (
                <button
                  key={p.view}
                  type="button"
                  className={`rv-pill${peopleView === p.view ? " is-on" : ""}${p.tone ? ` rv-pill-${p.tone}` : ""}`}
                  aria-pressed={peopleView === p.view}
                  onClick={() => setPeopleView(p.view)}
                >
                  {p.label} ({p.n})
                </button>
              ))}
            </div>
            <span className="rv-kpi-stat" title="Giờ đã giao chia cho giờ khả dụng, trung bình trên mọi thành viên trong khoảng đang xem">
              Hiệu suất TB: <b>{pct(utilisation)}</b>
            </span>
            <button
              ref={unassignedBtn}
              type="button"
              className={`rv-pill rv-pill-warn${unassignedOpen ? " is-on" : ""}${load.unassigned.length === 0 ? " is-empty" : ""}`}
              aria-expanded={unassignedOpen}
              aria-controls={unassignedId}
              onClick={() => setUnassignedOpen((v) => !v)}
              title="Danh sách việc chưa có người phụ trách — kéo một việc thả lên thành viên để gán"
            >
              <Icon name="alert" size={13} />
              {load.unassigned.length} công việc chưa gán
              <Icon name="chevronDown" size={12} className="rv-pill-caret" />
            </button>

            <div className="rv-legend" role="group" aria-label="Chú giải màu">
              {LEGEND.map((l) => (
                <span key={l.band} className="rv-legend-item" title={l.title}>
                  <i className={`rv-swatch band-${l.band}`} />
                  {l.short}
                </span>
              ))}
            </div>
          </div>

          {poolError && (
            <div className="rv-notice">
              Không tải được công suất và lịch nghỉ ({poolError}). Bản đồ nhiệt vẫn tính theo mặc định{" "}
              {pool?.defaultCapacityHours ?? 8} giờ/ngày.
            </div>
          )}

          {visiblePeople.length === 0 ? (
            <div className="empty-state">
              {load.people.length > 0
                ? peopleView === "all"
                  ? "Không có thành viên nào khớp."
                  : "Không có thành viên nào khớp. Chọn “Tất cả” để xem toàn bộ thành viên dự án."
                : pool === null
                  ? "Đang tải danh sách thành viên..."
                  : "Dự án này chưa có thành viên nào trên Jira, hoặc tài khoản của bạn không đọc được danh sách."}
            </div>
          ) : (
            <div className="rv-heatmap-scroll">
              <div className={`rv-grid ${granularity === "day" ? "rv-grid-day" : "rv-grid-week"}`} style={{ "--cols": spans.length } as React.CSSProperties}>
                <HeatmapHeader
                  spans={spans}
                  granularity={granularity}
                  today={today}
                  memberNote={<MemberSourceTip pool={pool} count={load.people.length} />}
                />
                {visiblePeople.map((person) => (
                  <ResourcePersonBlock
                    key={person.accountId}
                    person={person}
                    granularity={granularity}
                    today={today}
                    spans={spans}
                    expanded={expanded.has(person.accountId)}
                    onToggle={() => toggleExpanded(person.accountId)}
                    onOpenProfile={() => setProfileId(person.accountId)}
                    onOpenEdit={onOpenEdit}
                    members={assignable}
                    onAssign={onAssign}
                    onDragTask={beginDrag}
                    droppable={canDropOn(person.accountId)}
                    isDropTarget={dropTarget === person.accountId}
                    onDragOverPerson={() => setDropTarget(person.accountId)}
                    onDropOnPerson={() => dropOn(person.accountId)}
                  />
                ))}
              </div>
            </div>
          )}

          <ResourceUnassigned
            panelId={unassignedId}
            open={unassignedOpen}
            onClose={() => setUnassignedOpen(false)}
            anchorRef={unassignedBtn}
            tasks={load.unassigned}
            members={assignable}
            drag={drag}
            canDropUnassigned={canDropOn(null)}
            isDropTarget={dropTarget === UNASSIGNED_ZONE}
            onDragStartTask={beginDrag}
            onAssign={onAssign}
            onOpenEdit={onOpenEdit}
            onDragOverZone={() => setDropTarget(UNASSIGNED_ZONE)}
            onDragLeaveZone={() => setDropTarget((cur) => (cur === UNASSIGNED_ZONE ? null : cur))}
            onDropZone={() => dropOn(null)}
          />

          {profilePerson && (
            <ResourceProfileDrawer
              key={profilePerson.accountId}
              person={profilePerson}
              defaultCapacityHours={pool?.defaultCapacityHours ?? 8}
              skillSuggestions={skillSuggestions}
              onClose={() => setProfileId(null)}
              onProfileSaved={upsertProfile}
              onAbsenceAdded={addAbsence}
              onAbsenceRemoved={removeAbsence}
              onAbsenceUpdated={replaceAbsence}
            />
          )}
        </>
      )}
    </div>
  );
}

/**
 * Where the member list came from, behind an ⓘ beside the column's title.
 *
 * It cannot go away entirely: without it, "why is X not here / why is this stranger here" has no
 * answer on screen — the two sources differ enormously (a project's declared roles versus
 * everyone on the site holding one permission), and which one you get depends on a Jira
 * permission the user cannot see from here. So the normal case is a quiet ⓘ, and the fallback
 * (the list is probably wider than the real team) is the same control in warning colours.
 */
function MemberSourceTip({ pool, count }: { pool: ResourcePool | null; count: number }) {
  if (!pool) return null;

  if (pool.memberSource === "project-roles") {
    return (
      <InfoTip label="Danh sách thành viên lấy từ đâu">
        {count} thành viên, lấy từ vai trò dự án trên Jira
        {pool.memberRoles.length > 0 && <> ({pool.memberRoles.join(", ")})</>}. Sửa danh sách này trong Jira:{" "}
        <b>Project settings → People</b>.
        {pool.memberSkippedGroups > 0 && (
          <>
            {" "}
            Chỉ gồm người được thêm trực tiếp vào vai trò — {pool.memberSkippedGroups} nhóm trong vai trò không đọc được
            thành viên nên chưa được tính.
          </>
        )}
      </InfoTip>
    );
  }

  return (
    <InfoTip label="Danh sách thành viên có thể rộng hơn đội thật — xem lý do" tone="warn">
      {count} người, lấy từ danh sách <b>có thể được giao việc</b> — {fallbackReasonText(pool)} Danh sách này thường rộng hơn
      đội thật.
      {pool.memberTruncated && " Jira đã cắt ở 100 người, có thể còn thiếu."}
    </InfoTip>
  );
}

/**
 * One sentence per real cause. This used to blame Administer Projects for every
 * fallback, which sent an admin whose lookup failed for a different reason to
 * re-check the one permission they already had.
 */
function fallbackReasonText(pool: ResourcePool): ReactNode {
  const fb = pool.memberFallback;
  const status = fb?.status ? ` (HTTP ${fb.status})` : "";
  switch (fb?.reason) {
    case "roles-forbidden":
      return (
        <>
          tài khoản của bạn không có quyền <i>Administer Projects</i> nên Jira từ chối đọc vai trò dự án{status}.
        </>
      );
    case "actors-unreadable":
      return <>Jira liệt kê được vai trò dự án nhưng từ chối đọc thành viên của từng vai trò{status}.</>;
    case "groups-unreadable":
      return (
        <>
          vai trò dự án chỉ gồm nhóm, và tài khoản của bạn không có quyền toàn cục <i>Browse users and groups</i> để xem
          thành viên nhóm{status}. Thêm từng người trực tiếp vào vai trò sẽ khắc phục.
        </>
      );
    case "groups-out-of-scope":
      return (
        <>
          vai trò dự án chỉ gồm nhóm, và ứng dụng chưa được Atlassian cấp phạm vi truy cập để xem thành viên nhóm{status}.
          Đây là cấu hình của ứng dụng, không phải quyền của bạn trên Jira. Thêm từng người trực tiếp vào vai trò sẽ khắc
          phục.
        </>
      );
    case "roles-empty":
      return (
        <>
          đọc được vai trò dự án nhưng chưa vai trò nào có người. Thêm thành viên tại <b>Project settings → People</b>.
        </>
      );
    case "error":
      return <>không đọc được vai trò dự án do lỗi khi gọi Jira{status}.</>;
    default:
      return <>không đọc được vai trò dự án.</>;
  }
}

/**
 * Two header rows: months spanning their days, then the day (or week) itself.
 * The month row is what makes a 90-column strip readable — bare day numbers
 * repeat every month and give a reader nothing to anchor on.
 */
function HeatmapHeader({
  spans,
  granularity,
  today,
  memberNote,
}: {
  spans: Array<{ start: string; end: string }>;
  granularity: Granularity;
  today: string;
  memberNote: ReactNode;
}) {
  const months: Array<{ label: MonthLabel; span: number }> = [];
  for (const { start } of spans) {
    // By month the columns are months themselves, so the band above them is the year.
    const label = monthLabel(start, granularity);
    const last = months[months.length - 1];
    if (last && last.label.key === label.key) last.span += 1;
    else months.push({ label, span: 1 });
  }

  return (
    <>
      <div className="rv-row rv-row-months">
        <div className="rv-name rv-corner" />
        {months.map((m, i) => (
          // Three lengths of one label; the stylesheet shows whichever fits (container query on the band's own width).
          <div key={i} className="rv-month" title={m.label.full} style={{ "--span": m.span } as React.CSSProperties}>
            <span className="rv-month-full">{m.label.full}</span>
            <span className="rv-month-mid">{m.label.mid}</span>
            <span className="rv-month-min">{m.label.min}</span>
          </div>
        ))}
      </div>
      <div className="rv-row rv-row-head">
        <div className="rv-name rv-corner">
          Thành viên
          {memberNote}
        </div>
        {spans.map(({ start, end }) => (
          <div key={start} className={`rv-cell rv-head-cell ${today >= start && today <= end ? "is-today" : ""}`}
            title={start === end ? formatDate(start) : `${formatDate(start)} → ${formatDate(end)}`}
          >
            {granularity === "week"
              ? `${start.slice(8, 10)}/${start.slice(5, 7)}`
              : granularity === "month"
                ? `Thg ${Number(start.slice(5, 7))}`
                : start.slice(8, 10)}
          </div>
        ))}
      </div>
    </>
  );
}
