import { db } from "../db/pool.js";
import type { ChatTurn, ChatUsage } from "./chat.js";

export interface ChatMessage {
  id: string;
  role: "user" | "model";
  content: string;
  thinking: string | null;
  planRunId: string | null;
  model: string | null;
  usage: { promptTokens: number; outputTokens: number; thoughtTokens: number; cachedTokens: number };
  createdAt: string;
}

/**
 * Per-session and per-project totals, kept apart because they answer different
 * questions: "what did this conversation cost" versus "what has this project
 * spent". Counters stay separate rather than being summed into one number —
 * thinking tokens and cached input are billed at different rates, so a single
 * total cannot be turned back into money.
 */
export interface UsageStats {
  messages: number;
  promptTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  cachedTokens: number;
  totalTokens: number;
}

export async function ensureSession(
  cloudId: string,
  projectKey: string,
  createdBy: string,
  sessionId: string | null
): Promise<string> {
  if (sessionId) {
    const { rows } = await db().query<{ id: string }>(
      `SELECT id FROM ai_chat_session WHERE id = $1 AND cloud_id = $2 AND project_key = $3`,
      [sessionId, cloudId, projectKey]
    );
    if (rows.length > 0) return rows[0].id;
  }
  const { rows } = await db().query<{ id: string }>(
    `INSERT INTO ai_chat_session (cloud_id, project_key, created_by) VALUES ($1, $2, $3) RETURNING id`,
    [cloudId, projectKey, createdBy]
  );
  return rows[0].id;
}

export async function addUserMessage(sessionId: string, content: string): Promise<string> {
  const { rows } = await db().query<{ id: string }>(
    `INSERT INTO ai_chat_message (session_id, role, content) VALUES ($1, 'user', $2) RETURNING id`,
    [sessionId, content]
  );
  await db().query(`UPDATE ai_chat_session SET updated_at = now() WHERE id = $1`, [sessionId]);
  return rows[0].id;
}

export async function addModelMessage(
  sessionId: string,
  content: string,
  thinking: string | null,
  planRunId: string | null,
  usage: ChatUsage
): Promise<string> {
  const { rows } = await db().query<{ id: string }>(
    `INSERT INTO ai_chat_message
       (session_id, role, content, thinking, plan_run_id, model,
        prompt_tokens, output_tokens, thought_tokens, cached_tokens)
     VALUES ($1, 'model', $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      sessionId,
      content,
      thinking,
      planRunId,
      usage.model,
      usage.promptTokens,
      usage.outputTokens,
      usage.thoughtTokens,
      usage.cachedTokens,
    ]
  );
  await db().query(`UPDATE ai_chat_session SET updated_at = now() WHERE id = $1`, [sessionId]);
  return rows[0].id;
}

export async function listMessages(sessionId: string): Promise<ChatMessage[]> {
  const { rows } = await db().query<{
    id: string;
    role: "user" | "model";
    content: string;
    thinking: string | null;
    plan_run_id: string | null;
    model: string | null;
    prompt_tokens: number;
    output_tokens: number;
    thought_tokens: number;
    cached_tokens: number;
    created_at: Date;
  }>(
    `SELECT id, role, content, thinking, plan_run_id, model,
            prompt_tokens, output_tokens, thought_tokens, cached_tokens, created_at
       FROM ai_chat_message WHERE session_id = $1 ORDER BY created_at`,
    [sessionId]
  );
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    thinking: r.thinking,
    planRunId: r.plan_run_id,
    model: r.model,
    usage: {
      promptTokens: r.prompt_tokens,
      outputTokens: r.output_tokens,
      thoughtTokens: r.thought_tokens,
      cachedTokens: r.cached_tokens,
    },
    createdAt: r.created_at.toISOString(),
  }));
}

/**
 * History for the next model call.
 *
 * Trimmed to the most recent turns: the system prompt already carries the whole
 * project snapshot, so old turns add cost without adding much context, and an
 * untrimmed history makes every message in a long session more expensive than
 * the last. Tool-call turns are not replayed — only their prose — because the
 * plan they produced lives in staging, not in the transcript.
 */
export async function recentTurns(sessionId: string, limit = 12): Promise<ChatTurn[]> {
  const { rows } = await db().query<{ role: "user" | "model"; content: string }>(
    `SELECT role, content FROM (
       SELECT role, content, created_at FROM ai_chat_message
        WHERE session_id = $1 AND content <> '' ORDER BY created_at DESC LIMIT $2
     ) recent ORDER BY created_at`,
    [sessionId, limit]
  );
  return rows;
}

export async function sessionUsage(sessionId: string): Promise<UsageStats> {
  const { rows } = await db().query<Record<string, string>>(
    `SELECT count(*)::text AS messages,
            coalesce(sum(prompt_tokens), 0)::text  AS prompt_tokens,
            coalesce(sum(output_tokens), 0)::text  AS output_tokens,
            coalesce(sum(thought_tokens), 0)::text AS thought_tokens,
            coalesce(sum(cached_tokens), 0)::text  AS cached_tokens
       FROM ai_chat_message WHERE session_id = $1 AND role = 'model'`,
    [sessionId]
  );
  return toStats(rows[0]);
}

/** Everything this project has spent on chat, across every session. */
export async function projectUsage(cloudId: string, projectKey: string): Promise<UsageStats> {
  const { rows } = await db().query<Record<string, string>>(
    `SELECT count(m.*)::text AS messages,
            coalesce(sum(m.prompt_tokens), 0)::text  AS prompt_tokens,
            coalesce(sum(m.output_tokens), 0)::text  AS output_tokens,
            coalesce(sum(m.thought_tokens), 0)::text AS thought_tokens,
            coalesce(sum(m.cached_tokens), 0)::text  AS cached_tokens
       FROM ai_chat_message m
       JOIN ai_chat_session s ON s.id = m.session_id
      WHERE s.cloud_id = $1 AND s.project_key = $2 AND m.role = 'model'`,
    [cloudId, projectKey]
  );
  return toStats(rows[0]);
}

// sum() returns bigint, which node-postgres hands back as a string to avoid
// silently losing precision past 2^53. Parsed here rather than in the route so
// nothing downstream has to remember that.
function toStats(row: Record<string, string> | undefined): UsageStats {
  const n = (key: string) => Number(row?.[key] ?? 0);
  const stats = {
    messages: n("messages"),
    promptTokens: n("prompt_tokens"),
    outputTokens: n("output_tokens"),
    thoughtTokens: n("thought_tokens"),
    cachedTokens: n("cached_tokens"),
  };
  return { ...stats, totalTokens: stats.promptTokens + stats.outputTokens + stats.thoughtTokens };
}
