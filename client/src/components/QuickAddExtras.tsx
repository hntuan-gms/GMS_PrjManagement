import { useEffect, useState } from "react";
import { api, peekCreateRequirements } from "../api";
import { NO_REQUIREMENTS, type CreateRequirements } from "../createRequirements";
import type { JiraUser } from "../types";
import type { QuickExtras } from "../quickAddExtras";
import DateField from "./DateField";

/**
 * Bắt đầu · Kết thúc · Người: the boxes under a quick-add title. The ones the project's create screen makes
 * mandatory say so ("bắt buộc"), read for the kind of issue about to be made; unknown shows nothing extra.
 */
export default function QuickAddExtras({
  value,
  onChange,
  users,
  kind,
  disabled,
}: {
  value: QuickExtras;
  onChange: (next: QuickExtras) => void;
  users: JiraUser[];
  /** What a created item will be: a Sub-task under a Story/Task, or a Task. */
  kind: "task" | "subtask";
  disabled?: boolean;
}) {
  const [req, setReq] = useState<CreateRequirements>(() => peekCreateRequirements(kind) ?? NO_REQUIREMENTS);
  useEffect(() => {
    let cancelled = false;
    api.getCreateRequirements(kind).then(
      (r) => {
        if (!cancelled) setReq(r);
      },
      () => undefined
    );
    return () => {
      cancelled = true;
    };
  }, [kind]);
  const must = (on: boolean) => (on ? <em className="qa-req">bắt buộc</em> : null);
  return (
    <div className="qa-extras">
      <label className="qa-extra">
        <span>Bắt đầu{must(req.startDate)}</span>
        <DateField
          value={value.startDate}
          ariaLabel="Ngày bắt đầu"
          disabled={disabled}
          onChange={(iso) => onChange({ ...value, startDate: iso })}
        />
      </label>
      <label className="qa-extra">
        <span>Kết thúc{must(req.dueDate)}</span>
        <DateField
          value={value.dueDate}
          ariaLabel="Ngày kết thúc"
          base={value.startDate || undefined}
          disabled={disabled}
          onChange={(iso) => onChange({ ...value, dueDate: iso })}
        />
      </label>
      <label className="qa-extra qa-extra-wide">
        <span>Người{must(req.assignee)}</span>
        <select
          value={value.assigneeAccountId}
          aria-label="Người được giao"
          disabled={disabled}
          onChange={(e) => onChange({ ...value, assigneeAccountId: e.target.value })}
        >
          <option value="">Chưa giao</option>
          {users.map((u) => (
            <option key={u.accountId} value={u.accountId}>
              {u.displayName}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
