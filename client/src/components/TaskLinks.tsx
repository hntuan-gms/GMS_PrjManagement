import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { LIST_MAX_AGE_MS, TASK_MAX_AGE_MS } from "../detailCache";
import { projectLists, readers } from "../taskDetailReads";
import { useDetail } from "../useDetail";
import Spinner from "./Spinner";
import type { IssueLink, LinkType, Task } from "../types";
import TaskPicker from "./TaskPicker";
import { Icon } from "./Icons";
import StatusGlyph from "./StatusGlyph";
import { linkLabel } from "../linkLabels";

interface Props {
  task: Task;
  /** The project's tasks, only to offer their keys while typing. */
  allTasks: Task[];
  /** The number of links once known, for the count in the section's header. */
  onCount?: (n: number | null) => void;
  /** Keeps loading (so the count is known) while the section is not shown. */
  hidden?: boolean;
}

/** A Jira key, possibly of another project: links may cross projects, unlike our own dependencies. */
const KEY_RE = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

/** Every way to say a link: each type has two texts, one per end ("blocks" / "is blocked by"). */
interface Way {
  value: string;
  typeName: string;
  direction: "outward" | "inward";
  label: string;
}

const NO_LINKS: IssueLink[] = [];
const NO_TYPES: LinkType[] = [];

const waysOf = (types: LinkType[]): Way[] =>
  types.flatMap((t) => [
    { value: `${t.name}|outward`, typeName: t.name, direction: "outward" as const, label: linkLabel(t.outward) },
    // Same text both ways ("relates to") would be a duplicate choice.
    ...(t.inward !== t.outward ? [{ value: `${t.name}|inward`, typeName: t.name, direction: "inward" as const, label: linkLabel(t.inward) }] : []),
  ]);

/**
 * Jira's own issue links (blocks, relates to, duplicates…), shown next to — never
 * merged with — the FS/SS/FF/SF dependencies. A Jira link has no type in our sense
 * and no lag, and does not move a bar, so listing it among the dependencies would
 * promise scheduling it does not do; the note says where to schedule instead.
 */
export default function TaskLinks({ task, allTasks, onCount, hidden }: Props) {
  // Held answers show at once on reopening; the read behind them replaces them (detailCache).
  const linksRead = useDetail("links", task.id, () => readers.links(task.id), TASK_MAX_AGE_MS);
  const typesRead = useDetail("list:linkTypes", "", () => projectLists.linkTypes(), LIST_MAX_AGE_MS);
  const links: IssueLink[] | null = linksRead.value ?? (linksRead.error ? NO_LINKS : null);
  const setLinks = (next: IssueLink[]) => linksRead.set(next);
  const types: LinkType[] = typesRead.value ?? NO_TYPES;
  const [actionError, setActionError] = useState<string | null>(null);
  const error = actionError ?? linksRead.error;
  const setError = setActionError;
  const [way, setWay] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickRect, setPickRect] = useState<DOMRect | null>(null);
  // The add row stays folded behind "+ Liên kết" while there are links; with none it is open.
  const [adding, setAdding] = useState<boolean | null>(null);
  const pickRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    onCount?.(links === null ? null : links.length);
  }, [links, onCount]);

  const ways = useMemo(() => waysOf(types), [types]);
  const chosen = ways.find((w) => w.value === (way || ways[0]?.value));
  // A key for the browse link of an issue in ANOTHER project: same site, so only the key differs.
  const urlOf = (key: string) => task.jiraUrl.replace(/[^/]+$/, key);

  async function add(otherKey: string) {
    if (!chosen || !otherKey.trim()) return;
    setPickRect(null);
    setAdding(false);
    setBusy(true);
    setError(null);
    try {
      setLinks(await api.addIssueLink(task.id, { typeName: chosen.typeName, otherKey: otherKey.trim().toUpperCase(), direction: chosen.direction }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo được liên kết.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(link: IssueLink) {
    setBusy(true);
    setError(null);
    try {
      setLinks(await api.removeIssueLink(task.id, link.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không gỡ được liên kết.");
    } finally {
      setBusy(false);
    }
  }

  if (hidden) return null;
  return (
    <div className="td-stack">
      {links === null && <Spinner block className="spinner-inline" />}
      {links && links.length > 0 && (
      <ul className="pred-list">
        {links.map((l) => (
          <li key={l.id}>
            <span className="pred-text">
              <span className="tl-way">{linkLabel(l.label)}</span>{" "}
              <a className="tl-key" href={urlOf(l.key)} target="_blank" rel="noreferrer">
                {l.key}
              </a>{" "}
              {l.summary}
              {l.status && (
                <span className="tl-status" title={l.status}>
                  {" "}
                  <StatusGlyph category={l.statusCategory ?? "new"} name={l.status} size={12} />
                </span>
              )}
            </span>
            <button className="tl-x" onClick={() => remove(l)} disabled={busy} aria-label={`Gỡ liên kết ${l.key}`} title="Gỡ liên kết">
              <Icon name="x" size={12} />
            </button>
          </li>
        ))}
      </ul>
      )}
      {ways.length > 0 && !(adding ?? (links !== null && links.length === 0)) && (
        <button type="button" className="td-add-btn" onClick={() => setAdding(true)}>
          <Icon name="plus" size={13} />
          Liên kết
        </button>
      )}
      {ways.length > 0 && (adding ?? (links !== null && links.length === 0)) && (
        <div className="pred-add">
          <select value={way || ways[0].value} onChange={(e) => setWay(e.target.value)} aria-label="Kiểu liên kết">
            {ways.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </select>
          {/* Pick from the project, or type a key (another project's too: Jira links cross projects). */}
          <button
            ref={pickRef}
            type="button"
            className="td-add-btn"
            disabled={busy}
            onClick={() => setPickRect(pickRef.current?.getBoundingClientRect() ?? null)}
          >
            <Icon name="plus" size={13} />
            Chọn việc
          </button>
        </div>
      )}
      {pickRect && (
        <TaskPicker
          anchor={pickRect}
          tasks={allTasks}
          exclude={[task.id]}
          placeholder="Mã hoặc tên việc"
          typed={(q) => {
            const key = q.trim().toUpperCase();
            return KEY_RE.test(key) && !allTasks.some((t) => t.id === key) ? { value: key, label: "Dùng mã này" } : null;
          }}
          onPickTyped={(key) => void add(key)}
          onPick={(t) => void add(t.id)}
          onClose={() => setPickRect(null)}
        />
      )}
      {error && <small className="field-note is-error">{error}</small>}
    </div>
  );
}
