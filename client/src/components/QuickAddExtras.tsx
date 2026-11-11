import type { JiraUser } from "../types";
import type { QuickExtras } from "../quickAddExtras";
import DateField from "./DateField";

/** Bắt đầu · Kết thúc · Người: the optional boxes under a quick-add title. */
export default function QuickAddExtras({
  value,
  onChange,
  users,
  disabled,
}: {
  value: QuickExtras;
  onChange: (next: QuickExtras) => void;
  users: JiraUser[];
  disabled?: boolean;
}) {
  return (
    <div className="qa-extras">
      <label className="qa-extra">
        <span>Bắt đầu</span>
        <DateField
          value={value.startDate}
          ariaLabel="Ngày bắt đầu"
          disabled={disabled}
          onChange={(iso) => onChange({ ...value, startDate: iso })}
        />
      </label>
      <label className="qa-extra">
        <span>Kết thúc</span>
        <DateField
          value={value.dueDate}
          ariaLabel="Ngày kết thúc"
          base={value.startDate || undefined}
          disabled={disabled}
          onChange={(iso) => onChange({ ...value, dueDate: iso })}
        />
      </label>
      <label className="qa-extra qa-extra-wide">
        <span>Người</span>
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
