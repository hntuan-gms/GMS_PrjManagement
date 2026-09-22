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

export default function ResourceView({ tasks, users, onOpenEdit }: Props) {
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

  // Only people who actually carry work in this project. `users` is every
  // assignable account on the project, which on a large site is mostly noise.
  const rows = users
    .filter((u) => (groups.get(u.accountId)?.length ?? 0) > 0)
    .map((u) => ({ user: u, tasks: groups.get(u.accountId)! }))
    .concat(unassigned.length > 0 ? [{ user: { accountId: "", displayName: "Chưa gán", avatarUrl: null }, tasks: unassigned }] : []);

  if (rows.length === 0) {
    return <div className="center-message">Dự án chưa có task nào được gán.</div>;
  }

  return (
    <div className="resource-view">
      {rows.map(({ user, tasks: userTasks }) => {
        const openCount = userTasks.filter((t) => t.statusCategory !== "done").length;
        const doneCount = userTasks.length - openCount;
        // "Unassigned" isn't a person — overallocation only means something for a
        // real assignee who'd have to work two overlapping tasks at once.
        const overlaps = user.accountId ? findOverlaps(userTasks) : [];
        const conflictIds = new Set(overlaps.flatMap((o) => [o.aId, o.bId]));
        return (
          <div key={user.accountId || "unassigned"} className="resource-card">
            <div className="resource-header">
              <span className="resource-name">{user.displayName}</span>
              <span className="resource-stats">
                {userTasks.length} task · {openCount} đang mở · {doneCount} hoàn thành
              </span>
            </div>
            <div className="resource-load-bar">
              <div
                className="resource-load-fill"
                style={{ width: `${(openCount / userTasks.length) * 100}%` }}
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
                  <th>%</th>
                </tr>
              </thead>
              <tbody>
                {userTasks.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => onOpenEdit(t)}
                    className={`clickable-row ${conflictIds.has(t.id) ? "row-conflict" : ""}`}
                  >
                    <td>{conflictIds.has(t.id) && <span title="Trùng lịch với task khác">⚠ </span>}{t.id}</td>
                    <td>{t.summary}</td>
                    <td>
                      <span className={`status-pill status-${t.statusCategory}`}>{t.statusName}</span>
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
      })}
    </div>
  );
}
