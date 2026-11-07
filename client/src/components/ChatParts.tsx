import { useState } from "react";
import { parseUserMessage } from "../chatCompose";
import { startTaskDrag } from "../taskDrag";
import type { ChatChoices, ChatReceiptItem, Task } from "../types";
import { Icon } from "./Icons";
import StatusGlyph from "./StatusGlyph";

/** One issue as a chip: status, key, title. Click opens the task; it can also be dragged on to somewhere else. */
export function TaskChip({
  id,
  summary,
  task,
  onOpen,
  onRemove,
}: {
  id: string;
  summary?: string;
  task?: Task;
  onOpen?: (key: string) => void;
  onRemove?: () => void;
}) {
  const title = task?.summary ?? summary ?? "";
  return (
    <span
      className={`chat-chip${task ? "" : " is-unknown"}`}
      draggable={!!task}
      onDragStart={(e) => startTaskDrag(e, [id], title)}
      data-chip-key={id}
    >
      <button
        type="button"
        className="chat-chip-main"
        disabled={!task || !onOpen}
        onClick={() => onOpen?.(id)}
        title={task ? `${id} · ${title}\nBấm để mở` : title}
      >
        {task && <StatusGlyph category={task.statusCategory} percent={task.percentComplete} name={task.statusName} size={12} />}
        <b>{id}</b>
        {title && <span className="chat-chip-title">{title}</span>}
      </button>
      {onRemove && (
        <button type="button" className="chat-chip-x" onClick={onRemove} aria-label={`Bỏ ${id}`} title="Bỏ">
          <Icon name="x" size={12} />
        </button>
      )}
    </span>
  );
}

/**
 * What the person sent, as they wrote it: mentions as pills, issue keys of this project as buttons,
 * and work they dragged in as a row of chips under the text (clickable, like anywhere in the app).
 */
export function UserText({
  content,
  tasks,
  onOpen,
}: {
  content: string;
  tasks: ReadonlyMap<string, Task>;
  onOpen?: (key: string) => void;
}) {
  const { segments, tasks: attached } = parseUserMessage(content);
  return (
    <>
      {segments.length > 0 && (
        <span className="chat-user-text">
          {segments.map((s, i) =>
            s.kind === "text" ? (
              <span key={i}>{s.text}</span>
            ) : s.kind === "mention" ? (
              <span key={i} className="chat-mention" title={s.name}>
                @{s.name}
              </span>
            ) : tasks.has(s.key) && onOpen ? (
              <button key={i} type="button" className="chat-issue is-on-strong" onClick={() => onOpen(s.key)} title="Mở việc">
                {s.key}
              </button>
            ) : (
              <span key={i}>{s.key}</span>
            )
          )}
        </span>
      )}
      {attached.length > 0 && (
        <span className="chat-chip-row">
          {attached.map((a) => (
            <TaskChip key={a.key} id={a.key} summary={a.summary} task={tasks.get(a.key)} onOpen={onOpen} />
          ))}
        </span>
      )}
    </>
  );
}

/** A decision the assistant needs, as buttons: one click sends the sentence that answers it. */
export function ChoiceButtons({ choices, onPick }: { choices: ChatChoices; onPick: (message: string) => void }) {
  return (
    <div className="chat-choices" role="group" aria-label={choices.prompt}>
      {choices.options.map((o) => (
        <button key={o.label} type="button" className={`chat-choice${o.tone === "danger" ? " is-danger" : ""}`} onClick={() => onPick(o.message)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** What was written to Jira, a line per issue, with "Hoàn tác" where the change can be put back. */
export function Receipts({
  items,
  tasks,
  onOpen,
  onUndo,
}: {
  items: ChatReceiptItem[];
  tasks: ReadonlyMap<string, Task>;
  onOpen?: (key: string) => void;
  onUndo: (item: ChatReceiptItem) => void;
}) {
  return (
    <ul className="chat-receipts">
      {items.map((r, i) => (
        <li key={`${r.key}-${i}`} className={r.undone ? "is-undone" : ""}>
          <Icon name="check" size={13} />
          {tasks.has(r.key) && onOpen ? (
            <button type="button" className="chat-receipt-text" onClick={() => onOpen(r.key)} title="Mở việc">
              {r.text}
            </button>
          ) : (
            <span className="chat-receipt-text">{r.text}</span>
          )}
          {r.undo && !r.undone && (
            <button type="button" className="chat-receipt-undo" onClick={() => onUndo(r)}>
              Hoàn tác
            </button>
          )}
          {r.undone && <span className="chat-receipt-done">Đã hoàn tác</span>}
        </li>
      ))}
    </ul>
  );
}

/** The steps taken this turn: finished ones ticked, the current one turning. Folds to one line once the answer starts. */
export function Steps({ steps, folded }: { steps: Array<{ label: string; done: boolean }>; folded: boolean }) {
  if (steps.length === 0) return null;
  if (folded) {
    return (
      <div className="chat-steps is-folded" title={steps.map((s) => s.label).join("\n")}>
        <Icon name="check" size={12} /> {steps.length} bước
      </div>
    );
  }
  return (
    <ul className="chat-steps">
      {steps.map((s, i) => (
        <li key={i} className={s.done ? "is-done" : ""}>
          {s.done ? <Icon name="check" size={12} /> : <span className="chat-spinner" />}
          {s.label.replace(/\.{3}$|…$/, "")}
        </li>
      ))}
    </ul>
  );
}

/** Reasoning is not narrated while it streams: a turning dot while it runs, a quiet link to read it afterwards. */
export function ThinkingBlock({ text, live = false }: { text: string; live?: boolean }) {
  const [open, setOpen] = useState(false);
  if (live) {
    return (
      <div className="chat-thinking chat-thinking-live">
        <span className="chat-spinner" /> Đang nghĩ
      </div>
    );
  }
  return (
    <div className="chat-thinking">
      <button type="button" className="chat-thinking-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Icon name={open ? "chevronDown" : "chevronRight"} size={12} /> Xem suy luận
      </button>
      {open && <pre className="chat-thinking-full">{text}</pre>}
    </div>
  );
}
