import { isAssignableType } from "../types";
import type { Member } from "./AssigneePicker";

export interface QuickOptions {
  issueType: string;
  assigneeAccountId: string | null;
}

interface Props {
  types: string[];
  members: Member[];
  value: QuickOptions;
  onChange: (next: QuickOptions) => void;
}

/** The type and owner pickers under a quick-create box. */
export default function QuickCreateOptions({ types, members, value, onChange }: Props) {
  const type = types.includes(value.issueType) ? value.issueType : types[0];
  return (
    <div className="bd-quick-opts">
      <select value={type} onChange={(e) => onChange({ ...value, issueType: e.target.value })} aria-label="Loại công việc">
        {types.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      {isAssignableType(type) && (
        <select
          value={value.assigneeAccountId ?? ""}
          onChange={(e) => onChange({ ...value, assigneeAccountId: e.target.value || null })}
          aria-label="Người phụ trách"
        >
          <option value="">Chưa gán</option>
          {members.map((m) => (
            <option key={m.accountId} value={m.accountId}>
              {m.displayName}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
