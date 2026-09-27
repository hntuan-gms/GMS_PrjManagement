import { Type } from "@google/genai";
import { HEALTH_LABEL, type ProgressMetrics } from "../progress.js";
import { activeModel, client } from "./planner.js";

/**
 * The narrative half of a progress report.
 *
 * Every number is already decided by progress.ts before this runs — the model
 * receives them as data and is asked to *explain* them: what they mean, what is
 * driving them, what to do next. It is never asked for a percentage, a date or a
 * verdict, because it would produce one whether or not the data supported it.
 * The health verdict in particular comes from progress.judgeHealth and is handed
 * over as a fact the narrative must not contradict.
 *
 * Constrained decoding (`responseSchema`) guarantees the shape; normalize()
 * checks what it can't — chiefly that every issue key the model cites actually
 * exists in this project. A risk pointing at an invented key would send a PM
 * hunting for work that was never there.
 */

export type RiskSeverity = "high" | "medium" | "low";

export interface ReportNarrative {
  headline: string;
  summary: string;
  highlights: string[];
  risks: Array<{ title: string; detail: string; severity: RiskSeverity; issueKeys: string[] }>;
  recommendations: Array<{ action: string; rationale: string; issueKeys: string[] }>;
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

/** The previous report's figures, so the narrative can speak to direction, not just position. */
export interface PreviousSnapshot {
  createdAt: string;
  asOf: string;
  actualPct: number;
  plannedPct: number;
  health: ProgressMetrics["health"];
}

const REPORT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    headline: {
      type: Type.STRING,
      description: "One sentence, the single most important thing a manager should know today.",
    },
    summary: {
      type: Type.STRING,
      description: "3–5 sentences explaining the current state and what is driving it.",
    },
    highlights: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "What is going well, grounded in the data. May be empty.",
    },
    risks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          detail: { type: Type.STRING },
          severity: { type: Type.STRING, enum: ["high", "medium", "low"], format: "enum" },
          issueKeys: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["title", "detail", "severity", "issueKeys"],
      },
    },
    recommendations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          action: { type: Type.STRING, description: "A concrete next step, imperative mood." },
          rationale: { type: Type.STRING },
          issueKeys: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["action", "rationale", "issueKeys"],
      },
    },
  },
  required: ["headline", "summary", "highlights", "risks", "recommendations"],
};

function prompt(projectKey: string, m: ProgressMetrics, previous: PreviousSnapshot | null): string {
  const trend = previous
    ? [
        `Báo cáo trước (${previous.asOf}): hoàn thành ${previous.actualPct}%, kế hoạch ${previous.plannedPct}%, tình trạng ${HEALTH_LABEL[previous.health]}.`,
        `Thay đổi từ đó tới nay: thực tế ${signed(m.actualPct - previous.actualPct)} điểm %, kế hoạch ${signed(m.plannedPct - previous.plannedPct)} điểm %.`,
      ].join("\n")
    : "Đây là báo cáo đầu tiên của dự án — không có số liệu kỳ trước để so sánh.";

  return [
    `Bạn là trưởng PMO viết báo cáo tiến độ cho dự án Jira "${projectKey}" gửi ban giám đốc. Viết tiếng Việt, rõ ràng, không sáo rỗng.`,
    "",
    "QUY TẮC BẮT BUỘC:",
    `1. Tình trạng dự án ĐÃ ĐƯỢC TÍNH là "${HEALTH_LABEL[m.health]}". Không được đánh giá khác đi; hãy giải thích VÌ SAO dựa trên các lý do bên dưới.`,
    "2. Mọi con số bạn viết phải lấy NGUYÊN VĂN từ dữ liệu bên dưới. Không tự tính thêm tỷ lệ, không làm tròn khác, không ước lượng ngày.",
    "3. Khi nói về một công việc cụ thể, ghi mã issue (ví dụ GPM-12) trong văn bản VÀ đưa mã đó vào issueKeys. Chỉ dùng mã có trong dữ liệu.",
    "4. Rủi ro phải cụ thể và có hệ quả: công việc nào, trễ bao nhiêu, ảnh hưởng gì (ưu tiên công việc trên đường găng — chúng đẩy lùi ngày kết thúc).",
    "5. Khuyến nghị là hành động làm được ngay trong tuần (gán người, chia nhỏ việc, dời phạm vi, gỡ vướng), không phải lời khuyên chung chung.",
    "6. Nếu dữ liệu thiếu (ví dụ nhiều việc chưa có ngày, chưa gán người, chưa có baseline) thì nói rõ điều đó làm báo cáo kém chính xác thế nào.",
    "7. Không bịa điểm tích cực. Nếu không có gì nổi bật, để highlights rỗng.",
    "",
    "Cách tính (để bạn hiểu, không cần giải thích lại dài dòng): % hoàn thành là trung bình có trọng số theo thời lượng",
    "của các công việc lá đã lên lịch (Epic và việc có việc con không tính trực tiếp); việc đã Done tính 100%.",
    "% kế hoạch là phần baseline đáng lẽ phải xong tới hôm nay. SPI = thực tế ÷ kế hoạch.",
    "",
    "XU HƯỚNG:",
    trend,
    "",
    "LÝ DO CỦA TÌNH TRẠNG:",
    ...m.healthReasons.map((r) => `- ${r}`),
    "",
    "DỮ LIỆU (JSON):",
    JSON.stringify(m),
  ].join("\n");
}

function signed(n: number): string {
  const v = Math.round(n * 10) / 10;
  return v > 0 ? `+${v}` : `${v}`;
}

export async function generateReport(
  projectKey: string,
  metrics: ProgressMetrics,
  knownIssueKeys: Set<string>,
  previous: PreviousSnapshot | null
): Promise<GeneratedReport> {
  const model = activeModel();
  const response = await client().models.generateContent({
    model,
    contents: prompt(projectKey, metrics, previous),
    config: {
      responseMimeType: "application/json",
      responseSchema: REPORT_SCHEMA,
      // Low: this is summarising given facts, not brainstorming. Higher
      // temperatures are where "roughly 60%" starts appearing next to a 54.3.
      temperature: 0.2,
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
  const narrative = normalize(parsed, knownIssueKeys, warnings);

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

function normalize(raw: unknown, known: Set<string>, warnings: string[]): ReportNarrative {
  const r = (raw ?? {}) as Record<string, unknown>;
  const knownUpper = new Map([...known].map((k) => [k.toUpperCase(), k]));

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

  const severity = (v: unknown): RiskSeverity => (v === "high" || v === "low" ? v : "medium");

  const risks = list(r.risks)
    .map((x) => x as Record<string, unknown>)
    .filter((x) => str(x.title))
    .slice(0, 6)
    .map((x) => ({
      title: str(x.title),
      detail: str(x.detail),
      severity: severity(x.severity),
      issueKeys: keysOf(x.issueKeys, `Rủi ro "${str(x.title)}"`),
    }))
    .sort((a, b) => ["high", "medium", "low"].indexOf(a.severity) - ["high", "medium", "low"].indexOf(b.severity));

  const recommendations = list(r.recommendations)
    .map((x) => x as Record<string, unknown>)
    .filter((x) => str(x.action))
    .slice(0, 6)
    .map((x) => ({
      action: str(x.action),
      rationale: str(x.rationale),
      issueKeys: keysOf(x.issueKeys, `Khuyến nghị "${str(x.action)}"`),
    }));

  const headline = str(r.headline);
  if (!headline) throw new Error("AI không tạo được tiêu đề báo cáo. Hãy thử lại.");

  return {
    headline,
    summary: str(r.summary),
    highlights: list(r.highlights).map(str).filter(Boolean).slice(0, 5),
    risks,
    recommendations,
  };
}
