import { useMemo } from "react";
import { assignHints, describeHint, type AssignHint } from "../assignHints";
import { fold } from "../fold";
import type { ResourceLoad } from "../resourceAllocation";
import type { JiraUser, Task } from "../types";
import { DEFAULT_WORK_CALENDAR, type WorkCalendar } from "../workCalendar";
import Avatar from "./Avatar";
import CellPicker, { type PickItem } from "./CellPicker";

export const UNASSIGN_ID = "__none__";

const plain = (u: JiraUser): AssignHint => ({
  accountId: u.accountId,
  ranged: false,
  conflictDays: 0,
  freeHours: 0,
  away: null,
  awayDays: 0,
  availableDays: 0,
});

/**
 * Choose a person (plan 0-3). With a dated `task` and the heatmap's `load`, each row says what taking
 * the task would mean inside its dates (rảnh / trùng n ngày / nghỉ …) and the list is ordered best
 * candidate first, the same rule the assistant uses to auto-assign. Without them it is the people in
 * name order. `onPick(null)` is "Bỏ giao".
 */
export default function PersonPicker({
  anchor,
  people,
  task,
  load,
  calendar = DEFAULT_WORK_CALENDAR,
  currentAccountId,
  meAccountId,
  allowUnassign = true,
  placeholder = "Tìm người",
  onPick,
  onClose,
}: {
  anchor: DOMRect;
  people: JiraUser[] | null;
  task?: Task | null;
  load?: Pick<ResourceLoad, "people"> | null;
  calendar?: WorkCalendar;
  currentAccountId?: string | null;
  meAccountId?: string | null;
  allowUnassign?: boolean;
  placeholder?: string;
  onPick: (accountId: string | null) => void;
  onClose: () => void;
}) {
  const items = useMemo<PickItem[] | null>(() => {
    if (!people) return null;
    const byId = new Map(people.map((u) => [u.accountId, u]));
    const hints = task
      ? assignHints(task, people, load ?? null, calendar)
      : [...people].sort((a, b) => a.displayName.localeCompare(b.displayName, "vi")).map(plain);
    const rows: PickItem[] = [];
    if (allowUnassign) rows.push({ id: UNASSIGN_ID, label: "Bỏ giao", hint: currentAccountId ? undefined : "hiện tại" });
    for (const h of hints) {
      const u = byId.get(h.accountId);
      if (!u) continue;
      const current = h.accountId === currentAccountId;
      const d = describeHint(h);
      rows.push({
        id: u.accountId,
        label: u.displayName,
        lead: <Avatar name={u.displayName} avatarUrl={u.avatarUrl} className="pp-avatar" decorative />,
        hint: current ? "hiện tại" : d ? d.text : h.accountId === meAccountId ? "bạn" : undefined,
        tone: current ? undefined : d?.tone,
      });
    }
    return rows;
  }, [people, task, load, calendar, currentAccountId, meAccountId, allowUnassign]);

  // Typing filters by name only: "rảnh" or "trùng" in a hint must not make a row match "r".
  const search = useMemo(
    () => (list: PickItem[], q: string) => {
      const f = fold(q);
      return f ? list.filter((i) => i.id !== UNASSIGN_ID && fold(i.label).includes(f)) : list;
    },
    []
  );

  return (
    <CellPicker
      anchor={anchor}
      items={items}
      loading={people === null}
      placeholder={placeholder}
      search={search}
      className="is-wide"
      onPick={(it) => onPick(it.id === UNASSIGN_ID ? null : it.id)}
      onClose={onClose}
    />
  );
}
