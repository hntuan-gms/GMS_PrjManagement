import { useState, type ReactNode } from "react";
import { initialsOf as initials } from "../avatar";
import type { ActionPriority, Health, InsightKind, ProgressMetrics, ProgressReport } from "../types";
import { Icon } from "./Icons";

/**
 * The AI half of the report page, kept visibly apart from the numbers.
 *
 * The dashboard beside it is computed and always live; this panel is a dated
 * piece of reasoning — why the numbers look the way they do and what to do about
 * it. It gets its own surface (dark header, tinted body, its own scroll) so the
 * two are never mistaken for each other: a forecast from the model must not read
 * like a measured figure.
 *
 * Built to be scanned, not read: every item shows a one-line title with its
 * glanceable facts (severity, priority, owner) and opens for the reasoning.
 * One item open at a time, the top recommendation open by default — that is the
 * single thing a manager most needs to see.
 */

interface Props {
  report: ProgressReport | null;
  /**
   * The live figures to compare the report against. Null while the dashboard is
   * showing a slice of the project or another date: the report was written over
   * the whole project as of its own day, so a comparison would be a false alarm.
   */
  live: ProgressMetrics | null;
  isLatest: boolean;
  warnings: string[];
  canGenerate: boolean;
  generating: boolean;
  error: string | null;
  onGenerate: () => void;
  issueLink: (id: string) => ReactNode;
  onShowKeys: (keys: string[], label: string) => void;
}

const OUTLOOK: Record<"on_time" | "at_risk" | "late", { label: string; icon: string; tone: string }> = {
  on_time: { label: "Kịp tiến độ", icon: "✓", tone: "good" },
  at_risk: { label: "Có nguy cơ trễ", icon: "!", tone: "warn" },
  late: { label: "Nhiều khả năng trễ", icon: "✕", tone: "crit" },
};

const CONFIDENCE: Record<"high" | "medium" | "low", { label: string }> = {
  high: { label: "tin cậy cao" },
  medium: { label: "tin cậy vừa" },
  low: { label: "tin cậy thấp" },
};

const SEVERITY: Record<"high" | "medium" | "low", { label: string; icon: string }> = {
  high: { label: "Cao", icon: "▲" },
  medium: { label: "Vừa", icon: "■" },
  low: { label: "Thấp", icon: "▼" },
};

const PRIORITY: Record<ActionPriority, string> = {
  now: "Làm ngay",
  this_week: "Tuần này",
  later: "Sau",
};

const INSIGHT: Record<InsightKind, string> = {
  bottleneck: "Nút thắt",
  dependency: "Phụ thuộc",
  people: "Nhân sự",
  scope: "Phạm vi",
  data: "Dữ liệu",
  momentum: "Nhịp độ",
};

/** What the measured health says about the end date, to compare with the model's forecast. */
const HEALTH_AS_OUTLOOK: Record<Health, "on_time" | "at_risk" | "late"> = {
  on_track: "on_time",
  at_risk: "at_risk",
  off_track: "late",
};

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}

function fmtDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

function InsightIcon({ kind }: { kind: InsightKind }) {
  // Feather-style strokes; decorative — the kind is also written as a label.
  const paths: Record<InsightKind, ReactNode> = {
    bottleneck: <path d="M3 4h18l-7 8v6l-4 2v-8z" />,
    dependency: (
      <>
        <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
        <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
      </>
    ),
    people: (
      <>
        <circle cx="9" cy="8" r="4" />
        <path d="M2 21v-1a6 6 0 0 1 12 0v1M16 4a4 4 0 0 1 0 8M22 21v-1a6 6 0 0 0-4-5.6" />
      </>
    ),
    scope: <path d="M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />,
    data: (
      <>
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5M3 12c0 1.7 4 3 9 3s9-1.3 9-3" />
      </>
    ),
    momentum: <path d="M22 7 13.5 15.5l-5-5L2 17M16 7h6v6" />,
  };
  return (
    <svg className="ai-icon" viewBox="0 0 24 24" aria-hidden="true">
      {paths[kind]}
    </svg>
  );
}

export default function AiBrief({
  report,
  live,
  isLatest,
  warnings,
  canGenerate,
  generating,
  error,
  onGenerate,
  issueLink,
  onShowKeys,
}: Props) {
  const [open, setOpen] = useState<string | null>("rec-0");
  const toggle = (id: string) => setOpen((cur) => (cur === id ? null : id));

  const header = (
    <div className="ai-head">
      <div className="ai-head-title">
        <span className="ai-tag">AI</span>
        <div>
          <b>Nhận định</b>
          <span>{report ? `${isLatest ? "Mới nhất" : "Báo cáo cũ"} · ${fmtDateTime(report.createdAt)}` : "Đang phân tích"}</span>
        </div>
      </div>
      {/* Hidden rather than disabled for guests: the route 403s for them. With no analysis yet the button
          is on the page's header row (ProgressReportView), where there is no frame around it. */}
      {canGenerate && report && (
        <button className="ai-generate" onClick={onGenerate} disabled={generating}>
          {generating ? (
            "Đang phân tích..."
          ) : (
            <>
              <Icon name="sync" size={13} /> Phân tích lại
            </>
          )}
        </button>
      )}
    </div>
  );

  if (generating) {
    return (
      <aside className="pr-ai">
        {header}
        <div className="ai-body">
          <div className="ai-thinking">
            <span className="chat-spinner" />
            AI đang đọc đồ thị việc: chuỗi phụ thuộc, ai đang quá tải, việc nào đang chặn việc khác...
          </div>
          <div className="ai-skeleton" />
          <div className="ai-skeleton ai-skeleton-short" />
          <div className="ai-skeleton" />
          <div className="ai-skeleton ai-skeleton-short" />
        </div>
      </aside>
    );
  }

  // No analysis yet: no frame at all. The offer is the page header's "Phân tích ngay" (plan H9), and the
  // dashboard takes the full width.
  if (!report) return null;

  const n = report.narrative;
  const insights = n.insights ?? [];
  const drifted =
    live !== null &&
    (report.asOf !== live.asOf || Math.abs(report.actualPct - live.actualPct) >= 0.1 || report.health !== live.health);
  const outlook = n.outlook;
  const disagrees = outlook && outlook.verdict !== HEALTH_AS_OUTLOOK[report.health];
  const tokens =
    (report.usage.promptTokens ?? 0) + (report.usage.outputTokens ?? 0) + (report.usage.thoughtTokens ?? 0);

  const keysRow = (keys: string[], label: string) =>
    keys.length > 0 && (
      <div className="ai-keys">
        {keys.slice(0, 6).map((k) => issueLink(k))}
        {keys.length > 1 && (
          <button className="ai-link" onClick={() => onShowKeys(keys, label)}>
            Xem {keys.length} việc →
          </button>
        )}
      </div>
    );

  return (
    <aside className="pr-ai">
      {header}
      <div className="ai-body">
        {error && <div className="ai-error">{error}</div>}
        {drifted && (
          <div className="ai-drift">
            {/* Only name the percentage when it actually moved: "58% → 58%" reads as a mistake. */}
            Viết ngày {fmtDate(report.asOf)}
            {Math.abs(report.actualPct - live!.actualPct) >= 0.1 ? `, khi dự án ở ${report.actualPct}%. Nay ${live!.actualPct}%.` : "."}
            {canGenerate && " Phân tích lại để cập nhật."}
          </div>
        )}

        <h2 className="ai-headline">{n.headline}</h2>

        {outlook && (
          <div className={`ai-outlook ai-tone-${OUTLOOK[outlook.verdict].tone}`}>
            <div className="ai-outlook-top">
              <span className="ai-outlook-icon" aria-hidden="true">
                {OUTLOOK[outlook.verdict].icon}
              </span>
              <b>{OUTLOOK[outlook.verdict].label}</b>
              <span className="ai-confidence">{CONFIDENCE[outlook.confidence].label}</span>
            </div>
            <p>{outlook.reasoning}</p>
            {disagrees && (
              <span className="ai-outlook-note">Khác với tình trạng đo được — AI thấy điều số liệu chưa phản ánh.</span>
            )}
          </div>
        )}

        {n.summary && <p className="ai-summary">{n.summary}</p>}

        {insights.length > 0 && (
          <section className="ai-section">
            <h3>Vấn đề</h3>
            <ul className="ai-list">
              {insights.map((it, i) => {
                const id = `ins-${i}`;
                const isOpen = open === id;
                return (
                  <li key={id} className={`ai-item ${isOpen ? "is-open" : ""}`}>
                    <button className="ai-item-head" onClick={() => toggle(id)} aria-expanded={isOpen}>
                      <span className={`ai-kind ai-kind-${it.kind}`}>
                        <InsightIcon kind={it.kind} />
                        {INSIGHT[it.kind]}
                      </span>
                      <span className="ai-item-title">{it.title}</span>
                      <span className="ai-chevron" aria-hidden="true" />
                    </button>
                    {isOpen && (
                      <div className="ai-item-body">
                        <p>{it.detail}</p>
                        {keysRow(it.issueKeys, it.title)}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {n.recommendations.length > 0 && (
          <section className="ai-section">
            <h3>Đề xuất</h3>
            <ol className="ai-list ai-recs">
              {n.recommendations.map((r, i) => {
                const id = `rec-${i}`;
                const isOpen = open === id;
                return (
                  <li key={id} className={`ai-item ai-rec ${isOpen ? "is-open" : ""}`}>
                    <button className="ai-item-head" onClick={() => toggle(id)} aria-expanded={isOpen}>
                      <span className="ai-step">{i + 1}</span>
                      <span className="ai-item-title">{r.action}</span>
                      {r.priority && <span className={`ai-prio ai-prio-${r.priority}`}>{PRIORITY[r.priority]}</span>}
                      <span className="ai-chevron" aria-hidden="true" />
                    </button>
                    {isOpen && (
                      <div className="ai-item-body">
                        {r.rationale && <p>{r.rationale}</p>}
                        {(r.owner || r.expectedImpact) && (
                          <dl className="ai-facts">
                            {r.owner && (
                              <>
                                <dt>Người phụ trách</dt>
                                <dd>
                                  <span className="pr-avatar" aria-hidden="true">
                                    {initials(r.owner)}
                                  </span>
                                  {r.owner}
                                </dd>
                              </>
                            )}
                            {r.expectedImpact && (
                              <>
                                <dt>Kết quả</dt>
                                <dd>{r.expectedImpact}</dd>
                              </>
                            )}
                          </dl>
                        )}
                        {keysRow(r.issueKeys, r.action)}
                      </div>
                    )}
                    {!isOpen && r.owner && (
                      <span className="ai-owner-inline">
                        <span className="pr-avatar" aria-hidden="true">
                          {initials(r.owner)}
                        </span>
                        {r.owner}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {n.risks.length > 0 && (
          <section className="ai-section">
            <h3>Rủi ro</h3>
            <ul className="ai-list">
              {n.risks.map((r, i) => {
                const id = `risk-${i}`;
                const isOpen = open === id;
                return (
                  <li key={id} className={`ai-item ${isOpen ? "is-open" : ""}`}>
                    <button className="ai-item-head" onClick={() => toggle(id)} aria-expanded={isOpen}>
                      <span className={`ai-sev ai-sev-${r.severity}`}>
                        <span aria-hidden="true">{SEVERITY[r.severity].icon}</span>
                        {SEVERITY[r.severity].label}
                      </span>
                      <span className="ai-item-title">{r.title}</span>
                      <span className="ai-chevron" aria-hidden="true" />
                    </button>
                    {isOpen && (
                      <div className="ai-item-body">
                        <p>{r.detail}</p>
                        {r.mitigation && (
                          <p className="ai-mitigation">
                            <b>Cách giảm:</b> {r.mitigation}
                          </p>
                        )}
                        {keysRow(r.issueKeys, r.title)}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {n.highlights.length > 0 && (
          <section className="ai-section">
            <h3>Điểm tích cực</h3>
            <ul className="ai-highlights">
              {n.highlights.map((h, i) => (
                <li key={i}>
                  <span aria-hidden="true">✓</span>
                  {h}
                </li>
              ))}
            </ul>
          </section>
        )}

        {warnings.length > 0 && (
          <details className="ai-warnings">
            <summary>{warnings.length} điều chỉnh tự động trên nội dung AI</summary>
            <ul>
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </details>
        )}

        <p className="ai-foot">
          Số liệu do hệ thống tính; phần nhận định và dự báo là suy luận của AI ({report.model ?? "không rõ model"})
          {tokens > 0 && ` · ${tokens.toLocaleString("vi-VN")} token`}.
        </p>
      </div>
    </aside>
  );
}
