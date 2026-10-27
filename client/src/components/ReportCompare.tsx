import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { compareReports, type Direction, type ListDiff, type MetricRow } from "../reportCompare";
import type { Health, ProgressReport, ReportPoint } from "../types";

interface Props {
  history: ReportPoint[];
  /** The report open on the page — the natural thing to compare against. */
  currentId: string | null;
  onClose: () => void;
}

const HEALTH_LABEL: Record<Health, string> = {
  on_track: "Đúng tiến độ",
  at_risk: "Có rủi ro",
  off_track: "Chậm tiến độ",
};

const DIRECTION: Record<Direction, { icon: string; label: string }> = {
  better: { icon: "▲", label: "tốt hơn" },
  worse: { icon: "▼", label: "xấu đi" },
  same: { icon: "●", label: "không đổi" },
};

const fmtDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

function fmt(v: number | null, suffix: string): string {
  return v === null ? "—" : `${v}${suffix}`;
}

function signed(row: MetricRow): string {
  if (row.delta === null) return "—";
  return `${row.delta > 0 ? "+" : ""}${row.delta}${row.suffix === "%" ? " điểm" : ""}`;
}

/**
 * Two saved reports, side by side: each figure with its change, then which risks appeared, went
 * away or stayed. The default pair is the report on the page against the one before it — the
 * question people ask is "what changed since last time".
 */
export default function ReportCompare({ history, currentId, onClose }: Props) {
  // Newest first, as a picker reads best.
  const points = useMemo(() => [...history].sort((a, b) => `${b.asOf}${b.createdAt}`.localeCompare(`${a.asOf}${a.createdAt}`)), [history]);
  const defaultB = points.find((p) => p.id === currentId)?.id ?? points[0]?.id ?? "";
  const defaultA = points.find((p) => p.id !== defaultB)?.id ?? "";
  const [aId, setAId] = useState(defaultA);
  const [bId, setBId] = useState(defaultB);
  const [loaded, setLoaded] = useState<{ key: string; a?: ProgressReport; b?: ProgressReport; error?: string } | null>(null);
  const key = `${aId}|${bId}`;

  useEffect(() => {
    if (!aId || !bId || aId === bId) return;
    let alive = true;
    Promise.all([api.getProgressReport(aId), api.getProgressReport(bId)])
      .then(([a, b]) => alive && setLoaded({ key, a, b }))
      .catch((e: Error) => alive && setLoaded({ key, error: e.message }));
    return () => {
      alive = false;
    };
  }, [aId, bId, key]);

  const answer = loaded?.key === key ? loaded : null;
  const comparison = useMemo(() => (answer?.a && answer.b ? compareReports(answer.a, answer.b) : null), [answer]);

  const option = (p: ReportPoint) => (
    <option key={p.id} value={p.id}>
      {fmtDate(p.asOf)} · {p.actualPct}% · {HEALTH_LABEL[p.health]}
    </option>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal rc-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="So sánh hai báo cáo">
        <div className="modal-header">
          <span className="modal-id">So sánh hai báo cáo</span>
          <button className="modal-close" onClick={onClose} aria-label="Đóng">
            ✕
          </button>
        </div>

        <div className="rc-pick">
          <label className="field">
            <span>Báo cáo</span>
            <select value={aId} onChange={(e) => setAId(e.target.value)}>
              {points.map(option)}
            </select>
          </label>
          <span className="rc-vs" aria-hidden="true">
            so với
          </span>
          <label className="field">
            <span>Báo cáo</span>
            <select value={bId} onChange={(e) => setBId(e.target.value)}>
              {points.map(option)}
            </select>
          </label>
        </div>

        {aId === bId && <p className="pr-muted">Chọn hai báo cáo khác nhau.</p>}
        {aId !== bId && !answer && <p className="pr-muted">Đang mở hai báo cáo...</p>}
        {answer?.error && <div className="modal-error">{answer.error}</div>}

        {comparison && (
          <div className="rc-body">
            <p className="rc-span">
              {fmtDate(comparison.older.asOf)} → {fmtDate(comparison.newer.asOf)} · cách nhau <b>{comparison.daysApart}</b> ngày ·{" "}
              <span className={`rc-dir rc-dir-${comparison.health.direction}`}>
                {HEALTH_LABEL[comparison.health.from]} → {HEALTH_LABEL[comparison.health.to]}
              </span>
            </p>

            <table className="rc-table">
              <thead>
                <tr>
                  <th />
                  <th>{fmtDate(comparison.older.asOf)}</th>
                  <th>{fmtDate(comparison.newer.asOf)}</th>
                  <th>Thay đổi</th>
                </tr>
              </thead>
              <tbody>
                {comparison.metrics.map((m) => (
                  <tr key={m.key}>
                    <th scope="row">{m.label}</th>
                    <td>{fmt(m.a, m.suffix)}</td>
                    <td>{fmt(m.b, m.suffix)}</td>
                    <td className={`rc-dir rc-dir-${m.direction}`}>
                      <span aria-hidden="true">{DIRECTION[m.direction].icon}</span> {signed(m)}
                      <span className="rc-sr"> ({DIRECTION[m.direction].label})</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="rc-heads">
              <div>
                <b>{fmtDate(comparison.older.asOf)}</b>
                <p>{comparison.older.narrative.headline}</p>
              </div>
              <div>
                <b>{fmtDate(comparison.newer.asOf)}</b>
                <p>{comparison.newer.narrative.headline}</p>
              </div>
            </div>

            <Diff title="Rủi ro" diff={comparison.risks} />
            <Diff title="Khuyến nghị" diff={comparison.recommendations} />
          </div>
        )}
      </div>
    </div>
  );
}

function Diff({ title, diff }: { title: string; diff: ListDiff }) {
  if (diff.added.length + diff.resolved.length + diff.kept.length === 0) return null;
  const group = (label: string, tone: string, items: string[]) =>
    items.length > 0 && (
      <div className={`rc-group rc-group-${tone}`}>
        <h5>
          {label} ({items.length})
        </h5>
        <ul>
          {items.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>
    );
  return (
    <section className="rc-diff">
      <h4>{title}</h4>
      <div className="rc-groups">
        {group("Mới xuất hiện", "added", diff.added)}
        {group("Không còn nêu", "resolved", diff.resolved)}
        {group("Vẫn còn", "kept", diff.kept)}
      </div>
    </section>
  );
}
