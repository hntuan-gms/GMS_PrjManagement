import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { IssueLink, LinkType, Task } from "../types";
import SuggestInput from "./SuggestInput";

interface Props {
  task: Task;
  /** The project's tasks, only to offer their keys while typing. */
  allTasks: Task[];
}

/** Every way to say a link: each type has two texts, one per end ("blocks" / "is blocked by"). */
interface Way {
  value: string;
  typeName: string;
  direction: "outward" | "inward";
  label: string;
}

const waysOf = (types: LinkType[]): Way[] =>
  types.flatMap((t) => [
    { value: `${t.name}|outward`, typeName: t.name, direction: "outward" as const, label: t.outward },
    // Same text both ways ("relates to") would be a duplicate choice.
    ...(t.inward !== t.outward ? [{ value: `${t.name}|inward`, typeName: t.name, direction: "inward" as const, label: t.inward }] : []),
  ]);

/**
 * Jira's own issue links (blocks, relates to, duplicates…), shown next to — never
 * merged with — the FS/SS/FF/SF dependencies. A Jira link has no type in our sense
 * and no lag, and does not move a bar, so listing it among the dependencies would
 * promise scheduling it does not do; the note says where to schedule instead.
 */
export default function TaskLinks({ task, allTasks }: Props) {
  const [links, setLinks] = useState<IssueLink[] | null>(null);
  const [types, setTypes] = useState<LinkType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [way, setWay] = useState("");
  const [otherKey, setOtherKey] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .getIssueLinks(task.id)
      .then((l) => alive && setLinks(l))
      .catch((e) => {
        if (!alive) return;
        setLinks([]);
        setError(e instanceof Error ? e.message : "Không tải được liên kết Jira.");
      });
    api
      .listLinkTypes()
      .then((t) => alive && setTypes(t))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [task.id]);

  const ways = useMemo(() => waysOf(types), [types]);
  const chosen = ways.find((w) => w.value === (way || ways[0]?.value));
  // A key for the browse link of an issue in ANOTHER project: same site, so only the key differs.
  const urlOf = (key: string) => task.jiraUrl.replace(/[^/]+$/, key);

  async function add() {
    if (!chosen || !otherKey.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setLinks(await api.addIssueLink(task.id, { typeName: chosen.typeName, otherKey: otherKey.trim(), direction: chosen.direction }));
      setOtherKey("");
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

  return (
    <div className="field">
      <span>Liên kết Jira (issue links)</span>
      <ul className="pred-list">
        {links === null && <li className="muted">Đang tải…</li>}
        {links?.length === 0 && <li className="muted">Không có</li>}
        {links?.map((l) => (
          <li key={l.id}>
            <i>{l.label}</i>{" "}
            <a href={urlOf(l.key)} target="_blank" rel="noreferrer">
              <b>{l.key}</b>
            </a>{" "}
            · {l.summary}
            {l.status && <span className={`link-status is-${l.statusCategory}`}> [{l.status}]</span>}
            <button className="link-btn" onClick={() => remove(l)} disabled={busy}>
              gỡ
            </button>
          </li>
        ))}
      </ul>
      {ways.length > 0 && (
        <div className="pred-add">
          <select value={way || ways[0].value} onChange={(e) => setWay(e.target.value)} aria-label="Kiểu liên kết">
            {ways.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </select>
          <SuggestInput
            value={otherKey}
            onChange={setOtherKey}
            suggestions={allTasks.filter((t) => t.id !== task.id).slice(0, 300).map((t) => ({ value: t.id, hint: t.summary.slice(0, 50) }))}
            placeholder="Mã, ví dụ ABC-12"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <button type="button" onClick={add} disabled={busy || !otherKey.trim()}>
            + Liên kết
          </button>
        </div>
      )}
      <small className="field-note">
        Chỉ để tham khảo — liên kết Jira không dời lịch. Muốn việc này chờ việc kia, dùng “Phụ thuộc” bên dưới.
      </small>
      {error && <small className="field-note is-error">{error}</small>}
    </div>
  );
}
