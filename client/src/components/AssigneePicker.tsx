import { useMemo, useState } from "react";
import { isAssignableType, type JiraUser } from "../types";
import Avatar from "./Avatar";
import { useAssignContext } from "./assignContext";
import PersonPicker from "./PersonPicker";

export interface Member {
  accountId: string;
  displayName: string;
}

interface Props {
  issueType: string;
  /** The issue's key: with an assign context it finds the task whose dates the picker's hints measure. */
  issueKey?: string;
  accountId: string | null;
  name: string | null;
  members: Member[];
  /** Omitted = read-only avatar. */
  onAssign?: (accountId: string | null) => void;
}

/**
 * The assignee avatar on a card or backlog row. Pressing it opens `PersonPicker` (plan 0-3, G9):
 * searchable, with who is free inside the task's dates when the board can say so. A thin shell, so
 * the places that use it did not change. An Epic is a container and never takes an owner (see
 * isAssignableType), so it gets the plain avatar.
 */
export default function AssigneePicker({ issueType, issueKey, accountId, name, members, onAssign }: Props) {
  const ctx = useAssignContext();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  const people = useMemo<JiraUser[]>(() => {
    const base = ctx?.people ?? members.map((m) => ({ accountId: m.accountId, displayName: m.displayName, avatarUrl: null }));
    // An owner who left the project is still shown, and can still be replaced.
    return accountId && name && !base.some((u) => u.accountId === accountId) ? [...base, { accountId, displayName: name, avatarUrl: null }] : base;
  }, [ctx, members, accountId, name]);
  const avatarUrl = people.find((u) => u.accountId === accountId)?.avatarUrl ?? null;

  const task = issueKey ? ctx?.taskFor(issueKey) ?? null : null;
  // Built when the picker opens, once: the load inside the task's dates.
  const load = useMemo(() => (anchor && task && ctx ? ctx.loadFor(task) : null), [anchor, task, ctx]);

  const avatar = <Avatar name={name} avatarUrl={avatarUrl} className="bd-avatar" title={name ?? "Chưa gán"} />;
  if (!onAssign || !isAssignableType(issueType)) return avatar;

  return (
    <>
      <button
        type="button"
        className={`bd-assignee ${name ? "" : "is-empty"}`}
        title={name ?? "Chưa gán"}
        aria-label="Đổi người phụ trách"
        draggable={false}
        onClick={(e) => {
          e.stopPropagation();
          setAnchor(e.currentTarget.getBoundingClientRect());
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        // The card and the row own Enter and the arrows; a button inside must not trigger them.
        onKeyDown={(e) => e.stopPropagation()}
      >
        {avatar}
      </button>
      {anchor && (
        <PersonPicker
          anchor={anchor}
          people={people}
          task={task}
          load={load}
          calendar={ctx?.calendar}
          currentAccountId={accountId}
          meAccountId={ctx?.meAccountId}
          onPick={(id) => {
            setAnchor(null);
            if (id !== accountId) onAssign(id);
          }}
          onClose={() => setAnchor(null)}
        />
      )}
    </>
  );
}
