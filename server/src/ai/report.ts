import { Type } from "@google/genai";
import { HEALTH_LABEL, type ProgressMetrics } from "../progress.js";
import { activeModel, client } from "./planner.js";
import type { ReportEvidence } from "./reportContext.js";

/**
 * The AI half of a progress report — the reasoning, not the arithmetic.
 *
 * progress.ts has already decided every figure and the page draws them as
 * charts, so a narrative that restates "42.9% done vs 91.4% planned" in prose
 * adds nothing a glance at the gauge didn't. What the model is for is what code
 * can't do from a percentage: read the task graph (reportContext.ts) and infer
 * *why* the numbers look the way they do — which task is the bottleneck, which
 * dependency chain is about to cascade, who is double-booked, what will happen
 * if nobody intervenes — and turn that into specific, owned actions.
 *
 * Two boundaries stay hard:
 * - **No invented figures.** It may quote numbers from the data; it may not
 *   produce new ones (a percentage, a date) — those would carry the authority
 *   of the page with nothing behind them.
 * - **The measured health is a fact.** `outlook` is the model's own forecast and
 *   is allowed to disagree with it (numbers say on track, but the next critical
 *   task has no owner), because that judgement is exactly what we want from it
 *   — but it is labelled as a forecast, carries a confidence, and must explain
 *   itself. It never overwrites `health`.
 *
 * Constrained decoding (`responseSchema`) guarantees the shape; normalize()
 * checks what it can't: every cited issue key exists, every named owner is on
 * the team.
 */

export type RiskSeverity = "high" | "medium" | "low";
export type OutlookVerdict = "on_time" | "at_risk" | "late";
export type Confidence = "high" | "medium" | "low";
export type InsightKind = "bottleneck" | "dependency" | "people" | "scope" | "data" | "momentum";
export type ActionPriority = "now" | "this_week" | "later";

export interface ReportNarrative {
  headline: string;
  summary: string;
  /** The model's forecast for the end date. Absent on reports written before it existed. */
  outlook?: { verdict: OutlookVerdict; confidence: Confidence; reasoning: string };
  /** Root causes and patterns inferred from the task graph. */
  insights?: Array<{ kind: InsightKind; title: string; detail: string; issueKeys: string[] }>;
  highlights: string[];
  risks: Array<{ title: string; detail: string; severity: RiskSeverity; issueKeys: string[]; mitigation?: string }>;
  recommendations: Array<{
    action: string;
    rationale: string;
    issueKeys: string[];
    priority?: ActionPriority;
    /** A team member's display name, validated against the team list. */
    owner?: string | null;
    expectedImpact?: string;
  }>;
}

export interface ReportUsage {
  promptTokens: number | null;
  outputTokens: number | null;
  thoughtTokens: number | null;
  cachedTokens: number | null;
}

export interface GeneratedReport {
  narrative: ReportNarrative;
  model: string;
  usage: ReportUsage;
  /** What normalize() had to correct, for the page to show. */
  warnings: string[];
}

/** The previous report, so the model can reason about direction, not just position. */
export interface PreviousSnapshot {
  createdAt: string;
  asOf: string;
  actualPct: number;
  plannedPct: number;
  health: ProgressMetrics["health"];
  headline: string;
  topRisks: string[];
}

const KEYS = { type: Type.ARRAY, items: { type: Type.STRING }, description: "Mã issue liên quan, chỉ lấy từ dữ liệu." };

const REPORT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    headline: {
      type: Type.STRING,
      description: "Một câu ≤ 20 từ: điều quan trọng nhất người quản lý cần biết hôm nay — một nhận định, không phải một con số.",
    },
    summary: {
      type: Type.STRING,
      description: "2–3 câu ngắn: tình hình thực chất và nguyên nhân chính. Không liệt kê lại số liệu.",
    },
    outlook: {
      type: Type.OBJECT,
      description: "Dự báo của bạn: dự án có kịp ngày kết thúc dự kiến không, suy ra từ đồ thị công việc.",
      properties: {
        verdict: { type: Type.STRING, enum: ["on_time", "at_risk", "late"], format: "enum" },
        confidence: { type: Type.STRING, enum: ["high", "medium", "low"], format: "enum" },
        reasoning: { type: Type.STRING, description: "1–2 câu: dựa vào đâu mà dự báo như vậy." },
      },
      required: ["verdict", "confidence", "reasoning"],
    },
    insights: {
      type: Type.ARRAY,
      description: "2–5 phát hiện suy luận được — nguyên nhân gốc, nút thắt, mẫu hình. Không phải số liệu lặp lại.",
      items: {
        type: Type.OBJECT,
        properties: {
          kind: {
            type: Type.STRING,
            enum: ["bottleneck", "dependency", "people", "scope", "data", "momentum"],
            format: "enum",
          },
          title: { type: Type.STRING, description: "≤ 10 từ." },
          detail: { type: Type.STRING, description: "1–2 câu giải thích suy luận." },
          issueKeys: KEYS,
        },
        required: ["kind", "title", "detail", "issueKeys"],
      },
    },
    highlights: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Điểm tích cực có thật trong dữ liệu, mỗi ý ≤ 15 từ. Có thể rỗng.",
    },
    risks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: "≤ 10 từ." },
          detail: { type: Type.STRING, description: "1–2 câu: chuyện gì sẽ xảy ra và tác động." },
          severity: { type: Type.STRING, enum: ["high", "medium", "low"], format: "enum" },
          mitigation: { type: Type.STRING, description: "Một câu: cách giảm rủi ro này." },
          issueKeys: KEYS,
        },
        required: ["title", "detail", "severity", "mitigation", "issueKeys"],
      },
    },
    recommendations: {
      type: Type.ARRAY,
      description: "3–6 giải pháp cụ thể, làm được ngay.",
      items: {
        type: Type.OBJECT,
        properties: {
          action: { type: Type.STRING, description: "Câu mệnh lệnh ≤ 15 từ." },
          rationale: { type: Type.STRING, description: "Một câu: vì sao việc này giải quyết vấn đề." },
          priority: { type: Type.STRING, enum: ["now", "this_week", "later"], format: "enum" },
          owner: {
            type: Type.STRING,
            description: "Tên một người trong danh sách TEAM nên nhận việc này; chuỗi rỗng nếu không rõ.",
          },
          expectedImpact: { type: Type.STRING, description: "Ngắn gọn: làm xong thì được gì." },
          issueKeys: KEYS,
        },
        required: ["action", "rationale", "priority", "owner", "expectedImpact", "issueKeys"],
      },
    },
  },
  required: ["headline", "summary", "outlook", "insights", "highlights", "risks", "recommendations"],
};

function prompt(
  projectKey: string,
  m: ProgressMetrics,
  evidence: ReportEvidence,
  previous: PreviousSnapshot | null
): string {
  const trend = previous
    ? [
        `Báo cáo trước (${previous.asOf}): hoàn thành ${previous.actualPct}%, kế hoạch ${previous.plannedPct}%, tình trạng ${HEALTH_LABEL[previous.health]}.`,
        `Nhận định khi đó: "${previous.headline}". Rủi ro khi đó: ${previous.topRisks.join("; ") || "không có"}.`,
        `Từ đó tới nay: thực tế ${signed(m.actualPct - previous.actualPct)} điểm %, kế hoạch ${signed(m.plannedPct - previous.plannedPct)} điểm %.`,
        "Hãy nói rõ rủi ro cũ đã được xử lý hay vẫn còn / nặng thêm.",
      ].join("\n")
    : "Đây là báo cáo đầu tiên của dự án — không có kỳ trước để so sánh.";

  // Lists already in `evidence.openWork` are dropped from the metrics copy —
  // the same tasks twice only costs tokens.
  const { overdue: _o, slipped: _s, dueSoon: _d, notStarted: _n, unassigned: _u, ...metricsCore } = m;

  return [
    `Bạn là một PMO lâu năm, đang phân tích dự án Jira "${projectKey}" để tư vấn cho quản lý dự án. Viết tiếng Việt, ngắn, sắc, không sáo rỗng.`,
    "",
    "VAI TRÒ CỦA BẠN:",
    "Trang báo cáo ĐÃ vẽ mọi con số thành biểu đồ (% hoàn thành, kế hoạch, SPI, quá hạn, theo giai đoạn, theo người).",
    "Đừng kể lại các con số đó. Việc của bạn là SUY LUẬN từ đồ thị công việc bên dưới — điều mà biểu đồ không nói được:",
    "- Nguyên nhân gốc: vì sao chậm (một việc tắc kéo theo chuỗi? một người ôm quá nhiều việc cùng lúc? việc bắt đầu muộn? phạm vi phình?).",
    "- Nút thắt: việc nào (openDependants cao, trên đường găng, đang trễ) đang giữ chân nhiều việc khác.",
    "- Nhân sự: ai quá tải (peakConcurrent14d cao, nhiều việc quá hạn), ai còn trống trong TEAM có thể đỡ.",
    "- Điều gì sẽ xảy ra 1–2 tuần tới nếu không ai can thiệp.",
    "- Giải pháp cụ thể: ai làm gì, với việc nào, ưu tiên ra sao — không phải lời khuyên chung chung.",
    "",
    "QUY TẮC:",
    `1. Tình trạng ĐO ĐƯỢC là "${HEALTH_LABEL[m.health]}" (lý do bên dưới) — đây là sự thật, đừng phủ nhận. Nhưng outlook là DỰ BÁO của riêng bạn và ĐƯỢC PHÉP khác nếu đồ thị công việc cho thấy điều số liệu chưa phản ánh (ví dụ: số liệu đúng tiến độ nhưng việc găng sắp tới chưa có người). Khi khác, reasoning phải nói rõ vì sao.`,
    "2. Không tạo con số mới (phần trăm, ngày, số ngày). Chỉ được trích số có sẵn trong dữ liệu, và chỉ khi thật cần.",
    "3. Nhắc tới việc cụ thể thì ghi mã issue (ví dụ GPM-12) và đưa mã đó vào issueKeys. Chỉ dùng mã có trong dữ liệu.",
    "4. owner phải là một tên CHÍNH XÁC trong danh sách TEAM, hoặc chuỗi rỗng.",
    "5. Ưu tiên: now = hôm nay/ngày mai, this_week = trong tuần, later = sau đó.",
    "6. Nếu dữ liệu thiếu (việc chưa có ngày, chưa có baseline, chưa gán người) làm suy luận kém chắc chắn, hạ confidence và nêu một insight loại data.",
    "7. Không bịa điểm tích cực. Mỗi ý tối đa 2 câu. Tổng thể phải đọc được trong 1 phút.",
    "",
    "XU HƯỚNG:",
    trend,
    "",
    "LÝ DO CỦA TÌNH TRẠNG ĐO ĐƯỢC:",
    ...m.healthReasons.map((r) => `- ${r}`),
    "",
    `TEAM: ${evidence.team.join(", ") || "(không có danh sách)"}`,
    "",
    "SỐ LIỆU ĐÃ TÍNH (JSON):",
    JSON.stringify(metricsCore),
    "",
    `CÔNG VIỆC ĐANG MỞ, việc gấp nhất trước (JSON${evidence.openWorkOmitted > 0 ? `; còn ${evidence.openWorkOmitted} việc ít gấp hơn không liệt kê` : ""}):`,
    "blockedBy = việc đi trước chưa xong; openDependants = số việc đang chờ việc này; daysLate = số ngày quá hạn.",
    JSON.stringify(evidence.openWork),
    "",
    "TẢI CỦA TỪNG NGƯỜI trong 14 ngày tới (JSON):",
    JSON.stringify(evidence.people),
  ].join("\n");
}

function signed(n: number): string {
  const v = Math.round(n * 10) / 10;
  return v > 0 ? `+${v}` : `${v}`;
}

export async function generateReport(
  projectKey: string,
  metrics: ProgressMetrics,
  evidence: ReportEvidence,
  knownIssueKeys: Set<string>,
  previous: PreviousSnapshot | null
): Promise<GeneratedReport> {
  const model = activeModel();
  const response = await client().models.generateContent({
    model,
    contents: prompt(projectKey, metrics, evidence, previous),
    config: {
      responseMimeType: "application/json",
      responseSchema: REPORT_SCHEMA,
      // Low but not zero: this is reasoning over given facts. Much higher and
      // "khoảng 60%" starts appearing next to a 54.3.
      temperature: 0.3,
    },
  });

  const text = response.text;
  if (!text) throw new Error("AI không trả về nội dung báo cáo.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("AI trả về nội dung không phải JSON hợp lệ.");
  }

  const warnings: string[] = [];
  const narrative = normalize(parsed, knownIssueKeys, evidence.team, warnings);

  const meta = response.usageMetadata;
  return {
    narrative,
    model,
    usage: {
      promptTokens: meta?.promptTokenCount ?? null,
      outputTokens: meta?.candidatesTokenCount ?? null,
      thoughtTokens: meta?.thoughtsTokenCount ?? null,
      cachedTokens: meta?.cachedContentTokenCount ?? null,
    },
    warnings,
  };
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

const SEVERITIES = ["high", "medium", "low"] as const;
const PRIORITIES = ["now", "this_week", "later"] as const;
const INSIGHT_KINDS = ["bottleneck", "dependency", "people", "scope", "data", "momentum"] as const;

function normalize(raw: unknown, known: Set<string>, team: string[], warnings: string[]): ReportNarrative {
  const r = (raw ?? {}) as Record<string, unknown>;
  const knownUpper = new Map([...known].map((k) => [k.toUpperCase(), k]));
  const teamLower = new Map(team.map((n) => [n.toLowerCase(), n]));

  const keysOf = (v: unknown, where: string): string[] => {
    const out: string[] = [];
    for (const k of list(v)) {
      const hit = knownUpper.get(str(k).toUpperCase());
      if (hit) {
        if (!out.includes(hit)) out.push(hit);
      } else if (str(k)) {
        warnings.push(`${where}: bỏ mã "${str(k)}" vì không có trong dự án.`);
      }
    }
    return out;
  };

  // An owner who isn't on the team would send a PM chasing a name that means
  // nothing here — drop it rather than guess which real person was meant.
  const ownerOf = (v: unknown, where: string): string | null => {
    const name = str(v);
    if (!name) return null;
    const hit = teamLower.get(name.toLowerCase());
    if (!hit) warnings.push(`${where}: bỏ người phụ trách "${name}" vì không có trong nhóm dự án.`);
    return hit ?? null;
  };

  const outlookRaw = (r.outlook ?? {}) as Record<string, unknown>;
  const outlook = str(outlookRaw.reasoning)
    ? {
        verdict: oneOf(outlookRaw.verdict, ["on_time", "at_risk", "late"] as const, "at_risk"),
        confidence: oneOf(outlookRaw.confidence, SEVERITIES, "medium"),
        reasoning: str(outlookRaw.reasoning),
      }
    : undefined;

  const insights = list(r.insights)
    .map((x) => x as Record<string, unknown>)
    .filter((x) => str(x.title))
    .slice(0, 5)
    .map((x) => ({
      kind: oneOf(x.kind, INSIGHT_KINDS, "momentum"),
      title: str(x.title),
      detail: str(x.detail),
      issueKeys: keysOf(x.issueKeys, `Nhận định "${str(x.title)}"`),
    }));

  const risks = list(r.risks)
    .map((x) => x as Record<string, unknown>)
    .filter((x) => str(x.title))
    .slice(0, 6)
    .map((x) => ({
      title: str(x.title),
      detail: str(x.detail),
      severity: oneOf(x.severity, SEVERITIES, "medium"),
      mitigation: str(x.mitigation) || undefined,
      issueKeys: keysOf(x.issueKeys, `Rủi ro "${str(x.title)}"`),
    }))
    .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));

  const recommendations = list(r.recommendations)
    .map((x) => x as Record<string, unknown>)
    .filter((x) => str(x.action))
    .slice(0, 6)
    .map((x) => ({
      action: str(x.action),
      rationale: str(x.rationale),
      priority: oneOf(x.priority, PRIORITIES, "this_week"),
      owner: ownerOf(x.owner, `Giải pháp "${str(x.action)}"`),
      expectedImpact: str(x.expectedImpact) || undefined,
      issueKeys: keysOf(x.issueKeys, `Giải pháp "${str(x.action)}"`),
    }))
    .sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority));

  const headline = str(r.headline);
  if (!headline) throw new Error("AI không tạo được tiêu đề báo cáo. Hãy thử lại.");

  return {
    headline,
    summary: str(r.summary),
    outlook,
    insights,
    highlights: list(r.highlights).map(str).filter(Boolean).slice(0, 4),
    risks,
    recommendations,
  };
}
