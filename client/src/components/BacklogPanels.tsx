import { useMemo, useState } from "react";
import { epicRollup, shortDate, versionRollup, type BoardFilter } from "../boardModel";
import type { BoardSnapshot } from "../types";

interface Props {
  snapshot: BoardSnapshot;
  unit: string;
  filter: BoardFilter;
  onFilterChange: (f: BoardFilter) => void;
}

type Tab = "epic" | "version";

/**
 * Backlog's left panel: the Epics and the Versions, each with how far along it is. A row is a
 * filter — clicking it narrows the backlog to that Epic or release (the same `BoardFilter` the
 * toolbar edits, so the chip and "Xoá lọc" there undo it), and clicking again lifts it.
 *
 * Counts come from the whole board, not from the filtered list: a panel that shrinks to what is
 * already filtered could not be used to pick the next Epic.
 */
export default function BacklogPanels({ snapshot, unit, filter, onFilterChange }: Props) {
  const [tab, setTab] = useState<Tab>("epic");
  const [hideDone, setHideDone] = useState(true);

  const epics = useMemo(() => epicRollup(snapshot.issues, snapshot), [snapshot]);
  const versions = useMemo(() => versionRollup(snapshot.issues, snapshot.versions, snapshot), [snapshot]);
  const rows = tab === "epic" ? epics : versions;
  const selected = tab === "epic" ? filter.epics : filter.versions;
  const shown = rows.filter((r) => !hideDone || selected.has(r.key) || (tab === "epic" ? r.done < r.total : !r.released));

  function toggle(key: string) {
    const field = tab === "epic" ? "epics" : "versions";
    const next = new Set(filter[field]);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onFilterChange({ ...filter, [field]: next });
  }

  return (
    <aside className="bl-panel" aria-label="Epic và phiên bản">
      <div className="bd-seg bl-panel-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "epic"} className={tab === "epic" ? "is-active" : ""} onClick={() => setTab("epic")}>
          Epic
        </button>
        <button role="tab" aria-selected={tab === "version"} className={tab === "version" ? "is-active" : ""} onClick={() => setTab("version")}>
          Phiên bản
        </button>
      </div>
      <label className="bl-panel-hide">
        <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
        {tab === "epic" ? "Ẩn Epic đã xong" : "Ẩn bản đã phát hành"}
      </label>

      {shown.length === 0 && (
        <div className="bd-muted bl-panel-empty">
          {tab === "epic" ? "Chưa có việc nào thuộc một Epic." : "Dự án chưa có phiên bản nào, hoặc đều đã phát hành."}
        </div>
      )}
      <ul className="bl-panel-list">
        {shown.map((r) => {
          const on = selected.has(r.key);
          const pct = r.total > 0 ? Math.round((r.done / r.total) * 100) : 0;
          return (
            <li key={r.key}>
              <button
                type="button"
                className={`bl-panel-row ${on ? "is-on" : ""}`}
                aria-pressed={on}
                onClick={() => toggle(r.key)}
                title={r.key === "none" ? undefined : r.key}
              >
                <span className="bl-panel-name">
                  {r.label}
                  {tab === "version" && r.releaseDate && <small>{r.released ? "đã phát hành " : "dự kiến "}{shortDate(r.releaseDate)}</small>}
                </span>
                <span className="bl-panel-count">
                  {r.done}/{r.total}
                </span>
                <span className="bl-panel-bar" aria-hidden="true">
                  <span style={{ width: `${pct}%` }} />
                </span>
                {snapshot.estimation && r.openWeight > 0 && (
                  <small className="bl-panel-weight">
                    còn {r.openWeight} {unit}
                  </small>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
