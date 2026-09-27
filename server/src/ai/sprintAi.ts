import { Type } from "@google/genai";
import type { BoardIssue, BoardSnapshot, Sprint } from "../agile/boardTypes.js";
import type { Availability, SprintFacts, VelocityStats } from "../agile/sprintMetrics.js";
import { weightOf } from "../agile/sprintMetrics.js";
import { activeModel, client } from "./planner.js";

/**
 * The three things the Bảng tab asks of a model, each where Jira offers nothing:
 *
 * - **planSprint** — which backlog items make a coherent, achievable next sprint,
 *   and what its goal is. Jira leaves this to a meeting; the reasoning (what
 *   belongs together, what is blocked by what, who is away) is exactly what a
 *   model is good at, and the arithmetic (how much fits) is exactly what it isn't.
 *   So code computes the budget from real velocity and availability, the model
 *   picks, and code re-totals the pick and flags anything over budget or
 *   depending on work that isn't scheduled. Nothing moves until a person applies it.
 * - **estimateIssues** — story points for unestimated items, by analogy to this
 *   team's own finished work (reference-class estimation), snapped to the scale
 *   the board uses, each with the finished items it was compared to.
 * - **sprintInsight** — the stand-up question "are we going to make it, and what
 *   do we do today?", over computed pace, blockers, stale work and load.
 *
 * Same contract as the report narrative: constrained decoding for shape,
 * normalize() for meaning — every issue key the model returns must be one it was
 * shown, every number that matters is recomputed here.
 */

export interface AiUsage {
  promptTokens: number | null;
  outputTokens: number | null;
  thoughtTokens: number | null;
}

async function callJson(prompt: string, schema: object, temperature: number): Promise<{ data: any; usage: AiUsage; model: string }> {
  const model = activeModel();
  const response = await client().models.generateContent({
    model,
    contents: prompt,
    config: { responseMimeType: "application/json", responseSchema: schema, temperature },
  });
  const text = response.text;
  if (!text) throw new Error("AI không trả về nội dung.");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("AI trả về nội dung không phải JSON hợp lệ.");
  }
  const meta = response.usageMetadata;
  return {
    data,
    model,
    usage: {
      promptTokens: meta?.promptTokenCount ?? null,
      outputTokens: meta?.candidatesTokenCount ?? null,
      thoughtTokens: meta?.thoughtsTokenCount ?? null,
    },
  };
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

/** A compact line per issue — what a planner needs to see, nothing it would have to skip. */
function issueBrief(i: BoardIssue, byKey: Map<string, BoardIssue>) {
  return {
    key: i.key,
    summary: i.summary.length > 110 ? `${i.summary.slice(0, 109)}…` : i.summary,
    type: i.issueType,
    status: i.statusName,
    priority: i.priority,
    estimate: i.estimate,
    assignee: i.assigneeName,
    epic: i.epicSummary ? `${i.epicKey} ${i.epicSummary}` : null,
    labels: i.labels.length > 0 ? i.labels : undefined,
    due: i.dueDate,
    flagged: i.flagged || undefined,
    // Predecessors with their state, so "blocked by something already in the
    // active sprint" reads differently from "blocked by something nobody planned".
    blockedBy:
      i.blockedBy.length > 0
        ? i.blockedBy.map((k) => {
            const p = byKey.get(k);
            return `${k} (${p ? `${p.statusName}${p.sprintId ? `, sprint ${p.sprintId}` : ", backlog"}` : "?"})`;
          })
        : undefined,
  };
}

/* ======================================================================== */
/* Sprint planning                                                          */
/* ======================================================================== */

export interface SprintPlanProposal {
  goal: string;
  rationale: string;
  picks: Array<{ key: string; reason: string }>;
  deferred: Array<{ key: string; reason: string }>;
  risks: string[];
  totals: {
    /** Weight of everything the sprint would hold after applying (existing + picks). */
    weight: number;
    count: number;
    /** What history says fits, or null with no closed sprints. */
    budget: number | null;
    unit: string;
    unestimated: number;
  };
  /** Computed checks the reviewer should see before applying. */
  warnings: string[];
  model: string;
  usage: AiUsage;
}

const PLAN_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    goal: { type: Type.STRING, description: "Mục tiêu sprint: một câu ≤ 15 từ nói giá trị giao được, không liệt kê task." },
    rationale: { type: Type.STRING, description: "1–2 câu: vì sao chọn nhóm việc này." },
    picks: {
      type: Type.ARRAY,
      description: "Các việc nên đưa vào sprint, theo thứ tự ưu tiên.",
      items: {
        type: Type.OBJECT,
        properties: {
          key: { type: Type.STRING },
          reason: { type: Type.STRING, description: "≤ 12 từ." },
        },
        required: ["key", "reason"],
      },
    },
    deferred: {
      type: Type.ARRAY,
      description: "Việc thứ hạng cao nhưng KHÔNG nên đưa vào lúc này, và vì sao (bị chặn, chưa rõ, quá lớn...).",
      items: {
        type: Type.OBJECT,
        properties: { key: { type: Type.STRING }, reason: { type: Type.STRING, description: "≤ 12 từ." } },
        required: ["key", "reason"],
      },
    },
    risks: { type: Type.ARRAY, items: { type: Type.STRING }, description: "0–3 rủi ro của kế hoạch này, mỗi ý ≤ 20 từ." },
  },
  required: ["goal", "rationale", "picks", "deferred", "risks"],
};

export async function planSprint(input: {
  snapshot: BoardSnapshot;
  target: Sprint;
  window: { start: string; end: string; lengthDays: number };
  velocity: VelocityStats;
  team: Availability[];
  projectKey: string;
}): Promise<SprintPlanProposal> {
  const { snapshot, target, velocity } = input;
  const estimated = !!snapshot.estimation;
  const byKey = new Map(snapshot.issues.map((i) => [i.key, i]));
  const plannable = (i: BoardIssue) => !i.subtask && i.statusCategory !== "done" && i.issueType.toLowerCase() !== "epic";

  const existing = snapshot.issues.filter((i) => i.sprintId === target.id && plannable(i));
  // Backlog in rank order — the product owner's priority, which the model is
  // told to respect unless it has a reason not to.
  const backlog = snapshot.issues.filter((i) => i.sprintId === null && plannable(i)).slice(0, 120);
  if (backlog.length === 0 && existing.length === 0) {
    throw new Error("Backlog đang trống — không có việc nào để lập kế hoạch sprint.");
  }

  const active = snapshot.sprints.find((s) => s.state === "active");
  const carryOver = active
    ? snapshot.issues.filter((i) => i.sprintId === active.id && i.statusCategory !== "done" && !i.subtask)
    : [];
  const workDays = input.team.reduce((s, m) => s + m.days, 0);
  const existingWeight = existing.reduce((s, i) => s + weightOf(i, estimated), 0);

  const prompt = [
    `Bạn là Scrum Master giàu kinh nghiệm, lập kế hoạch cho sprint "${target.name}" của dự án ${input.projectKey}. Viết tiếng Việt.`,
    "",
    "NHIỆM VỤ: chọn từ BACKLOG những việc tạo thành một sprint mạch lạc, làm được, có một mục tiêu rõ ràng.",
    "",
    "NGUYÊN TẮC:",
    "1. Tôn trọng thứ hạng backlog (thứ tự bên dưới là ưu tiên của Product Owner). Chỉ bỏ qua một việc xếp cao khi có lý do rõ — và đưa nó vào deferred kèm lý do.",
    `2. Ngân sách: ${velocity.average !== null ? `vận tốc trung bình ${velocity.average} ${velocity.unit}/sprint (3 sprint gần nhất). Tổng (việc đã có trong sprint + việc chọn) không nên vượt quá con số này.` : `chưa có lịch sử sprint. Dựa vào năng lực nhóm: ${workDays} ngày-người trong sprint.`}`,
    "3. Đừng chọn việc bị chặn bởi việc khác chưa xong, trừ khi việc chặn nó cũng được chọn (và xếp trước) hoặc đang trong sprint hiện tại sắp xong.",
    "4. Ưu tiên gom việc cùng Epic/cùng mục tiêu để sprint giao được một thứ trọn vẹn thay vì nhiều mảnh rời.",
    "5. Cân nhắc người vắng mặt: nếu một người có ít ngày làm việc, đừng dồn nhiều việc đã gán cho họ.",
    "6. Việc chưa ước lượng là rủi ro: có thể chọn nếu quan trọng, nhưng nêu trong risks.",
    "7. Chỉ dùng mã issue có trong dữ liệu. Không tự tính tổng điểm — hệ thống sẽ tính lại.",
    "",
    `CỬA SỔ SPRINT: ${input.window.start} → ${input.window.end} (${input.window.lengthDays} ngày lịch).`,
    `VẬN TỐC các sprint trước (${velocity.unit}, cũ → mới): ${JSON.stringify(snapshot.velocity.map((v) => ({ name: v.name, completed: estimated ? v.completed : v.completedCount })))}`,
    `NĂNG LỰC NHÓM (ngày làm việc thực tế trong cửa sổ, đã trừ nghỉ): ${JSON.stringify(input.team.map((m) => ({ name: m.name, days: m.days })))}`,
    active
      ? `SPRINT ĐANG CHẠY "${active.name}" còn ${carryOver.length} việc chưa xong (có thể tràn sang): ${JSON.stringify(carryOver.slice(0, 20).map((i) => i.key))}`
      : "Không có sprint đang chạy.",
    `ĐÃ CÓ TRONG SPRINT MỤC TIÊU (${existing.length} việc, tổng ${Math.round(existingWeight * 10) / 10} ${velocity.unit}): ${JSON.stringify(existing.map((i) => issueBrief(i, byKey)))}`,
    target.goal ? `Mục tiêu hiện tại của sprint: "${target.goal}" — giữ tinh thần này nếu hợp lý.` : "",
    "",
    "BACKLOG theo thứ hạng (JSON):",
    JSON.stringify(backlog.map((i) => issueBrief(i, byKey))),
  ].join("\n");

  const { data, usage, model } = await callJson(prompt, PLAN_SCHEMA, 0.3);
  const r = (data ?? {}) as Record<string, unknown>;

  const candidateKeys = new Map(backlog.map((i) => [i.key.toUpperCase(), i]));
  const seen = new Set<string>();
  const picks = list(r.picks)
    .map((x) => x as Record<string, unknown>)
    .map((x) => ({ issue: candidateKeys.get(str(x.key).toUpperCase()), reason: str(x.reason) }))
    .filter((x): x is { issue: BoardIssue; reason: string } => !!x.issue && !seen.has(x.issue.key) && !!seen.add(x.issue.key))
    // Applied in rank order whatever order the model listed them in: moving
    // issues into a sprint keeps their global rank, so the list should too.
    .sort((a, b) => backlog.indexOf(a.issue) - backlog.indexOf(b.issue));

  const deferred = list(r.deferred)
    .map((x) => x as Record<string, unknown>)
    .map((x) => ({ issue: candidateKeys.get(str(x.key).toUpperCase()), reason: str(x.reason) }))
    .filter((x): x is { issue: BoardIssue; reason: string } => !!x.issue && !seen.has(x.issue.key))
    .slice(0, 8);

  // Recomputed, not taken from the model.
  const chosen = [...existing, ...picks.map((p) => p.issue)];
  const weight = Math.round(chosen.reduce((s, i) => s + weightOf(i, estimated), 0) * 10) / 10;
  const unestimated = estimated ? chosen.filter((i) => i.estimate === null).length : 0;
  const warnings: string[] = [];
  if (velocity.average !== null && weight > velocity.average * 1.1) {
    warnings.push(`Tổng ${weight} ${velocity.unit} vượt vận tốc trung bình ${velocity.average} ${velocity.unit} — nhiều khả năng không xong hết.`);
  }
  if (unestimated > 0) warnings.push(`${unestimated} việc chưa ước lượng nên tổng thực tế có thể lớn hơn.`);
  const chosenKeys = new Set(chosen.map((i) => i.key));
  const activeKeys = new Set(carryOver.map((i) => i.key));
  for (const i of chosen) {
    const unplanned = i.blockedBy.filter((k) => !chosenKeys.has(k) && !activeKeys.has(k));
    if (unplanned.length > 0) warnings.push(`${i.key} phụ thuộc ${unplanned.join(", ")} nhưng việc đó không nằm trong sprint nào.`);
  }
  const away = input.team.filter((m) => m.days === 0).map((m) => m.name);
  if (away.length > 0) warnings.push(`Vắng cả sprint: ${away.join(", ")}.`);

  const goal = str(r.goal);
  if (!goal && picks.length === 0) throw new Error("AI không đề xuất được kế hoạch sprint. Hãy thử lại.");

  return {
    goal,
    rationale: str(r.rationale),
    picks: picks.map((p) => ({ key: p.issue.key, reason: p.reason })),
    deferred: deferred.map((d) => ({ key: d.issue.key, reason: d.reason })),
    risks: list(r.risks).map(str).filter(Boolean).slice(0, 3),
    totals: { weight, count: chosen.length, budget: velocity.average, unit: velocity.unit, unestimated },
    warnings,
    model,
    usage,
  };
}

/* ======================================================================== */
/* Estimation                                                               */
/* ======================================================================== */

export interface EstimateSuggestion {
  key: string;
  value: number;
  confidence: "high" | "medium" | "low";
  reason: string;
  similar: string[];
}

const FIBONACCI = [0.5, 1, 2, 3, 5, 8, 13, 21];

const ESTIMATE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          key: { type: Type.STRING },
          value: { type: Type.NUMBER },
          confidence: { type: Type.STRING, enum: ["high", "medium", "low"], format: "enum" },
          reason: { type: Type.STRING, description: "≤ 15 từ: so với việc nào, lớn/nhỏ hơn vì sao." },
          similar: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Mã các việc tham chiếu đã xong." },
        },
        required: ["key", "value", "confidence", "reason", "similar"],
      },
    },
  },
  required: ["items"],
};

export async function estimateIssues(input: {
  targets: BoardIssue[];
  /** Finished, estimated work from this board — the reference class. */
  references: Array<{ key: string; summary: string; type: string; estimate: number }>;
  unit: "points" | "hours";
}): Promise<{ items: EstimateSuggestion[]; model: string; usage: AiUsage }> {
  if (input.targets.length === 0) return { items: [], model: activeModel(), usage: { promptTokens: 0, outputTokens: 0, thoughtTokens: 0 } };
  const points = input.unit === "points";

  const prompt = [
    "Bạn là thành viên kỳ cựu của nhóm, ước lượng công việc bằng so sánh tương đối với việc nhóm ĐÃ LÀM (reference-class estimation). Viết tiếng Việt.",
    "",
    points
      ? `Thang điểm: ${FIBONACCI.join(", ")} story point. Điểm đo độ lớn tương đối (công sức + độ phức tạp + rủi ro), không phải giờ.`
      : "Đơn vị: giờ công.",
    "Với mỗi việc cần ước lượng: tìm 1–3 việc tham chiếu giống nhất, rồi quyết định lớn hơn/nhỏ hơn/bằng.",
    "confidence = low khi mô tả quá mơ hồ hoặc không có việc tham chiếu nào giống; khi đó nói rõ cần làm rõ gì.",
    "Việc có vẻ quá lớn (≥ 13 điểm) nên gợi ý chia nhỏ trong reason.",
    "Chỉ dùng mã có trong dữ liệu.",
    "",
    input.references.length > 0
      ? `VIỆC THAM CHIẾU ĐÃ XONG của nhóm (JSON): ${JSON.stringify(input.references)}`
      : "Nhóm chưa có việc đã ước lượng nào để tham chiếu — ước lượng theo kinh nghiệm chung và để confidence thấp.",
    "",
    `VIỆC CẦN ƯỚC LƯỢNG (JSON): ${JSON.stringify(input.targets.map((i) => ({ key: i.key, summary: i.summary, type: i.issueType, epic: i.epicSummary, labels: i.labels })))}`,
  ].join("\n");

  const { data, usage, model } = await callJson(prompt, ESTIMATE_SCHEMA, 0.2);
  const targetKeys = new Map(input.targets.map((i) => [i.key.toUpperCase(), i.key]));
  const refKeys = new Map(input.references.map((r) => [r.key.toUpperCase(), r.key]));
  const snap = (v: number) =>
    points
      ? FIBONACCI.reduce((best, s) => (Math.abs(s - v) < Math.abs(best - v) ? s : best), FIBONACCI[0])
      : Math.min(200, Math.max(0.5, Math.round(v * 2) / 2));

  const out: EstimateSuggestion[] = [];
  for (const x of list((data as any)?.items)) {
    const row = x as Record<string, unknown>;
    const key = targetKeys.get(str(row.key).toUpperCase());
    const value = Number(row.value);
    if (!key || !Number.isFinite(value) || value <= 0 || out.some((o) => o.key === key)) continue;
    out.push({
      key,
      value: snap(value),
      confidence: oneOf(row.confidence, ["high", "medium", "low"] as const, "medium"),
      reason: str(row.reason),
      similar: list(row.similar)
        .map((k) => refKeys.get(str(k).toUpperCase()))
        .filter((k): k is string => !!k)
        .slice(0, 3),
    });
  }
  return { items: out, model, usage };
}

/* ======================================================================== */
/* Active sprint insight                                                    */
/* ======================================================================== */

export interface SprintInsight {
  headline: string;
  forecast: { verdict: "will_meet" | "at_risk" | "will_miss"; confidence: "high" | "medium" | "low"; reasoning: string };
  /** What to do today — the stand-up agenda. */
  actions: Array<{ title: string; detail: string; owner: string | null; issueKeys: string[] }>;
  /** Items to take out if the sprint can't hold everything, least valuable first. */
  descope: Array<{ key: string; reason: string }>;
  facts: SprintFacts;
  model: string;
  usage: AiUsage;
}

const INSIGHT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    headline: { type: Type.STRING, description: "Một câu ≤ 18 từ: tình hình sprint thực chất." },
    forecast: {
      type: Type.OBJECT,
      properties: {
        verdict: { type: Type.STRING, enum: ["will_meet", "at_risk", "will_miss"], format: "enum" },
        confidence: { type: Type.STRING, enum: ["high", "medium", "low"], format: "enum" },
        reasoning: { type: Type.STRING, description: "1–2 câu." },
      },
      required: ["verdict", "confidence", "reasoning"],
    },
    actions: {
      type: Type.ARRAY,
      description: "2–4 việc cần làm ngay hôm nay (nội dung cho buổi stand-up).",
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: "Câu mệnh lệnh ≤ 12 từ." },
          detail: { type: Type.STRING, description: "Một câu." },
          owner: { type: Type.STRING, description: "Tên người trong nhóm, hoặc chuỗi rỗng." },
          issueKeys: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["title", "detail", "owner", "issueKeys"],
      },
    },
    descope: {
      type: Type.ARRAY,
      description: "Chỉ khi sprint có nguy cơ trễ: việc nên đưa ra khỏi sprint, ít giá trị nhất trước. Rỗng nếu không cần.",
      items: {
        type: Type.OBJECT,
        properties: { key: { type: Type.STRING }, reason: { type: Type.STRING, description: "≤ 12 từ." } },
        required: ["key", "reason"],
      },
    },
  },
  required: ["headline", "forecast", "actions", "descope"],
};

const PACE_LABEL: Record<SprintFacts["pace"], string> = {
  ahead: "nhanh hơn kế hoạch",
  on_pace: "đúng nhịp",
  behind: "chậm hơn kế hoạch",
  not_started: "mới bắt đầu",
};

export async function sprintInsight(input: {
  snapshot: BoardSnapshot;
  facts: SprintFacts;
  projectKey: string;
}): Promise<SprintInsight> {
  const { snapshot, facts } = input;
  const byKey = new Map(snapshot.issues.map((i) => [i.key, i]));
  const open = snapshot.issues.filter((i) => i.sprintId === facts.sprint.id && i.statusCategory !== "done" && !i.subtask);
  const team = [...new Set(snapshot.issues.map((i) => i.assigneeName).filter((n): n is string => !!n))];

  const prompt = [
    `Bạn là Scrum Master của dự án ${input.projectKey}, chuẩn bị buổi stand-up cho sprint "${facts.sprint.name}". Viết tiếng Việt, ngắn, cụ thể.`,
    facts.sprint.goal ? `Mục tiêu sprint: "${facts.sprint.goal}".` : "Sprint chưa có mục tiêu.",
    "",
    "SỐ LIỆU ĐÃ TÍNH (sự thật, đừng tính lại, đừng tạo số mới):",
    `- Đã qua ${facts.days.elapsed}/${facts.days.total} ngày làm việc (${facts.elapsedPct}%), còn ${facts.days.left} ngày.`,
    `- Xong ${facts.done.weight}/${facts.scope.weight} ${facts.unit} (${facts.donePct}%) — nhịp độ: ${PACE_LABEL[facts.pace]}.`,
    `- Đang làm ${facts.inProgress.count} việc, chưa làm ${facts.todo.count} việc, ${facts.scope.unestimated} việc chưa ước lượng.`,
    `- Tải từng người (việc mở / ${facts.unit} còn lại): ${JSON.stringify(facts.people)}`,
    `- Bị chặn bởi việc chưa xong: ${JSON.stringify(facts.blocked)}`,
    `- Được gắn cờ (flag): ${JSON.stringify(facts.flagged)}`,
    `- Đang làm nhưng không cập nhật ≥ 3 ngày làm việc: ${JSON.stringify(facts.stale)}`,
    `- Chưa gán người: ${JSON.stringify(facts.unassigned)}`,
    "",
    "YÊU CẦU:",
    "1. forecast: sprint có đạt mục tiêu không, suy từ nhịp độ + việc bị chặn/đứng yên + tải từng người. Có thể khác 'nhịp độ' nếu có lý do (ví dụ đúng nhịp nhưng việc lớn nhất đang bị chặn).",
    "2. actions: việc cụ thể cho hôm nay — gỡ chặn, chia lại việc cho người đang rảnh, hỏi việc đứng yên, chốt phạm vi. owner phải là tên trong TEAM hoặc rỗng.",
    "3. descope chỉ khi at_risk/will_miss: chọn việc ít liên quan tới mục tiêu sprint, ưu tiên thấp, chưa bắt đầu.",
    "4. Chỉ dùng mã issue có trong dữ liệu.",
    "",
    `TEAM: ${team.join(", ") || "(không rõ)"}`,
    `VIỆC CÒN MỞ TRONG SPRINT (JSON): ${JSON.stringify(open.slice(0, 60).map((i) => issueBrief(i, byKey)))}`,
  ].join("\n");

  const { data, usage, model } = await callJson(prompt, INSIGHT_SCHEMA, 0.3);
  const r = (data ?? {}) as Record<string, unknown>;
  const sprintKeys = new Map(snapshot.issues.filter((i) => i.sprintId === facts.sprint.id).map((i) => [i.key.toUpperCase(), i.key]));
  const openKeys = new Map(open.map((i) => [i.key.toUpperCase(), i.key]));
  const teamLower = new Map(team.map((n) => [n.toLowerCase(), n]));
  const keysOf = (v: unknown) =>
    [...new Set(list(v).map((k) => sprintKeys.get(str(k).toUpperCase())).filter((k): k is string => !!k))];
  const fc = (r.forecast ?? {}) as Record<string, unknown>;

  const headline = str(r.headline);
  if (!headline) throw new Error("AI không phân tích được sprint. Hãy thử lại.");

  return {
    headline,
    forecast: {
      verdict: oneOf(fc.verdict, ["will_meet", "at_risk", "will_miss"] as const, "at_risk"),
      confidence: oneOf(fc.confidence, ["high", "medium", "low"] as const, "medium"),
      reasoning: str(fc.reasoning),
    },
    actions: list(r.actions)
      .map((x) => x as Record<string, unknown>)
      .filter((x) => str(x.title))
      .slice(0, 4)
      .map((x) => ({
        title: str(x.title),
        detail: str(x.detail),
        owner: teamLower.get(str(x.owner).toLowerCase()) ?? null,
        issueKeys: keysOf(x.issueKeys),
      })),
    descope: list(r.descope)
      .map((x) => x as Record<string, unknown>)
      .map((x) => ({ key: openKeys.get(str(x.key).toUpperCase()), reason: str(x.reason) }))
      .filter((x): x is { key: string; reason: string } => !!x.key)
      .slice(0, 5),
    facts,
    model,
    usage,
  };
}
