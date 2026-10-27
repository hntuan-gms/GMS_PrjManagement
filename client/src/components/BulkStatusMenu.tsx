import { useEffect, useState } from "react";
import { api } from "../api";
import { missingFields, uniqueFields } from "../transitionFields";
import type { Task, TaskTransition, TransitionField } from "../types";
import { Icon } from "./Icons";
import Popover from "./Popover";
import { TransitionFieldsForm } from "./TransitionFields";

interface Props {
  tasks: Task[];
  disabled?: boolean;
  /** The trigger; the default is the selection bar's "Đổi trạng thái…". A backlog row passes its status chip. */
  label?: React.ReactNode;
  className?: string;
  placement?: "top" | "bottom";
  title?: string;
  /** Run the move for exactly these tasks, with whatever the workflow asked for. */
  onApply: (statusName: string, ids: string[], values: Record<string, string>) => void;
}

/** A target status and who can get there. */
interface Target {
  status: string;
  category: TaskTransition["toCategory"];
  ids: string[];
  fields: TransitionField[];
}

/**
 * "Đổi trạng thái…" for a selection. A workflow decides what each issue can become from where
 * it is, so offering every status the project has — as this used to — promised moves that then
 * failed one by one. Here the choices are what the selected issues' workflows actually allow,
 * each with how many of them can take it, and a status that needs a box filled (RootCause)
 * asks for it before anything is sent.
 */
export default function BulkStatusMenu({ tasks, disabled, onApply, label, className, placement, title }: Props) {
  return (
    <Popover
      className={className ?? "selection-trigger"}
      placement={placement ?? "top"}
      menuLabel="Đổi trạng thái"
      menuClassName="bulk-status-menu"
      disabled={disabled}
      title={title ?? "Đổi trạng thái các công việc đã chọn theo quy trình của Jira"}
      label={label ?? "Đổi trạng thái…"}
    >
      {({ close }) => (
        <BulkStatusPanel
          tasks={tasks}
          onApply={(s, ids, v) => {
            close();
            onApply(s, ids, v);
          }}
        />
      )}
    </Popover>
  );
}

function BulkStatusPanel({ tasks, onApply }: { tasks: Task[]; onApply: Props["onApply"] }) {
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Target | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    // One question per kind of issue in one status — the workflow answers the same for all of them.
    const groups = new Map<string, Task[]>();
    for (const t of tasks) {
      const k = `${t.issueType}|${t.statusName}`;
      groups.set(k, [...(groups.get(k) ?? []), t]);
    }
    Promise.all(
      [...groups.values()].map(async (members) => ({ members, transitions: await api.getTaskTransitions(members[0].id) }))
    )
      .then((answers) => {
        if (!alive) return;
        const byStatus = new Map<string, { category: Target["category"]; ids: string[]; fields: TransitionField[][] }>();
        for (const { members, transitions } of answers) {
          for (const tr of transitions) {
            if (tr.toStatusName === members[0].statusName) continue;
            const hit = byStatus.get(tr.toStatusName) ?? { category: tr.toCategory, ids: [], fields: [] };
            hit.ids.push(...members.map((m) => m.id));
            hit.fields.push(tr.fields);
            byStatus.set(tr.toStatusName, hit);
          }
        }
        setTargets(
          [...byStatus.entries()]
            .map(([status, h]) => ({ status, category: h.category, ids: h.ids, fields: uniqueFields(h.fields) }))
            .sort((a, b) => b.ids.length - a.ids.length || a.status.localeCompare(b.status, "vi"))
        );
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Không tải được các bước chuyển."));
    return () => {
      alive = false;
    };
  }, [tasks]);

  if (chosen) {
    const blocked = missingFields(chosen.fields, values).length > 0;
    return (
      <form
        className="bulk-fields"
        onSubmit={(e) => {
          e.preventDefault();
          if (!blocked) onApply(chosen.status, chosen.ids, values);
        }}
      >
        <div className="menu-heading">Chuyển {chosen.ids.length} việc sang “{chosen.status}”</div>
        <p className="bulk-fields-note">Quy trình yêu cầu nhập thông tin này trước khi chuyển:</p>
        <TransitionFieldsForm fields={chosen.fields} values={values} onChange={setValues} />
        <div className="bulk-fields-actions">
          <button type="button" onClick={() => setChosen(null)}>
            <Icon name="chevronLeft" size={14} />
            Quay lại
          </button>
          <button type="submit" className="primary" disabled={blocked}>
            Chuyển
          </button>
        </div>
      </form>
    );
  }

  return (
    <>
      <div className="menu-heading">Chuyển {tasks.length} việc sang</div>
      {error && <div className="tf-empty is-error">{error}</div>}
      {!targets && !error && <div className="tf-empty">Đang hỏi quy trình Jira…</div>}
      {targets && targets.length === 0 && (
        <div className="tf-empty">Quy trình không cho các công việc đã chọn chuyển sang trạng thái nào khác từ trạng thái hiện tại.</div>
      )}
      {targets?.map((t) => (
        <button
          key={t.status}
          type="button"
          className="menu-item bulk-status-item"
          onClick={() => (t.fields.length > 0 ? setChosen(t) : onApply(t.status, t.ids, {}))}
        >
          <span className={`bulk-dot is-${t.category}`} aria-hidden="true" />
          <span className="menu-item-text">
            {t.status}
            {t.fields.length > 0 && <small>Cần nhập: {t.fields.map((f) => f.name).join(", ")}</small>}
          </span>
          <span className="bulk-count" title={`${t.ids.length} trong ${tasks.length} công việc chuyển được`}>
            {t.ids.length}/{tasks.length}
          </span>
        </button>
      ))}
    </>
  );
}
