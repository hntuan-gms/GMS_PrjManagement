import type { JiraUser, Task } from "../types";

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

  const rows = users
    .map((u) => ({ user: u, tasks: groups.get(u.accountId) ?? [] }))
    .concat(unassigned.length > 0 ? [{ user: { accountId: "", displayName: "Chưa gán", avatarUrl: null }, tasks: unassigned }] : []);

  return (
    <div className="resource-view">
      {rows.map(({ user, tasks: userTasks }) => {
        const openCount = userTasks.filter((t) => t.statusCategory !== "done").length;
        const doneCount = userTasks.length - openCount;
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
                style={{ width: userTasks.length === 0 ? "0%" : `${Math.min(100, (openCount / Math.max(1, userTasks.length)) * 100)}%` }}
              />
            </div>
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
                  <tr key={t.id} onClick={() => onOpenEdit(t)} className="clickable-row">
                    <td>{t.id}</td>
                    <td>{t.summary}</td>
                    <td>
                      <span className={`status-pill status-${t.statusCategory}`}>{t.statusName}</span>
                    </td>
                    <td>{t.startDate ?? "—"}</td>
                    <td>{t.dueDate ?? "—"}</td>
                    <td>{t.percentComplete}%</td>
                  </tr>
                ))}
                {userTasks.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      Không có task
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
