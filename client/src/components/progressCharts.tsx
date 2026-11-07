import Avatar from "./Avatar";
import { pct, phaseStatus } from "../projectPulse";
import type { ResourceLoad } from "../resourceAllocation";
import type { ProgressMetrics } from "../types";

/**
 * The pieces "Nhịp dự án" draws. Plain HTML/CSS, no chart library. One encoding across the page: work done
 * is ink, the plan is a thin vertical tick on the same track, and red appears only beside a word that says
 * why ("chậm 57 điểm", "2 quá hạn", "140%").
 */


const clamp = (v: number) => Math.min(100, Math.max(0, v));

/** Done as the fill, the plan as a tick. The page's one progress bar, and the small one in each Epic row. */
export function ProgressLine({ actual, planned, tone, size = "lg" }: { actual: number; planned: number; tone?: "risk"; size?: "lg" | "sm" }) {
  return (
    <span
      className={`np-line is-${size}${tone === "risk" ? " is-risk" : ""}`}
      role="img"
      aria-label={`Đã xong ${pct(actual)}, kế hoạch ${pct(planned)}`}
    >
      <span className="np-line-fill" style={{ width: `${clamp(actual)}%` }} />
      {planned > 0 && <span className="np-line-plan" style={{ left: `${clamp(planned)}%` }} />}
    </span>
  );
}

/**
 * One row per Epic: the bar, the % done, and how far off the plan it is in words. "Ngoài Epic" only appears
 * when there are Epics for work to be outside of; a project without Epics has no table at all.
 */
export function EpicTable({
  phases,
  dated,
  onSelect,
}: {
  phases: ProgressMetrics["phases"];
  /** Epic id (null = outside any Epic) → whether any work under it has dates. */
  dated: (id: string | null) => boolean;
  onSelect: (id: string | null, label: string) => void;
}) {
  return (
    <div className="np-table np-epics">
      <div className="np-tr np-th" aria-hidden="true">
        <span>Epic</span>
        <span>Tiến độ</span>
        <span className="np-num" />
        <span>Lệch kế hoạch</span>
      </div>
      {phases.map((p) => {
        const st = phaseStatus(p, dated(p.id));
        const label = p.id ? p.summary : "Ngoài Epic";
        return (
          <button key={p.id ?? "none"} type="button" className="np-tr" onClick={() => onSelect(p.id, label)} title={`${p.done}/${p.total} việc xong`} aria-label={`${label}: xong ${pct(p.actualPct)}, ${st.text}`}>
            <span className="np-name">
              {p.id && <span className="np-key">{p.id}</span>}
              <span className="np-ellipsis">{label}</span>
            </span>
            <span>
              <ProgressLine actual={p.actualPct} planned={p.plannedPct} size="sm" tone={st.tone === "risk" ? "risk" : undefined} />
            </span>
            <span className="np-num">
              {pct(p.actualPct)}
            </span>
            <span className={`np-dev is-${st.tone}`}>
              {st.text}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * One row per person: open work, overdue work, and load over the next two weeks — the same numbers Nhân lực
 * draws (buildResourceLoad), so the two pages never disagree about who is overloaded.
 */
export function PeopleTable({
  people,
  load,
  onSelect,
}: {
  people: ProgressMetrics["people"];
  load: ResourceLoad | null;
  onSelect: (accountId: string | null, label: string) => void;
}) {
  const byId = new Map((load?.people ?? []).map((p) => [p.accountId, p]));
  const rows = [...people].sort((a, b) => Number(!a.accountId) - Number(!b.accountId) || b.overdue - a.overdue || b.open - a.open || a.name.localeCompare(b.name, "vi"));
  return (
    <div className="np-table np-people">
      <div className="np-tr np-th" aria-hidden="true">
        <span>Người</span>
        <span className="np-num">
          Đang mở
        </span>
        <span className="np-num">
          Quá hạn
        </span>
        <span>Tải 2 tuần tới</span>
      </div>
      {rows.map((p) => {
        const l = p.accountId ? byId.get(p.accountId) : undefined;
        const util = l ? Math.round(l.utilisation * 100) : null;
        const over = !!l && (l.overloadedDays > 0 || l.utilisation > 1);
        return (
          <button
            key={p.accountId ?? "none"}
            type="button"
            className="np-tr"
            onClick={() => onSelect(p.accountId, p.name)}
            aria-label={`${p.name}: ${p.open} việc đang mở${p.overdue ? `, ${p.overdue} quá hạn` : ""}${util !== null ? `, tải 2 tuần tới ${util}%` : ""}`}
          >
            <span className="np-name">
              <Avatar name={p.accountId ? p.name : null} avatarUrl={null} className="np-avatar" />
              <span className="np-ellipsis">{p.name}</span>
            </span>
            <span className="np-num">
              {p.open || ""}
            </span>
            <span className="np-num is-risk">
              {p.overdue || ""}
            </span>
            <span className="np-load" title={l && l.overloadedDays > 0 ? `${l.overloadedDays} ngày vượt công suất trong 2 tuần tới` : undefined}>
              {util !== null && (
                <>
                  <span className={`np-load-bar${over ? " is-over" : ""}`} aria-hidden="true">
                    <span style={{ width: `${clamp(util)}%` }} />
                  </span>
                  <span className={`np-load-val${over ? " is-risk" : ""}`}>
                    <b>{util}%</b>
                    {l && l.overloadedDays > 0 ? ` · ${l.overloadedDays} ngày quá tải` : ""}
                  </span>
                </>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
