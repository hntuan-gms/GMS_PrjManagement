import type { FlowReport, SprintReport, VelocityPoint } from "../types";

/**
 * The Agile report charts. Plain SVG like progressCharts.tsx: each is one shape and a chart library
 * would outweigh them. Marks carry a `<title>` so hovering names the value, and every chart has a
 * text label for screen readers; colour is never the only way to tell two series apart (the
 * second series is dashed or a different shape).
 */

const W = 560;
const H = 200;
const PAD = { top: 14, right: 12, bottom: 26, left: 40 };
const innerW = W - PAD.left - PAD.right;
const innerH = H - PAD.top - PAD.bottom;

const shortDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** A y axis that stops on a round number: 0..max with about four gridlines. */
function niceMax(max: number): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 1, ticks: [0, 1] };
  const exp = Math.pow(10, Math.floor(Math.log10(max)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * exp).find((s) => max / s <= 5) ?? exp * 10;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  return { top, ticks };
}

function Axes({ ticks, top, unit }: { ticks: number[]; top: number; unit?: string }) {
  const y = (v: number) => PAD.top + (1 - v / top) * innerH;
  return (
    <>
      {ticks.map((t) => (
        <g key={t}>
          <line className={t === 0 ? "pr-axis" : "pr-grid"} x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
          <text className="pr-tick" x={PAD.left - 6} y={y(t) + 3.5} textAnchor="end">
            {t}
          </text>
        </g>
      ))}
      {unit && (
        <text className="pr-tick" x={PAD.left - 6} y={PAD.top - 4} textAnchor="end">
          {unit}
        </text>
      )}
    </>
  );
}

/** Evenly thinned x labels so a 90-day axis does not print 90 dates. */
function xLabels(labels: string[], x: (i: number) => number, max = 7) {
  const every = Math.max(1, Math.ceil(labels.length / max));
  return labels.map((l, i) =>
    i % every === 0 || i === labels.length - 1 ? (
      <text key={l + i} className="pr-tick" x={x(i)} y={H - 8} textAnchor="middle">
        {shortDate(l)}
      </text>
    ) : null
  );
}

function Legend({ items }: { items: Array<{ className: string; label: string }> }) {
  return (
    <div className="pr-legend ag-legend" aria-hidden="true">
      {items.map((i) => (
        <span key={i.label}>
          <i className={`pr-key ${i.className}`} /> {i.label}
        </span>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- velocity */

export function VelocityChart({ points, unit, byCount }: { points: VelocityPoint[]; unit: string; byCount: boolean }) {
  if (points.length === 0) return <p className="pr-muted">Chưa có sprint nào hoàn thành để tính vận tốc.</p>;
  const value = (p: VelocityPoint) => (byCount ? p.completedCount : p.completed);
  const { top, ticks } = niceMax(Math.max(...points.map(value)));
  const slot = innerW / points.length;
  const barW = Math.min(46, slot * 0.6);
  const x = (i: number) => PAD.left + slot * i + slot / 2;
  const y = (v: number) => PAD.top + (1 - v / top) * innerH;
  // Average of the last three — the budget the backlog's meter is measured against.
  const last3 = points.slice(-3).map(value);
  const avg = last3.reduce((s, v) => s + v, 0) / last3.length;
  return (
    <div className="ag-chart">
      <Legend items={[{ className: "ag-key-bar", label: `Đã hoàn thành (${byCount ? "việc" : unit})` }, { className: "ag-key-avg", label: "Trung bình 3 sprint gần nhất" }]} />
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Vận tốc ${points.length} sprint gần nhất, trung bình ${Math.round(avg * 10) / 10} ${byCount ? "việc" : unit}`}>
        <Axes ticks={ticks} top={top} />
        {points.map((p, i) => (
          <g key={p.sprintId}>
            <rect className="ag-bar" x={x(i) - barW / 2} y={y(value(p))} width={barW} height={Math.max(0, y(0) - y(value(p)))} rx={3}>
              <title>{`${p.name}: ${value(p)} ${byCount ? "việc" : unit}`}</title>
            </rect>
            <text className="pr-tick" x={x(i)} y={y(value(p)) - 4} textAnchor="middle">
              {value(p)}
            </text>
            <text className="pr-tick" x={x(i)} y={H - 8} textAnchor="middle">
              {p.name.length > 12 ? `…${p.name.slice(-10)}` : p.name}
            </text>
          </g>
        ))}
        <line className="ag-avg-line" x1={PAD.left} x2={W - PAD.right} y1={y(avg)} y2={y(avg)} />
      </svg>
      <p className="pr-muted ag-note">
        Chỉ tính phần <b>đã hoàn thành</b> trong khoảng thời gian của từng sprint; “cam kết” ban đầu cần báo cáo sprint — xem tab Sprint.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ burnup */

export function BurnupChart({ series, unit }: { series: SprintReport["burnup"]; unit: string }) {
  if (series.length < 2) return <p className="pr-muted">Sprint chưa có đủ ngày để vẽ burnup.</p>;
  const { top, ticks } = niceMax(Math.max(...series.map((p) => p.scope), ...series.map((p) => p.completed)));
  const x = (i: number) => PAD.left + (i / (series.length - 1)) * innerW;
  const y = (v: number) => PAD.top + (1 - v / top) * innerH;
  // Scope is a step line: it changes at a moment, not gradually.
  const scope = series.map((p, i) => `${i === 0 ? "M" : `L${x(i).toFixed(1)},${y(series[i - 1].scope).toFixed(1)} L`}${x(i).toFixed(1)},${y(p.scope).toFixed(1)}`).join(" ");
  const done = series.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.completed).toFixed(1)}`).join(" ");
  const last = series[series.length - 1];
  return (
    <div className="ag-chart">
      <Legend items={[{ className: "pr-key-actual", label: "Đã xong" }, { className: "ag-key-scope", label: "Phạm vi sprint" }]} />
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Burnup: ${last.completed} trên phạm vi ${last.scope} ${unit}`}>
        <Axes ticks={ticks} top={top} unit={unit} />
        <path className="ag-scope-line" d={scope} />
        <path className="pr-line pr-line-actual" d={done} />
        <circle className="pr-dot pr-dot-actual" cx={x(series.length - 1)} cy={y(last.completed)} r={3.5} />
        {series.map((p, i) => (
          <circle key={p.date} className="ag-hit" cx={x(i)} cy={y(p.completed)} r={6}>
            <title>{`${shortDate(p.date)}: xong ${p.completed} / phạm vi ${p.scope} ${unit}`}</title>
          </circle>
        ))}
        {xLabels(series.map((p) => p.date), x)}
      </svg>
    </div>
  );
}

/* --------------------------------------------------------- cumulative flow */

export function CfdChart({ cfd }: { cfd: FlowReport["cfd"] }) {
  const n = cfd.dates.length;
  if (n < 2 || cfd.series.length === 0) return <p className="pr-muted">Chưa đủ dữ liệu để vẽ biểu đồ luồng.</p>;
  const totals = cfd.dates.map((_, i) => cfd.series.reduce((s, x) => s + x.counts[i], 0));
  const { top, ticks } = niceMax(Math.max(...totals));
  const x = (i: number) => PAD.left + (i / (n - 1)) * innerW;
  const y = (v: number) => PAD.top + (1 - v / top) * innerH;
  // Stack from the *last* status (Done) at the bottom up to the first (To Do) on top — the
  // orientation Jira's own chart uses, so the band widths read as work in progress.
  const order = [...cfd.series].reverse();
  const cum = cfd.dates.map(() => 0);
  const perCategory = new Map<string, number>();
  const areas = order.map((s) => {
    const idx = perCategory.get(s.category) ?? 0;
    perCategory.set(s.category, idx + 1);
    const lower = [...cum];
    s.counts.forEach((v, i) => (cum[i] += v));
    const top_ = cum.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const bottom = lower.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).reverse();
    return { s, idx, d: `M${top_.join(" L")} L${bottom.join(" L")} Z` };
  });
  return (
    <div className="ag-chart">
      <div className="pr-legend ag-legend" aria-hidden="true">
        {order.map((s) => (
          <span key={s.statusId}>
            <i className={`ag-swatch ag-band-${s.category}`} /> {s.name}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Luồng công việc theo trạng thái trong ${n} ngày, hiện có ${totals[n - 1]} việc`}>
        <Axes ticks={ticks} top={top} unit="việc" />
        {areas.map(({ s, idx, d }) => (
          <path key={s.statusId} className={`ag-band ag-band-${s.category}`} style={{ fillOpacity: Math.max(0.35, 1 - idx * 0.22) }} d={d}>
            <title>{`${s.name}: ${s.counts[n - 1]} việc (cuối kỳ)`}</title>
          </path>
        ))}
        {xLabels(cfd.dates, x)}
      </svg>
    </div>
  );
}

/* ----------------------------------------------------------- control chart */

export function ControlChart({ report, metric }: { report: FlowReport["control"]; metric: "cycle" | "lead" }) {
  const rows = report.points
    .map((p, i) => ({ p, value: metric === "cycle" ? p.cycleDays : p.leadDays, rolling: metric === "cycle" ? report.cycleRolling[i] : report.leadRolling[i] }))
    .filter((r): r is { p: typeof r.p; value: number; rolling: number | null } => r.value !== null);
  const stats = metric === "cycle" ? report.cycle : report.lead;
  if (rows.length === 0 || !stats) {
    return <p className="pr-muted">{metric === "cycle" ? "Chưa có việc nào vừa hoàn thành đã đi qua trạng thái “đang làm”." : "Chưa có việc nào hoàn thành trong kỳ này."}</p>;
  }
  const { top, ticks } = niceMax(Math.max(...rows.map((r) => r.value), stats.p95));
  const dates = rows.map((r) => r.p.date);
  const t0 = Date.parse(dates[0] + "T00:00:00Z");
  const t1 = Math.max(Date.parse(dates[dates.length - 1] + "T00:00:00Z"), t0 + 86_400_000);
  const x = (date: string) => PAD.left + ((Date.parse(date + "T00:00:00Z") - t0) / (t1 - t0)) * innerW;
  const y = (v: number) => PAD.top + (1 - v / top) * innerH;
  const rolling = rows.filter((r) => r.rolling !== null).map((r, i) => `${i === 0 ? "M" : "L"}${x(r.p.date).toFixed(1)},${y(r.rolling!).toFixed(1)}`).join(" ");
  return (
    <div className="ag-chart">
      <Legend
        items={[
          { className: "ag-key-dot", label: "Một việc đã xong" },
          { className: "pr-key-actual", label: "Trung bình trượt (5 việc)" },
          { className: "ag-key-avg", label: "P85 — 85% việc xong trong ngần này" },
        ]}
      />
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${metric === "cycle" ? "Cycle time" : "Lead time"}: trung bình ${stats.mean} ngày, P85 ${stats.p85} ngày`}>
        <Axes ticks={ticks} top={top} unit="ngày" />
        <line className="ag-avg-line" x1={PAD.left} x2={W - PAD.right} y1={y(stats.p85)} y2={y(stats.p85)} />
        <text className="pr-endlabel" x={W - PAD.right} y={y(stats.p85) - 4} textAnchor="end">
          P85 {stats.p85}n
        </text>
        {rolling && <path className="pr-line pr-line-actual" d={rolling} />}
        {rows.map((r) => (
          <circle key={r.p.key} className="ag-dot" cx={x(r.p.date)} cy={y(r.value)} r={3.5}>
            <title>{`${r.p.key} · xong ${shortDate(r.p.date)} · ${r.value} ngày`}</title>
          </circle>
        ))}
        <text className="pr-tick" x={PAD.left} y={H - 8} textAnchor="start">
          {shortDate(dates[0])}
        </text>
        <text className="pr-tick" x={W - PAD.right} y={H - 8} textAnchor="end">
          {shortDate(dates[dates.length - 1])}
        </text>
      </svg>
      <p className="ag-stats">
        <span>
          <b>{stats.count}</b> việc
        </span>
        <span>
          Trung bình <b>{stats.mean}</b> ngày
        </span>
        <span>
          Trung vị <b>{stats.p50}</b>
        </span>
        <span>
          P85 <b>{stats.p85}</b>
        </span>
        <span>
          P95 <b>{stats.p95}</b>
        </span>
      </p>
    </div>
  );
}

/* ------------------------------------------------- created vs resolved */

export function CreatedResolvedChart({ data }: { data: FlowReport["created"] }) {
  const { buckets, bucket } = data;
  if (buckets.length === 0) return <p className="pr-muted">Không có dữ liệu trong kỳ này.</p>;
  const { top, ticks } = niceMax(Math.max(1, ...buckets.map((b) => Math.max(b.created, b.resolved))));
  const slot = innerW / buckets.length;
  const barW = Math.max(2, Math.min(18, slot * 0.38));
  const x = (i: number) => PAD.left + slot * i + slot / 2;
  const y = (v: number) => PAD.top + (1 - v / top) * innerH;
  const created = buckets.reduce((s, b) => s + b.created, 0);
  const resolved = buckets.reduce((s, b) => s + b.resolved, 0);
  return (
    <div className="ag-chart">
      <Legend items={[{ className: "ag-key-created", label: "Tạo mới" }, { className: "ag-key-resolved", label: "Đã xong" }]} />
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Tạo ${created} việc, xong ${resolved} việc trong kỳ`}>
        <Axes ticks={ticks} top={top} unit="việc" />
        {buckets.map((b, i) => (
          <g key={b.start}>
            <rect className="ag-created" x={x(i) - barW - 1} y={y(b.created)} width={barW} height={Math.max(0, y(0) - y(b.created))} rx={2}>
              <title>{`${bucket === "week" ? "Tuần " : ""}${shortDate(b.start)}: tạo ${b.created}`}</title>
            </rect>
            <rect className="ag-resolved" x={x(i) + 1} y={y(b.resolved)} width={barW} height={Math.max(0, y(0) - y(b.resolved))} rx={2}>
              <title>{`${bucket === "week" ? "Tuần " : ""}${shortDate(b.start)}: xong ${b.resolved}`}</title>
            </rect>
          </g>
        ))}
        {xLabels(buckets.map((b) => b.start), x, 8)}
      </svg>
      <p className="ag-stats">
        <span>
          Tạo <b>{created}</b>
        </span>
        <span>
          Xong <b>{resolved}</b>
        </span>
        <span className={created > resolved ? "ag-bad" : "ag-good"}>
          {created > resolved ? `Tồn đọng tăng ${created - resolved}` : created < resolved ? `Tồn đọng giảm ${resolved - created}` : "Tồn đọng giữ nguyên"}
        </span>
      </p>
    </div>
  );
}
