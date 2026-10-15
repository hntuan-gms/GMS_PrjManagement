import { todayIso } from "./resourceAllocation";
import type { UsageStats } from "./types";
import type { EncodedAttachment } from "./chatAttachments";
import type { ViewFilterSpec } from "./viewFilter";

/**
 * Reads one streamed assistant turn.
 *
 * `fetch` + manual SSE parsing rather than `EventSource`, because EventSource can
 * only issue GETs and the message belongs in a request body. The framing is the
 * same, so the parsing below is the standard "split on a blank line, read the
 * event: and data: fields" loop.
 */
export type ChatStreamEvent =
  | { type: "session"; sessionId: string }
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "tool"; name: string; label: string }
  | { type: "plan"; runId: string; itemCount: number; warnings: string[] }
  /** A tool wrote to Jira this turn — the workspace must reload its tasks. */
  | { type: "mutated" }
  /** A progress report was generated and saved this turn. */
  | { type: "report"; reportId: string; headline: string; health: string }
  /** The assistant filtered what the user sees (set_view_filter); spec null = clear the filters. */
  | { type: "filter"; spec: ViewFilterSpec | null; view: "gantt" | "board" | null; summary: string }
  | { type: "usage"; usage: UsageStats & { model: string } }
  | { type: "done"; messageId: string; usage: UsageStats }
  | { type: "error"; message: string };

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

/**
 * "regenerate" answers the stored last question again; "replace" swaps the last
 * question for `message` and answers that. The server refuses both (409) when the
 * last answer wrote to Jira.
 */
export type RetryMode = "regenerate" | "replace";

export async function* streamChat(
  message: string,
  sessionId: string | null,
  signal: AbortSignal,
  retry?: RetryMode,
  attachments?: EncodedAttachment[]
): AsyncGenerator<ChatStreamEvent> {
  const res = await fetch(`${API_BASE}/ai/chat`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    // The local date travels with the message so "overdue" in the chat matches
    // the report page, which also uses the browser's date (see todayIso).
    // tzOffsetMinutes: sprint dates are Jira datetimes, and which calendar day
    // 17:00Z falls on depends on where the team is (sprint_status tool).
    body: JSON.stringify({
      message,
      sessionId,
      today: todayIso(),
      tzOffsetMinutes: -new Date().getTimezoneOffset(),
      ...(retry === "regenerate" ? { regenerate: true } : {}),
      ...(retry === "replace" ? { replaceLast: true } : {}),
      ...(attachments && attachments.length > 0 ? { attachments: attachments.map(({ name, mimeType, data }) => ({ name, mimeType, data })) } : {}),
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Trợ lý không phản hồi (mã ${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Events are separated by a blank line; a partial event stays in the buffer
    // until the rest of it arrives, which is the whole point of streaming.
    let split: number;
    while ((split = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);

      let event = "message";
      const dataLines: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length === 0) continue;
      try {
        yield { ...JSON.parse(dataLines.join("\n")), type: event } as ChatStreamEvent;
      } catch {
        // A malformed frame is not worth killing the stream over — the rest of
        // the turn is still useful.
      }
    }
  }
}
