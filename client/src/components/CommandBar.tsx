import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fold } from "../csvImport";
import type { Task } from "../types";
import { Icon, type IconName } from "./Icons";
import StatusGlyph from "./StatusGlyph";

/**
 * Ctrl K — one box for everything (plan §6.3): a command, a search, a new task written as a
 * sentence, or a question for the assistant. Nobody has to pick a mode first; what is typed
 * decides what the first row offers. Opens with no animation: it is a keyboard action people
 * do dozens of times a day (Raycast has none either).
 */
export interface Command {
  id: string;
  label: string;
  group: string;
  icon?: IconName;
  keys?: string;
  /** Extra words that should find it ("dark" finds "Giao diện tối"). */
  aliases?: string;
  run: () => void;
}

export interface CreatePreview {
  title: string;
  /** One line under the title: type · person · dates · priority… */
  line: string;
  /** Spans of the input that were recognised, for the chips. */
  chips: Array<{ label: string; kind: string; warn?: boolean }>;
}

interface Props {
  tasks: Task[];
  commands: Command[];
  /** Start in "create" mode (the C key). */
  initialMode?: "command" | "create";
  onClose: () => void;
  onOpenTask: (task: Task) => void;
  onCreate: (text: string, open: boolean) => void;
  previewCreate: (text: string) => CreatePreview | null;
  onAsk?: (text: string) => void;
}

type Row =
  | { kind: "command"; cmd: Command }
  | { kind: "task"; task: Task }
  | { kind: "create"; text: string; preview: CreatePreview | null }
  | { kind: "ask"; text: string };

const SEARCH_LIMIT = 8;

/** Tokens that mean the line is a new task, not a search: @person, !priority, ^parent, #label, "sau KEY". */
const CREATE_HINT = /(^|\s)(@\S|!\S|\^\S|#\S|\/\S)|(^|\s)(sau|trước)\s+[A-Z][A-Z0-9]+-\d+/i;

export default function CommandBar({ tasks, commands, initialMode = "command", onClose, onOpenTask, onCreate, previewCreate, onAsk }: Props) {
  const [mode, setMode] = useState<"command" | "create">(initialMode);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreFocus.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => restoreFocus.current?.focus?.();
  }, []);

  const q = query.trim();
  const fq = fold(q);

  const rows: Row[] = useMemo(() => {
    if (mode === "create") {
      return q ? [{ kind: "create", text: q, preview: previewCreate(q) }] : [];
    }
    const out: Row[] = [];
    if (!q) {
      for (const cmd of commands) out.push({ kind: "command", cmd });
      return out;
    }
    const looksLikeCreate = q.startsWith("+") || CREATE_HINT.test(q);
    const createRow: Row = { kind: "create", text: q.replace(/^\+\s*/, ""), preview: previewCreate(q.replace(/^\+\s*/, "")) };
    if (looksLikeCreate) out.push(createRow);
    // Search: key prefix first, then every folded word of the query inside the title.
    const words = fq.split(" ").filter(Boolean);
    const upper = q.toUpperCase();
    const hits = tasks
      .map((t) => {
        const key = t.id.toUpperCase();
        if (key === upper) return { t, score: 0 };
        if (key.startsWith(upper)) return { t, score: 1 };
        const hay = fold(`${t.id} ${t.summary} ${t.assigneeName ?? ""}`);
        return words.every((w) => hay.includes(w)) ? { t, score: 2 } : null;
      })
      .filter((x): x is { t: Task; score: number } => x !== null)
      .sort((a, b) => a.score - b.score || Number(a.t.statusCategory === "done") - Number(b.t.statusCategory === "done"))
      .slice(0, SEARCH_LIMIT);
    for (const h of hits) out.push({ kind: "task", task: h.t });
    for (const cmd of commands) {
      const hay = fold(`${cmd.label} ${cmd.aliases ?? ""} ${cmd.group}`);
      if (words.every((w) => hay.includes(w))) out.push({ kind: "command", cmd });
    }
    if (!looksLikeCreate) out.push(createRow);
    if (onAsk) out.push({ kind: "ask", text: q });
    return out;
  }, [mode, q, fq, tasks, commands, previewCreate, onAsk]);


  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(row: Row | undefined, alt = false) {
    if (!row) return;
    if (row.kind === "command") {
      onClose();
      row.cmd.run();
    } else if (row.kind === "task") {
      onClose();
      onOpenTask(row.task);
    } else if (row.kind === "create") {
      if (!row.text.trim()) return;
      onCreate(row.text, alt);
      // Stay open and empty: making three tasks in a row should not mean pressing C three times.
      setQuery("");
    } else if (row.kind === "ask") {
      onClose();
      onAsk?.(row.text);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(rows.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(rows[active], e.shiftKey);
    } else if (e.key === "Tab" && onAsk && q) {
      // Tab hands the line to the assistant, wherever the cursor is.
      e.preventDefault();
      choose({ kind: "ask", text: q });
    }
  }

  let lastGroup = "";
  const renderRow = (row: Row, i: number): ReactNode => {
    const group =
      row.kind === "command" ? (q ? "Lệnh" : row.cmd.group) : row.kind === "task" ? "Công việc" : row.kind === "create" ? "Tạo việc" : "Trợ lý";
    const heading = group !== lastGroup ? <div className="cmdk-group" key={`g-${group}-${i}`}>{group}</div> : null;
    lastGroup = group;
    const cls = `cmdk-row${i === active ? " is-active" : ""}`;
    const common = {
      "data-row": i,
      className: cls,
      role: "option" as const,
      "aria-selected": i === active,
      onMouseMove: () => setActive(i),
      onClick: () => choose(row),
    };
    let body: ReactNode;
    if (row.kind === "command") {
      body = (
        <div {...common}>
          <Icon name={row.cmd.icon ?? "chevronRight"} size={15} />
          <span className="cmdk-label">{row.cmd.label}</span>
          {row.cmd.keys && <kbd>{row.cmd.keys}</kbd>}
        </div>
      );
    } else if (row.kind === "task") {
      const t = row.task;
      body = (
        <div {...common}>
          <StatusGlyph category={t.statusCategory} percent={t.percentComplete} name={t.statusName} />
          <span className="cmdk-key">{t.id}</span>
          <span className="cmdk-label">{t.summary}</span>
          <span className="cmdk-meta">{t.assigneeName ?? ""}</span>
        </div>
      );
    } else if (row.kind === "create") {
      const p = row.preview;
      body = (
        <div {...common} className={`${cls} cmdk-create`}>
          <Icon name="plus" size={15} />
          <span className="cmdk-create-body">
            <span className="cmdk-label">
              Tạo: <b>{p?.title || row.text || "…"}</b>
            </span>
            {p && (p.chips.length > 0 || p.line) && (
              <span className="cmdk-chips">
                {p.chips.map((c, k) => (
                  <span key={k} className={`qa-chip qa-${c.kind}${c.warn ? " is-warn" : ""}`}>
                    {c.label}
                  </span>
                ))}
                {p.line && <span className="cmdk-meta">{p.line}</span>}
              </span>
            )}
          </span>
          <kbd>Enter</kbd>
        </div>
      );
    } else {
      body = (
        <div {...common}>
          <Icon name="chat" size={15} />
          <span className="cmdk-label">
            Hỏi trợ lý: “{row.text}”
          </span>
          <kbd>Tab</kbd>
        </div>
      );
    }
    return (
      <div key={`${row.kind}-${i}`} className="cmdk-item">
        {heading}
        {body}
      </div>
    );
  };

  return (
    <div className="cmdk-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cmdk" role="dialog" aria-label="Ô lệnh" onKeyDown={onKeyDown}>
        <div className="cmdk-input">
          <Icon name={mode === "create" ? "plus" : "search"} size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              // The list is rebuilt by typing: the cursor goes back to its first row.
              setActive(0);
            }}
            placeholder={
              mode === "create"
                ? "Tên việc… @người t6 3n !cao #nhãn"
                : "Tìm việc, chạy lệnh, tạo việc (+…) hoặc hỏi trợ lý…"
            }
            spellCheck={false}
            aria-label={mode === "create" ? "Tạo việc nhanh" : "Ô lệnh"}
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
          />
          {mode === "create" ? (
            <button
              type="button"
              className="cmdk-mode"
              onClick={() => {
                setMode("command");
                setActive(0);
              }}
            >
              Tạo việc ×
            </button>
          ) : (
            <kbd>Esc</kbd>
          )}
        </div>
        <div className="cmdk-list" id="cmdk-list" role="listbox" ref={listRef}>
          {rows.length === 0 ? (
            <div className="cmdk-empty">
              {mode === "create"
                ? "Gõ tên việc."
                : "Không có gì khớp."}
            </div>
          ) : (
            rows.map(renderRow)
          )}
        </div>
        <div className="cmdk-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> chọn
          </span>
          <span>
            <kbd>Enter</kbd> mở
          </span>
          {mode === "create" && (
            <span>
              <kbd>Shift Enter</kbd> tạo rồi mở
            </span>
          )}
          {onAsk && (
            <span>
              <kbd>Tab</kbd> hỏi trợ lý
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
