import { useMemo, useState } from "react";
import { findOverlaps } from "../resourceAllocation";
import type { JiraUser, Task } from "../types";

function formatRange(from: string, to: string): string {
  const fmt = (iso: string) => iso.slice(8, 10) + "/" + iso.slice(5, 7);
  return from === to ? fmt(from) : `${fmt(from)} – ${fmt(to)}`;
}

interface Props {
  tasks: Task[];
  users: JiraUser[];
  onOpenEdit: (task: Task) => void;
}

/** Sentinel for the assignee <select>; "" already means "no filter". */
const UNASSIGNED = "__unassigned__";

export default function ResourceView({ tasks, users, onOpenEdit }: Props) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [assignee, setAssignee] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const needle = query.trim().toLowerCase();
  const filterActive = needle !== "" || status !== "" || assignee !== "" || from !== "" || to !== "";

  /**
   * Status options are derived from the loaded tasks, never a hard-coded list.
   * Workflow status names differ per Jira project — HHBJ uses "Selected for
   * development" where another site uses "To Do" — so a fixed list would offer
   * filters that silently match nothing (the same trap as STATUS_OPTIONS in
   * TaskEditModal, see BUG-05).
   */
  const statusOptions = useMemo(() => {
    const names = new Set(tasks.map((t) => t.statusName));
    return [...names].sort((a, b) => a.localeCompare(b, "vi"));
  }, [tasks]);

  // Everyone holding work, before any filtering. `users` is every assignable
  // account on the project, which on a large site is mostly noise.
  const people = useMemo(() => {
    const groups = new Map<string, Task[]>();
    const unassigned: Task[] = [];
    for (const t of tasks) {
      if (!t.assigneeAccountId) {
        unassigned.push(t);
        continue;
      }
      if (!groups.has(t.assigneeAccountId)) groups.set(t.assigneeAccountId, []);
      groups.get(t.assigneeAccountId)!.push(t);
    }
    const held = users
      .filter((u) => (groups.get(u.accountId)?.length ?? 0) > 0)
      .map((u) => ({ user: u, all: groups.get(u.accountId)! }));
    return unassigned.length > 0
      ? held.concat([
          { user: { accountId: "", displayName: "Chưa gán", avatarUrl: null }, all: unassigned },
        ])
      : held;
  }, [tasks, users]);

  const rows = useMemo(() => {
    const keep = (t: Task): boolean => {
      if (
        needle &&
        !t.id.toLowerCase().includes(needle) &&
        !t.summary.toLowerCase().includes(needle)
      ) {
        return false;
      }
      if (status && t.statusName !== status) return false;
      if (assignee) {
        const wantUnassigned = assignee === UNASSIGNED;
        if (wantUnassigned !== (t.assigneeAccountId === null)) return false;
        if (!wantUnassigned && t.assigneeAccountId !== assignee) return false;
      }
      if (from || to) {
        // A task with no dates at all can't be placed on a calendar, so it can't
        // satisfy a date window — dropped rather than silently kept.
        const start = t.startDate ?? t.dueDate;
        const end = t.dueDate ?? t.startDate;
        if (!start || !end) return false;
        // Overlap, not containment: the useful question in a resource view is
        // "who is busy during this window", which a task straddling either edge
        // still answers. ISO strings compare chronologically as written.
        if (to && start > to) return false;
        if (from && end < from) return false;
      }
      return true;
    };

    return people
      .map((p) => ({ ...p, shown: p.all.filter(keep) }))
      .filter((p) => p.shown.length > 0);
  }, [people, needle, status, assignee, from, to]);

  const shownTotal = rows.reduce((n, r) => n + r.shown.length, 0);
  const allTotal = people.reduce((n, p) => n + p.all.length, 0);

  function clearFilters() {
    setQuery("");
    setStatus("");
    setAssignee("");
    setFrom("");
    setTo("");
  }

  return (
    <div className="resource-view">
      {/* Always mounted, including when nothing matches — otherwise a filter that
          excludes everything would take away the only controls able to undo it. */}
      <div className="resource-filters">
        <input
          type="search"
          className="resource-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
          }}
          placeholder="Tìm theo mã hoặc tên công việc..."
          aria-label="Tìm công việc"
        />
        <label>
          Trạng thái
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Tất cả</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Phụ trách
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Tất cả</option>
            {people.map(({ user }) => (
              <option key={user.accountId || UNASSIGNED} value={user.accountId || UNASSIGNED}>
                {user.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Từ ngày
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          Đến ngày
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {filterActive && (
          <>
            <button className="link-btn" onClick={clearFilters}>
              Xoá bộ lọc
            </button>
            <span className="resource-filter-count">
              {shownTotal}/{allTotal} công việc
            </span>
          </>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          {people.length === 0
            ? "Dự án chưa có task nào được gán."
            : "Không có công việc nào khớp với bộ lọc."}
        </div>
      ) : (
        rows.map(({ user, all, shown }) => {
          const openCount = shown.filter((t) => t.statusCategory !== "done").length;
          const doneCount = shown.length - openCount;
          // Load bar and overlap detection deliberately read the person's FULL task
          // list, not the filtered one: they describe real workload, and a view
          // filter must not be able to make someone look free or conflict-free.
          const loadOpen = all.filter((t) => t.statusCategory !== "done").length;
          // "Unassigned" isn't a person — overallocation only means something for a
          // real assignee who'd have to work two overlapping tasks at once.
          const overlaps = user.accountId ? findOverlaps(all) : [];
          const conflictIds = new Set(overlaps.flatMap((o) => [o.aId, o.bId]));
          return (
            <div key={user.accountId || "unassigned"} className="resource-card">
              <div className="resource-header">
                <span className="resource-name">{user.displayName}</span>
                <span className="resource-stats">
                  {filterActive ? `${shown.length}/${all.length}` : all.length} task · {openCount} đang
                  mở · {doneCount} hoàn thành
                </span>
              </div>
              <div className="resource-load-bar">
                <div
                  className="resource-load-fill"
                  style={{ width: `${(loadOpen / all.length) * 100}%` }}
                />
              </div>
              {overlaps.length > 0 && (
                <div className="resource-overlap-warning">
                  <strong>⚠ Quá tải — {overlaps.length} cặp task trùng lịch:</strong>
                  <ul>
                    {overlaps.map((o, i) => (
                      <li key={i}>
                        <b>{o.aId}</b> ↔ <b>{o.bId}</b> · {formatRange(o.from, o.to)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <table className="resource-table">
                <thead>
                  <tr>
                    <th>Mã</th>
                    <th>Tên công việc</th>
                    <th>Trạng thái</th>
                    <th>Bắt đầu</th>
                    <th>Kết thúc</th>
                    <th>% hoàn thành</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((t) => (
                    <tr
                      key={t.id}
                      onClick={() => onOpenEdit(t)}
                      className={`clickable-row ${conflictIds.has(t.id) ? "row-conflict" : ""}`}
                    >
                      <td>
                        {conflictIds.has(t.id) && <span title="Trùng lịch với task khác">⚠ </span>}
                        {t.id}
                      </td>
                      <td>{t.summary}</td>
                      <td>
                        <span className={`status-pill status-${t.statusCategory}`}>
                          {t.statusName}
                        </span>
                      </td>
                      <td>{t.startDate ?? "—"}</td>
                      <td>{t.dueDate ?? "—"}</td>
                      <td>{t.percentComplete}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })
      )}
    </div>
  );
}
