import { FunctionCallingConfigMode, GoogleGenAI, type Content } from "@google/genai";
import { computeProgress, progressHeadline } from "../progress.js";
import type { JiraUser, Task } from "../types.js";
import { activeModel } from "./planner.js";
import { TOOLS, labelFor, runTool, type ToolContext } from "./tools.js";

/**
 * The project assistant: a streaming chat that can answer questions about the
 * project and, when asked, produce a plan.
 *
 * Why a tool rather than a mode switch: "chia việc giúp tôi" and "dự án đang trễ
 * mấy task?" are the same kind of request from the user's side, and making them
 * pick a mode first pushes the classification onto them. The model decides, and
 * the plan it produces still lands in staging for a human to approve — the tool
 * writes nothing to Jira.
 *
 * Project state is injected into the system prompt rather than fetched through a
 * tool. For a few hundred tasks that costs less than a tool round trip, and it
 * means simple questions answer in one call instead of two.
 */

export interface ChatTurn {
  role: "user" | "model";
  content: string;
}

export interface ChatUsage {
  promptTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  cachedTokens: number;
  model: string;
}

/** What the route streams to the browser as it arrives. */
export type ChatEvent =
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "tool"; name: string; label: string }
  | { type: "plan"; runId: string; itemCount: number; warnings: string[] }
  /** A tool wrote to Jira; the client must reload the project. */
  | { type: "mutated" }
  /** A progress report was generated; the bubble renders a card linking to it. */
  | { type: "report"; reportId: string; headline: string; health: string }
  | { type: "usage"; usage: ChatUsage }
  | { type: "error"; message: string };

/**
 * A compact view of the project for the prompt.
 *
 * Capped, and the cap drops the least useful rows first: a hundred finished
 * tasks tell you far less about where a project stands than the ones still open,
 * so `done` goes last. Without a cap a large project would quietly push the cost
 * of every message up and eventually overflow the window.
 */
function projectSnapshot(tasks: Task[], today: string, limit = 150): string {
  if (tasks.length === 0) return "Dự án chưa có công việc nào.";

  const late = tasks.filter((t) => t.dueDate && t.dueDate < today && t.statusCategory !== "done");
  const done = tasks.filter((t) => t.statusCategory === "done").length;
  const inProgress = tasks.filter((t) => t.statusCategory === "indeterminate").length;

  const ranked = [...tasks].sort((a, b) => {
    const rank = (t: Task) => (t.statusCategory === "done" ? 2 : t.statusCategory === "indeterminate" ? 0 : 1);
    return rank(a) - rank(b) || (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999");
  });

  const lines = ranked.slice(0, limit).map((t) => {
    const who = t.assigneeName ?? "chưa gán";
    const dates = t.startDate ? `${t.startDate}..${t.dueDate ?? "?"}` : "chưa có ngày";
    const overdue = t.dueDate && t.dueDate < today && t.statusCategory !== "done" ? " [TRỄ]" : "";
    return `${t.id} | ${t.summary} | ${t.issueType} | ${t.statusName} | ${t.percentComplete}% | ${who} | ${dates}${overdue}`;
  });

  return [
    `Tổng: ${tasks.length} công việc — ${done} xong, ${inProgress} đang làm, ${late.length} quá hạn. Hôm nay: ${today}.`,
    tasks.length > limit ? `(hiển thị ${limit} công việc đáng chú ý nhất)` : "",
    "",
    "id | tên | loại | trạng thái | % | phụ trách | ngày",
    ...lines,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Issue types actually in use in this project.
 *
 * Read off the snapshot rather than asked of Jira: /project/{key}/issuetypes is
 * another round trip on every single message, and a type nobody has ever used is
 * not one the model should be reaching for anyway. If it picks a wrong one,
 * create_task's 400 comes back as a tool error the model can correct from.
 */
function issueTypesInUse(tasks: Task[]): string {
  const names = [...new Set(tasks.map((t) => t.issueType).filter(Boolean))];
  return names.length > 0 ? names.join(", ") : "Task, Story, Bug, Epic";
}

/**
 * The team, by name and accountId, in every prompt.
 *
 * Without it the model has no way to turn "giao cho Quang" into an accountId
 * except calling suggest_assignees or team_workload first — one extra tool pass
 * for every assignment, which is exactly what used to exhaust the pass budget
 * and end the turn with thoughts and no answer. It is a few hundred tokens.
 */
function teamRoster(team: JiraUser[], limit = 60): string {
  if (team.length === 0) return "(không lấy được danh sách thành viên — dùng suggest_assignees)";
  const lines = team.slice(0, limit).map((u) => `${u.displayName} — ${u.accountId}`);
  return [...lines, team.length > limit ? `(và ${team.length - limit} người nữa)` : ""].filter(Boolean).join("\n");
}

function systemPrompt(projectKey: string, tasks: Task[], today: string, team: JiraUser[]): string {
  return [
    `Bạn là trợ lý quản lý dự án cho project Jira "${projectKey}". Trả lời bằng tiếng Việt, ngắn gọn, đi thẳng vào việc.`,
    "Suy nghĩ (phần reasoning) cũng bằng tiếng Việt.",
    "Mỗi lượt PHẢI kết thúc bằng một câu trả lời bằng chữ cho người dùng — kể cả sau khi đã gọi công cụ: nói đã làm gì, kết quả ra sao.",
    "",
    "Nguyên tắc:",
    "- Chỉ trả lời dựa trên dữ liệu dự án bên dưới hoặc kết quả công cụ. Không có dữ liệu thì nói thẳng là không biết, tuyệt đối không bịa số.",
    "- Khi nói về tiến độ, dẫn ra mã công việc cụ thể (ví dụ AI-12) để người dùng kiểm chứng được.",
    "- Không tự tính hay hứa hẹn ngày tháng ngoài những gì dữ liệu đã có.",
    "",
    "Công cụ:",
    "- Chia một khối công việc lớn thành nhiều task → create_plan. Kết quả là bản nháp chờ người duyệt, KHÔNG tự lên Jira.",
    "  Đừng tự liệt kê kế hoạch dạng văn bản thay cho công cụ này.",
    "- Người dùng yêu cầu thêm ĐÚNG MỘT công việc cụ thể → create_task. Cái này ghi thẳng lên Jira,",
    `  nên chỉ gọi khi người dùng thực sự bảo tạo. Loại issue đang dùng trong dự án: ${issueTypesInUse(tasks)}.`,
    "- Gán/đổi người phụ trách → assign_task. Bỏ gán → unassign_task.",
    "  Người dùng gọi tên (kể cả viết không dấu, ví dụ 'vo dinh quang') → truyền nguyên tên vào tham số assignee;",
    "  hệ thống tự tra ra đúng người, không cần gọi công cụ khác để tìm accountId trước.",
    "- Trước khi gán ai, hãy gọi suggest_assignees để xem ai ít trùng lịch nhất; đừng đoán.",
    "  Hỏi 'ai đang rảnh', 'ai quá tải' → team_workload.",
    "- Mọi câu hỏi về tiến độ, trễ hạn, rủi ro, 'dự án thế nào', giai đoạn nào chậm, ai đang trễ → project_progress.",
    "- Câu hỏi về sprint, board, backlog, vận tốc, 'sprint này có kịp không' → sprint_status.",
    "  Trích NGUYÊN VĂN số liệu nó trả về (%, SPI, số ngày trễ, mã issue); tuyệt đối không tự đếm hay tự ước lượng từ danh sách bên dưới.",
    "  Tình trạng (Đúng tiến độ / Có rủi ro / Chậm tiến độ) đã được tính sẵn kèm lý do — giải thích nó, không tự phán khác.",
    "- Người dùng bảo 'tạo/làm báo cáo tiến độ' → create_progress_report (lưu vào tab Báo cáo). Câu hỏi nhanh thì KHÔNG cần tạo báo cáo.",
    "",
    "Quy tắc gán người:",
    "- TUYỆT ĐỐI không gán người cho Epic. Epic là vùng chứa, trải dài toàn bộ thời gian của các công việc con,",
    "  gán người vào đó sẽ khoá cứng lịch của họ suốt cả giai đoạn. Chỉ gán cho task/story/bug lá.",
    "- Khi người dùng không chỉ đích danh ai, ưu tiên người có ÍT NGÀY TRÙNG LỊCH nhất, rồi mới đến người tải thấp hơn.",
    "  Người tải trung bình thấp vẫn có thể kẹt cứng đúng tuần cần làm — hãy đọc conflictDays, đừng chỉ nhìn loadPercent.",
    "- Nói rõ vì sao chọn người đó (số ngày trùng, giờ còn trống) để người dùng phản biện được.",
    "- Sau khi tạo hoặc gán xong, nhắc lại mã issue vừa tác động.",
    "",
    "Thành viên dự án (tên — accountId):",
    teamRoster(team),
    "",
    "Tiến độ tóm tắt (đã tính sẵn, dùng project_progress để xem chi tiết):",
    progressHeadline(computeProgress(tasks, today)),
    "",
    "Dữ liệu dự án:",
    projectSnapshot(tasks, today),
  ].join("\n");
}

function client(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("Chưa cấu hình GEMINI_API_KEY nên trợ lý AI chưa dùng được.");
  return new GoogleGenAI({ apiKey });
}

/** Everything the tools need that this module has no business knowing about. */
export type ChatDeps = Omit<ToolContext, "tasks" | "today" | "mutated" | "workload" | "team">;

/** Tool rounds per turn before a final, tool-free pass forces an answer. */
const MAX_TOOL_PASSES = 5;

/**
 * Streams one assistant turn, yielding events as they arrive.
 *
 * Thinking is streamed separately from the answer so the UI can show progress
 * immediately: the first visible token of a real answer can be many seconds
 * away when the model is reasoning or calling a tool, and a blank panel for that
 * long reads as broken.
 */
export async function* streamChat(
  projectKey: string,
  tasks: Task[],
  history: ChatTurn[],
  userMessage: string,
  today: string,
  deps: ChatDeps
): AsyncGenerator<ChatEvent> {
  const model = activeModel();
  const ai = client();

  // Cached per project for five minutes (projectMembers.ts), so this is usually
  // free. A failure costs the roster, not the turn.
  const team = await deps.taskService.listUsers().catch(() => [] as JiraUser[]);

  // One context for the whole turn: tools append the tasks they create and share
  // a single workload build, so two calls in one turn see each other's effects.
  const toolCtx: ToolContext = { ...deps, tasks: [...tasks], today, mutated: false, team };

  const contents: Content[] = [
    ...history.map((turn) => ({ role: turn.role, parts: [{ text: turn.content }] })),
    { role: "user", parts: [{ text: userMessage }] },
  ];

  const config = {
    systemInstruction: systemPrompt(projectKey, tasks, today, team),
    tools: [{ functionDeclarations: TOOLS }],
    thinkingConfig: { includeThoughts: true },
    temperature: 0.3,
  };

  const usage: ChatUsage = {
    promptTokens: 0,
    outputTokens: 0,
    thoughtTokens: 0,
    cachedTokens: 0,
    model,
  };

  // Bounded, but not at two. Two passes was "answer, or one tool then answer" —
  // and a normal request needs more: "đổi GPM-104 cho Quang" was look up the
  // person, assign, then reply. The second pass's call was never executed and
  // the turn ended on thoughts with no answer, which is what users saw as the
  // assistant "thinking out loud" forever. Now every call the model makes is
  // executed, and once the budget is spent one last pass runs with tools OFF,
  // so a turn always ends in words. The bound still stops a model that keeps
  // re-calling tools from billing forever.
  let answered = false;
  for (let pass = 0; pass <= MAX_TOOL_PASSES; pass++) {
    const finalPass = pass === MAX_TOOL_PASSES;
    const stream = await ai.models.generateContentStream({
      model,
      contents,
      config: finalPass
        ? { ...config, toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } } }
        : config,
    });

    let answer = "";
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const modelParts: Array<Record<string, unknown>> = [];

    for await (const chunk of stream) {
      // Usage is reported cumulatively per chunk, so the last one wins rather
      // than summing — summing would multiply the real cost by the chunk count.
      const meta = chunk.usageMetadata;
      if (meta) {
        usage.promptTokens = meta.promptTokenCount ?? usage.promptTokens;
        usage.outputTokens = meta.candidatesTokenCount ?? usage.outputTokens;
        usage.thoughtTokens = meta.thoughtsTokenCount ?? usage.thoughtTokens;
        usage.cachedTokens = meta.cachedContentTokenCount ?? usage.cachedTokens;
      }

      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        if (part.thought && part.text) {
          yield { type: "thinking", text: part.text };
          continue;
        }
        if (part.text) {
          answer += part.text;
          yield { type: "text", text: part.text };
        }
        if (part.functionCall?.name) {
          calls.push({ name: part.functionCall.name, args: (part.functionCall.args ?? {}) as Record<string, unknown> });
        }
        modelParts.push(part as Record<string, unknown>);
      }
    }

    if (answer.trim()) answered = true;
    if (calls.length === 0 || finalPass) {
      // A pass with neither text nor a call (thoughts only) gets one forced,
      // tool-free retry rather than ending the turn silently.
      // Same contents, tools off: the model can only answer in words.
      if (!answered && !finalPass) {
        pass = MAX_TOOL_PASSES - 1;
        continue;
      }
      break;
    }

    // Feed the tool result back in the shape Gemini expects, keeping the
    // model's own parts so the call and its response stay paired.
    contents.push({ role: "model", parts: modelParts as never });
    const responseParts: Array<Record<string, unknown>> = [];

    for (const call of calls) {
      yield { type: "tool", name: call.name, label: labelFor(call.name) };
      try {
        const outcome = await runTool(call.name, call.args, toolCtx);
        if (outcome.plan) {
          yield {
            type: "plan",
            runId: outcome.plan.runId,
            itemCount: outcome.plan.itemCount,
            warnings: outcome.plan.warnings,
          };
        }
        if (outcome.report) {
          yield {
            type: "report",
            reportId: outcome.report.id,
            headline: outcome.report.headline,
            health: outcome.report.health,
          };
        }
        responseParts.push({
          functionResponse: { name: call.name, response: outcome.response },
        });
      } catch (err) {
        // The model gets the failure too, not just the user: told that
        // assign_task failed, it can explain or try someone else, whereas a
        // silently dropped tool result makes it narrate a success that never
        // happened.
        const message = (err as Error).message;
        yield { type: "error", message };
        responseParts.push({ functionResponse: { name: call.name, response: { error: message } } });
      }
    }
    contents.push({ role: "user", parts: responseParts as never });
  }

  if (!answered) {
    // Should not happen after the forced pass, but an empty bubble is the one
    // outcome the user can't interpret — say so plainly instead.
    yield { type: "text", text: "Mình chưa trả lời được yêu cầu này. Bạn thử nói lại cụ thể hơn nhé." };
  }
  if (toolCtx.mutated) yield { type: "mutated" };
  yield { type: "usage", usage };
}
