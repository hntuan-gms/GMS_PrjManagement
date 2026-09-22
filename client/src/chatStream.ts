import type { UsageStats } from "./types";

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
  | { type: "usage"; usage: UsageStats & { model: string } }
  | { type: "done"; messageId: string; usage: UsageStats }
  | { type: "error"; message: string };

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

export async function* streamChat(
  message: string,
  sessionId: string | null,
  signal: AbortSignal
): AsyncGenerator<ChatStreamEvent> {
  const res = await fetch(`${API_BASE}/ai/chat`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, sessionId }),
    signal,
  });

  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Chat failed: ${res.status}`);
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
