import { initials } from "../boardModel";
import { isAssignableType } from "../types";

export interface Member {
  accountId: string;
  displayName: string;
}

interface Props {
  issueType: string;
  accountId: string | null;
  name: string | null;
  members: Member[];
  /** Omitted = read-only avatar. */
  onAssign?: (accountId: string | null) => void;
}

/**
 * The assignee avatar, which opens a person list when clicked. The native
 * <select> sits invisibly over the avatar rather than being restyled: it gets the
 * platform's keyboard and touch behaviour for free, and the card keeps its
 * compact look. An Epic is a container and never takes an owner (see
 * isAssignableType), so it gets the plain avatar.
 */
export default function AssigneePicker({ issueType, accountId, name, members, onAssign }: Props) {
  const avatar = (
    <span className={`bd-avatar ${name ? "" : "is-none"}`} title={name ?? "Chưa gán"}>
      {initials(name)}
    </span>
  );
  if (!onAssign || !isAssignableType(issueType)) return avatar;
  return (
    <span className="bd-assignee" title={`${name ?? "Chưa gán"} — bấm để đổi người phụ trách`} onClick={(e) => e.stopPropagation()}>
      {avatar}
      <select
        value={accountId ?? ""}
        aria-label="Đổi người phụ trách"
        onChange={(e) => onAssign(e.target.value || null)}
        draggable={false}
      >
        <option value="">— Chưa gán —</option>
        {accountId && !members.some((m) => m.accountId === accountId) && <option value={accountId}>{name}</option>}
        {members.map((m) => (
          <option key={m.accountId} value={m.accountId}>
            {m.displayName}
          </option>
        ))}
      </select>
    </span>
  );
}
