import { useMemo, useState, type ReactNode } from "react";
import {
  aggregateWeeks,
  BAND_LABEL,
  buildResourceLoad,
  defaultWindow,
  diffDays,
  addDays,
  todayIso,
  type LoadBand,
  type PersonLoad,
} from "../resourceAllocation";
import type { JiraUser, ResourceAbsence, ResourceProfile, ResourcePool, Task } from "../types";
import ResourcePersonPanel from "./ResourcePersonPanel";

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
}

/**
 * The dragged task, held in React state rather than read back out of the
 * DataTransfer: `getData` is write-only during dragover in Chrome and Safari,
 * and the drop targets need to know what is coming to decide whether to light
 * up at all (dropping a task on the person who already holds it is a no-op).
 */
interface DragState {
  taskId: string;
  summary: string;
  fromAccountId: string | null;
}

/** Sentinel for the "remove from whoever holds it" drop zone. */
const UNASSIGNED_ZONE = "__unassigned__";

/** Above this many days the heatmap switches to week columns — see aggregateWeeks. */
const WEEK_THRESHOLD = 45;

const PRESETS: Array<{ label: string; days: number | null }> = [
  { label: "4 tuần", days: 28 },
  { label: "8 tuần", days: 56 },
  { label: "1 quý", days: 90 },
  { label: "Toàn dự án", days: null },
];

function shortDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

function pct(ratio: number): string {
  if (!Number.isFinite(ratio)) return "—";
  return `${Math.round(ratio * 100)}%`;
}

/**
 * The resource tab: who is overloaded, when, and by how much.
 *
 * Load is computed here from tasks the workspace already holds (see
 * resourceAllocation.ts), so dragging a bar in the Gantt recolours this tab on
 * the same render rather than after a round trip. Only the two things Jira has
 * no field for — capacity and absence — are fetched.
 */
export default function ResourceView({
  tasks,
  users,
  pool,
  poolError,
  onPoolChange,
  onAssign,
  onOpenEdit,
}: Props) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Everyone on the project by default. Showing only people who already hold
  // dated work makes the tab go blank on a project nobody has assigned yet,
  // which reads as "broken" rather than as "nothing is assigned" — and the
  // whole point of a resource tab is to see who is free.
  const [onlyBusy, setOnlyBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);

  const today = useMemo(() => todayIso(), []);

  // The window follows the project until the user touches it, then stops —
  // otherwise every drag that extends the plan would yank the view they are
  // reading out from under them.
  const span = useMemo(() => range ?? defaultWindow(tasks, today), [range, tasks, today]);

  const load = useMemo(
    () =>
      buildResourceLoad({
        tasks,
        users,
        profiles: pool?.profiles ?? [],
        absences: pool?.absences ?? [],
        defaultCapacityHours: pool?.defaultCapacityHours,
        from: span.from,
        to: span.to,
        includeIdle: !onlyBusy,
      }),
    [tasks, users, pool, span, onlyBusy]
  );

  const byWeek = diffDays(span.from, span.to) > WEEK_THRESHOLD;

  const visiblePeople = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return load.people;
    return load.people.filter(
      (p) =>
        p.displayName.toLowerCase().includes(needle) ||
        (p.role ?? "").toLowerCase().includes(needle)
    );
  }, [load.people, query]);

  const selected = load.people.find((p) => p.accountId === selectedId) ?? null;

  function applyPreset(days: number | null) {
    if (days === null) {
      setRange(defaultWindow(tasks, today, 3650));
      return;
    }
    const from = span.from;
    setRange({ from, to: addDays(from, days - 1) });
  }

  // Saves are applied to the cached pool rather than triggering a refetch: the
  // response is the authoritative row, and a round trip here would make the
  // heatmap flicker back to the old colour before settling.
  function upsertProfile(profile: ResourceProfile) {
    if (!pool) return;
    const others = pool.profiles.filter((p) => p.accountId !== profile.accountId);
    onPoolChange({ ...pool, profiles: [...others, profile] });
  }

  function addAbsence(absence: ResourceAbsence) {
    if (!pool) return;
    onPoolChange({ ...pool, absences: [...pool.absences, absence] });
  }

  function removeAbsence(id: string) {
    if (!pool) return;
    onPoolChange({ ...pool, absences: pool.absences.filter((a) => a.id !== id) });
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

  return (
    <div className="resource-view" onDragEnd={endDrag}>
      <div className="rv-controls">
        <div className="rv-range">
          <label>
            Từ
            <input
              type="date"
              value={span.from}
              onChange={(e) =>
                e.target.value && setRange({ from: e.target.value, to: span.to })
              }
            />
          </label>
          <label>
            Đến
            <input
              type="date"
              value={span.to}
              onChange={(e) =>
                e.target.value && setRange({ from: span.from, to: e.target.value })
              }
            />
          </label>
          {PRESETS.map((p) => (
            <button key={p.label} className="rv-preset" onClick={() => applyPreset(p.days)}>
              {p.label}
            </button>
          ))}
          {range && (
            <button className="link-btn" onClick={() => setRange(null)}>
              Theo dự án
            </button>
          )}
        </div>

        <div className="rv-control-right">
          <input
            type="search"
            className="rv-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            placeholder="Tìm thành viên..."
            aria-label="Tìm thành viên"
          />
          <label className="rv-toggle">
            <input
              type="checkbox"
              checked={onlyBusy}
              onChange={(e) => setOnlyBusy(e.target.checked)}
            />
            Chỉ hiện người đang có việc
          </label>
        </div>
      </div>

      <div className="rv-summary">
        <Stat value={String(load.people.length)} label="thành viên có việc" />
        <Stat
          value={String(load.overloadedPeople)}
          label="đang quá tải"
          tone={load.overloadedPeople > 0 ? "danger" : "ok"}
        />
        <Stat
          value={pct(
            load.people.length > 0
              ? load.people.reduce((n, p) => n + p.utilisation, 0) / load.people.length
              : 0
          )}
          label="hiệu suất trung bình"
        />
        <Stat
          value={String(load.unassigned.length)}
          label="công việc chưa gán"
          tone={load.unassigned.length > 0 ? "warn" : "ok"}
        />
        <div className="rv-legend">
          {(["free", "light", "healthy", "over", "off-violation"] as LoadBand[]).map((b) => (
            <span key={b} className="rv-legend-item">
              <i className={`rv-swatch band-${b}`} />
              {BAND_LABEL[b]}
            </span>
          ))}
        </div>
      </div>

      <MemberSourceNote pool={pool} count={load.people.length} />

      {poolError && (
        <div className="rv-notice">
          Không tải được công suất và lịch nghỉ ({poolError}). Bản đồ nhiệt vẫn tính theo mặc định{" "}
          {pool?.defaultCapacityHours ?? 8} giờ/ngày.
        </div>
      )}

      {visiblePeople.length === 0 ? (
        <div className="empty-state">
          {load.people.length > 0
            ? "Không có thành viên nào khớp."
            : onlyBusy
              ? "Không ai có công việc trong khoảng thời gian này. Bỏ chọn “Chỉ hiện người đang có việc” để xem toàn bộ thành viên dự án."
              : pool === null
                ? "Đang tải danh sách thành viên..."
                : "Dự án này chưa có thành viên nào trên Jira, hoặc tài khoản của bạn không đọc được danh sách."}
        </div>
      ) : (
        <div className="rv-heatmap-scroll">
          <div className={`rv-grid ${byWeek ? "rv-grid-week" : "rv-grid-day"}`}>
            <HeatmapHeader dates={load.dates} byWeek={byWeek} today={today} />
            {visiblePeople.map((person) => (
              <PersonRow
                key={person.accountId}
                person={person}
                byWeek={byWeek}
                today={today}
                selected={person.accountId === selectedId}
                onSelect={() =>
                  setSelectedId((cur) => (cur === person.accountId ? null : person.accountId))
                }
                droppable={canDropOn(person.accountId)}
                isDropTarget={dropTarget === person.accountId}
                onDragOver={() => setDropTarget(person.accountId)}
                onDrop={() => dropOn(person.accountId)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Mounted whenever something is being dragged, even with nothing
          unassigned: it is the only place to drop a task in order to take it
          off someone, so it cannot appear only when it already has contents. */}
      {(load.unassigned.length > 0 || drag !== null) && (
        <div
          className={`rv-unassigned ${canDropOn(null) ? "is-droppable" : ""} ${
            dropTarget === UNASSIGNED_ZONE ? "is-drop-target" : ""
          }`}
          onDragOver={(e) => {
            if (!canDropOn(null)) return;
            e.preventDefault();
            setDropTarget(UNASSIGNED_ZONE);
          }}
          onDragLeave={() => setDropTarget((cur) => (cur === UNASSIGNED_ZONE ? null : cur))}
          onDrop={(e) => {
            e.preventDefault();
            dropOn(null);
          }}
        >
          <strong>
            {drag && canDropOn(null)
              ? `Thả vào đây để bỏ gán "${drag.summary}"`
              : `${load.unassigned.length} công việc chưa có người phụ trách`}
          </strong>
          <div className="rv-unassigned-list">
            {load.unassigned.slice(0, 12).map((t) => (
              <button
                key={t.id}
                className="rv-chip"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", t.id);
                  beginDrag(t);
                }}
                onClick={() => onOpenEdit(t)}
                title="Kéo thả lên một thành viên để gán"
              >
                {t.id} · {t.summary}
              </button>
            ))}
            {load.unassigned.length > 12 && (
              <span className="rv-chip-more">+{load.unassigned.length - 12} nữa</span>
            )}
          </div>
        </div>
      )}

      {selected && (
        <ResourcePersonPanel
          person={selected}
          dates={load.dates}
          today={today}
          defaultCapacityHours={pool?.defaultCapacityHours ?? 8}
          onClose={() => setSelectedId(null)}
          onOpenEdit={onOpenEdit}
          onProfileSaved={upsertProfile}
          onAbsenceAdded={addAbsence}
          onAbsenceRemoved={removeAbsence}
          onDragTask={beginDrag}
          droppable={canDropOn(selected.accountId)}
          isDropTarget={dropTarget === selected.accountId}
          onDragOverPanel={() => setDropTarget(selected.accountId)}
          onDropOnPanel={() => dropOn(selected.accountId)}
        />
      )}
    </div>
  );
}

/**
 * One line saying where the member list came from.
 *
 * Without it, "why is X not here / why is this stranger here" has no answer on
 * screen: the two sources differ enormously (a project's declared roles versus
 * everyone on the site holding one permission), and which one you get depends
 * on a Jira permission the user cannot see from here.
 */
function MemberSourceNote({ pool, count }: { pool: ResourcePool | null; count: number }) {
  if (!pool) return null;

  if (pool.memberSource === "project-roles") {
    return (
      <div className="rv-source">
        {count} thành viên, lấy từ vai trò dự án trên Jira
        {pool.memberRoles.length > 0 && <> ({pool.memberRoles.join(", ")})</>}. Sửa danh sách này
        trong Jira: <b>Project settings → People</b>.
        {pool.memberSkippedGroups > 0 && (
          <>
            {" "}
            Chỉ gồm người được thêm trực tiếp vào vai trò — {pool.memberSkippedGroups} nhóm trong vai
            trò không đọc được thành viên nên chưa được tính.
          </>
        )}
      </div>
    );
  }

  return (
    <div className="rv-source rv-source-warn">
      {count} người, lấy từ danh sách <b>có thể được giao việc</b> — {fallbackReasonText(pool)}{" "}
      Danh sách này thường rộng hơn đội thật.
      {pool.memberTruncated && " Jira đã cắt ở 100 người, có thể còn thiếu."}
    </div>
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
          tài khoản của bạn không có quyền <i>Administer Projects</i> nên Jira từ chối đọc vai trò
          dự án{status}.
        </>
      );
    case "actors-unreadable":
      return <>Jira liệt kê được vai trò dự án nhưng từ chối đọc thành viên của từng vai trò{status}.</>;
    case "groups-unreadable":
      return (
        <>
          vai trò dự án chỉ gồm nhóm, và tài khoản của bạn không có quyền toàn cục{" "}
          <i>Browse users and groups</i> để xem thành viên nhóm{status}. Thêm từng người trực tiếp
          vào vai trò sẽ khắc phục.
        </>
      );
    case "groups-out-of-scope":
      return (
        <>
          vai trò dự án chỉ gồm nhóm, và ứng dụng chưa được Atlassian cấp phạm vi truy cập để xem
          thành viên nhóm{status}. Đây là cấu hình của ứng dụng, không phải quyền của bạn trên Jira.
          Thêm từng người trực tiếp vào vai trò sẽ khắc phục.
        </>
      );
    case "roles-empty":
      return (
        <>
          đọc được vai trò dự án nhưng chưa vai trò nào có người. Thêm thành viên tại{" "}
          <b>Project settings → People</b>.
        </>
      );
    case "error":
      return <>không đọc được vai trò dự án do lỗi khi gọi Jira{status}.</>;
    default:
      return <>không đọc được vai trò dự án.</>;
  }
}

function Stat({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone?: "ok" | "warn" | "danger";
}) {
  return (
    <div className={`rv-stat ${tone ? `rv-stat-${tone}` : ""}`}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

/**
 * Two header rows: months spanning their days, then the day (or week) itself.
 * The month row is what makes a 90-column strip readable — bare day numbers
 * repeat every month and give a reader nothing to anchor on.
 */
function HeatmapHeader({
  dates,
  byWeek,
  today,
}: {
  dates: string[];
  byWeek: boolean;
  today: string;
}) {
  const columns = byWeek ? weekStarts(dates) : dates;

  const months: Array<{ label: string; span: number }> = [];
  for (const iso of columns) {
    const label = `Thg ${Number(iso.slice(5, 7))}/${iso.slice(0, 4)}`;
    const last = months[months.length - 1];
    if (last && last.label === label) last.span += 1;
    else months.push({ label, span: 1 });
  }

  return (
    <>
      <div className="rv-row rv-row-months">
        <div className="rv-name rv-corner" />
        {months.map((m, i) => (
          <div key={i} className="rv-month" style={{ "--span": m.span } as React.CSSProperties}>
            {m.label}
          </div>
        ))}
      </div>
      <div className="rv-row rv-row-head">
        <div className="rv-name rv-corner">Thành viên</div>
        {columns.map((iso) => (
          <div
            key={iso}
            className={`rv-cell rv-head-cell ${iso === today ? "is-today" : ""}`}
            title={iso}
          >
            {byWeek ? shortDate(iso) : iso.slice(8, 10)}
          </div>
        ))}
      </div>
    </>
  );
}

function weekStarts(dates: string[]): string[] {
  const out: string[] = [];
  dates.forEach((d, i) => {
    if (i === 0 || new Date(`${d}T00:00:00Z`).getUTCDay() === 1) out.push(d);
  });
  return out;
}

function PersonRow({
  person,
  byWeek,
  today,
  selected,
  onSelect,
  droppable,
  isDropTarget,
  onDragOver,
  onDrop,
}: {
  person: PersonLoad;
  byWeek: boolean;
  today: string;
  selected: boolean;
  onSelect: () => void;
  droppable: boolean;
  isDropTarget: boolean;
  onDragOver: () => void;
  onDrop: () => void;
}) {
  const cells = byWeek
    ? aggregateWeeks(person.days).map((w) => ({
        key: w.start,
        band: w.band,
        ratio: w.ratio,
        allocated: w.allocatedHours,
        capacity: w.capacityHours,
        label: `${w.start} → ${w.end}`,
        taskIds: w.taskIds,
        isToday: today >= w.start && today <= w.end,
      }))
    : person.days.map((d) => ({
        key: d.date,
        band: d.band,
        ratio: d.ratio,
        allocated: d.allocatedHours,
        capacity: d.capacityHours,
        label: d.date,
        taskIds: d.taskIds,
        isToday: d.date === today,
      }));

  return (
    <div
      className={`rv-row rv-row-person ${selected ? "is-selected" : ""} ${
        droppable ? "is-droppable" : ""
      } ${isDropTarget ? "is-drop-target" : ""}`}
      onClick={onSelect}
      // preventDefault on dragover is what marks an element as a drop target at
      // all; without it the browser refuses the drop and fires nothing.
      onDragOver={(e) => {
        if (!droppable) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onDragOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
    >
      <div className="rv-name">
        {person.avatarUrl ? (
          <img src={person.avatarUrl} alt="" className="rv-avatar" />
        ) : (
          <span className="rv-avatar rv-avatar-empty">{person.displayName.slice(0, 1)}</span>
        )}
        <span className="rv-person-text">
          <b>{person.displayName}</b>
          <small>
            {person.role ? `${person.role} · ` : ""}
            {person.capacityHoursPerDay}h/ngày · {person.tasks.length} việc
          </small>
        </span>
        {person.overloadedDays > 0 && (
          <span className="rv-badge-over" title={`${person.overloadedDays} ngày quá tải`}>
            {person.overloadedDays}
          </span>
        )}
      </div>
      {cells.map((c) => (
        <div
          key={c.key}
          className={`rv-cell band-${c.band} ${c.isToday ? "is-today" : ""}`}
          title={`${c.label} · ${c.allocated}h / ${c.capacity}h (${pct(c.ratio)})${
            c.taskIds.length > 0 ? `\n${[...new Set(c.taskIds)].join(", ")}` : ""
          }`}
        >
          {byWeek && c.capacity > 0 ? pct(c.ratio) : ""}
        </div>
      ))}
    </div>
  );
}
