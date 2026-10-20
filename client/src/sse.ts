/**
 * Server-sent events read from a fetch() response.
 *
 * `fetch` + manual parsing rather than `EventSource`, because EventSource can
 * only issue GETs and both streams here (the chat turn, the KBKT import) send a
 * body. The framing is the standard "split on a blank line, read the event: and
 * data: fields" loop; each frame comes out as its JSON data plus `type`.
 */
export async function* readSse<T extends { type: string }>(res: Response): AsyncGenerator<T> {
  if (!res.body) return;
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
        yield { ...JSON.parse(dataLines.join("\n")), type: event } as T;
      } catch {
        // A malformed frame is not worth killing the stream over — the rest of
        // it is still useful.
      }
    }
  }
}
