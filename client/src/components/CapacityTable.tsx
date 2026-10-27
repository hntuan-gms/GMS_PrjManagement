import { useState } from "react";
import { shortDate, type CapacityRow } from "../boardModel";

interface Props {
  rows: CapacityRow[];
  window: { start: string; end: string; lengthDays: number };
  unit: string;
  /** Whether the board's estimate is in hours — only then can remaining capacity be subtracted. */
  inHours: boolean;
}

const STATUS: Record<CapacityRow["status"], { label: string; tone: string } | null> = {
  away: { label: "Vắng cả sprint", tone: "crit" },
  over: { label: "Quá tải", tone: "crit" },
  tight: { label: "Sát giới hạn", tone: "warn" },
  free: { label: "Còn trống", tone: "good" },
  ok: null,
};

/** Rows shown before "Hiện thêm": the people with something to look at come first. */
const COLLAPSED_ROWS = 8;

/**
 * Per-person capacity for a sprint window: how many working days (leave already taken out) and
 * hours each person has, what they have been given, and what is left. Shared by the Backlog's
 * "Năng lực" panel and the AI plan dialog, so the number planning is judged by is the same in both.
 */
export default function CapacityTable({ rows, window, unit, inHours }: Props) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, COLLAPSED_ROWS);
  return (
    <div className="cap">
      <div className="cap-head bd-muted">
        {shortDate(window.start)} → {shortDate(window.end)} · năng lực = ngày làm việc (đã trừ ngày nghỉ) × giờ/ngày
        {!inHours && ` · ước lượng tính bằng ${unit} nên không trừ được thành giờ còn lại`}
      </div>
      <table className="cap-table">
        <thead>
          <tr>
            <th>Thành viên</th>
            <th>Ngày làm</th>
            <th>Năng lực</th>
            <th>Đã giao</th>
            {inHours && <th>Còn lại</th>}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const status = STATUS[r.status];
            return (
              <tr key={r.accountId ?? "orphans"} className={status ? `cap-${status.tone}` : ""}>
                <th scope="row">
                  {r.name}
                  {status && <span className={`cap-flag cap-flag-${status.tone}`}>{status.label}</span>}
                </th>
                <td>{r.accountId ? r.days : "—"}</td>
                <td>{r.accountId ? `${r.capacityHours}h` : "—"}</td>
                <td>
                  {r.count} việc{r.weight > 0 && r.count > 0 ? ` · ${r.weight} ${unit}` : ""}
                </td>
                {inHours && <td>{r.remainingHours === null ? "—" : `${r.remainingHours}h`}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > COLLAPSED_ROWS && (
        <button className="text-btn" onClick={() => setAll((v) => !v)}>
          {all ? "Thu gọn" : `Hiện thêm ${rows.length - COLLAPSED_ROWS} người`}
        </button>
      )}
    </div>
  );
}
