import { db } from "../db/pool.js";
import type { ChatTurn, ChatUsage } from "./chat.js";
import { attachmentNote, type AttachmentMeta } from "./attachments.js";
import { costOfRows, priceTable, type Money } from "./pricing.js";

export interface ChatMessage {
  id: string;
  role: "user" | "model";
  content: string;
  thinking: string | null;
  planRunId: string | null;
  model: string | null;
  usage: { promptTokens: number; outputTokens: number; thoughtTokens: number; cachedTokens: number };
  /** Wrote to Jira: such a turn cannot be regenerated or edited without writing again. */
  mutated: boolean;
  /** Files attached to a user message — name, type, size only; the bytes were never stored. */
  attachments: AttachmentMeta[];
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
  /**
   * What these tokens cost, from the GEMINI_PRICING table (ai/pricing.ts). Null
   * when no price is configured for any model used — never an invented figure.
   */
  cost: Money | null;
}

export interface ChatSessionSummary {
  id: string;
  title: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether this account owns this session in this project. Every read and write
 * goes through the owner — a session is one person's conversation, and its
 * transcript can hold things they asked in private ("ai đang làm chậm nhất?").
 * A malformed id is treated as "not yours" rather than a Postgres cast error.
 */
export async function ownsSession(cloudId: string, projectKey: string, accountId: string, sessionId: string): Promise<boolean> {
  if (!UUID.test(sessionId)) return false;
  const { rows } = await db().query(
    `SELECT 1 FROM ai_chat_session
      WHERE id = $1 AND cloud_id = $2 AND project_key = $3 AND created_by = $4 AND deleted_at IS NULL`,
    [sessionId, cloudId, projectKey, accountId]
  );
  return rows.length > 0;
}

/** The given session if this account owns it, otherwise a fresh one. */
export async function ensureSession(
  cloudId: string,
  projectKey: string,
  createdBy: string,
  sessionId: string | null
): Promise<string> {
  if (sessionId && (await ownsSession(cloudId, projectKey, createdBy, sessionId))) return sessionId;
  const { rows } = await db().query<{ id: string }>(
    `INSERT INTO ai_chat_session (cloud_id, project_key, created_by) VALUES ($1, $2, $3) RETURNING id`,
    [cloudId, projectKey, createdBy]
  );
  return rows[0].id;
}

export async function addUserMessage(sessionId: string, content: string, attachments: AttachmentMeta[] = []): Promise<string> {
  const { rows } = await db().query<{ id: string }>(
    `INSERT INTO ai_chat_message (session_id, role, content, attachments) VALUES ($1, 'user', $2, $3) RETURNING id`,
    [sessionId, content, attachments.length > 0 ? JSON.stringify(attachments) : null]
  );
  // The first question names the conversation, as in every chat app; a rename
  // later overwrites it and is kept (coalesce only fills an empty title).
  await db().query(
    `UPDATE ai_chat_session SET updated_at = now(), title = coalesce(title, $2) WHERE id = $1`,
    [sessionId, titleFrom(content)]
  );
  return rows[0].id;
}

export async function addModelMessage(
  sessionId: string,
  content: string,
  thinking: string | null,
  planRunId: string | null,
  usage: ChatUsage,
  mutated = false
): Promise<string> {
  const { rows } = await db().query<{ id: string }>(
    `INSERT INTO ai_chat_message
       (session_id, role, content, thinking, plan_run_id, model,
        prompt_tokens, output_tokens, thought_tokens, cached_tokens, mutated)
     VALUES ($1, 'model', $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
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
      mutated,
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
    mutated: boolean;
    attachments: AttachmentMeta[] | null;
    created_at: Date;
  }>(
    `SELECT id, role, content, thinking, plan_run_id, model,
            prompt_tokens, output_tokens, thought_tokens, cached_tokens, mutated, attachments, created_at
       FROM ai_chat_message WHERE session_id = $1 AND superseded_at IS NULL ORDER BY created_at`,
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
    mutated: r.mutated,
    attachments: r.attachments ?? [],
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
  const { rows } = await db().query<{ role: "user" | "model"; content: string; attachments: AttachmentMeta[] | null }>(
    `SELECT role, content, attachments FROM (
       SELECT role, content, attachments, created_at FROM ai_chat_message
        WHERE session_id = $1 AND content <> '' AND superseded_at IS NULL ORDER BY created_at DESC LIMIT $2
     ) recent ORDER BY created_at`,
    [sessionId, limit]
  );
  // The files themselves are gone; the model is told they existed, so "như ảnh trên"
  // reads as a reference to something it cannot see now rather than to nothing.
  return rows.map((r) => ({
    role: r.role,
    content: r.attachments?.length ? `${r.content}\n${attachmentNote(r.attachments)} (nội dung tệp không còn trong lịch sử)` : r.content,
  }));
}

/**
 * Both usage queries group by model: a session can span a GEMINI_MODEL change, and
 * each model prices differently, so the money is summed per group, not per total.
 * Superseded (regenerated) messages are counted on purpose — those tokens were spent.
 */
const USAGE_COLUMNS = `m.model,
            count(*)::text                              AS messages,
            coalesce(sum(m.prompt_tokens), 0)::text     AS prompt_tokens,
            coalesce(sum(m.output_tokens), 0)::text     AS output_tokens,
            coalesce(sum(m.thought_tokens), 0)::text    AS thought_tokens,
            coalesce(sum(m.cached_tokens), 0)::text     AS cached_tokens`;

export async function sessionUsage(sessionId: string): Promise<UsageStats> {
  const { rows } = await db().query<UsageRow>(
    `SELECT ${USAGE_COLUMNS}
       FROM ai_chat_message m WHERE m.session_id = $1 AND m.role = 'model' GROUP BY m.model`,
    [sessionId]
  );
  return toStats(rows);
}

/** Everything this project has spent on chat, across every session. */
export async function projectUsage(cloudId: string, projectKey: string): Promise<UsageStats> {
  const { rows } = await db().query<UsageRow>(
    `SELECT ${USAGE_COLUMNS}
       FROM ai_chat_message m
       JOIN ai_chat_session s ON s.id = m.session_id
      WHERE s.cloud_id = $1 AND s.project_key = $2 AND m.role = 'model' GROUP BY m.model`,
    [cloudId, projectKey]
  );
  return toStats(rows);
}

type UsageRow = {
  model: string | null;
  messages: string;
  prompt_tokens: string;
  output_tokens: string;
  thought_tokens: string;
  cached_tokens: string;
};

// sum() returns bigint, which node-postgres hands back as a string to avoid
// silently losing precision past 2^53. Parsed here rather than in the route so
// nothing downstream has to remember that.
function toStats(rows: UsageRow[]): UsageStats {
  const perModel = rows.map((r) => ({
    model: r.model,
    promptTokens: Number(r.prompt_tokens),
    outputTokens: Number(r.output_tokens),
    thoughtTokens: Number(r.thought_tokens),
    cachedTokens: Number(r.cached_tokens),
  }));
  const sum = (k: "promptTokens" | "outputTokens" | "thoughtTokens" | "cachedTokens") => perModel.reduce((a, r) => a + r[k], 0);
  const stats = {
    messages: rows.reduce((a, r) => a + Number(r.messages), 0),
    promptTokens: sum("promptTokens"),
    outputTokens: sum("outputTokens"),
    thoughtTokens: sum("thoughtTokens"),
    cachedTokens: sum("cachedTokens"),
  };
  return {
    ...stats,
    totalTokens: stats.promptTokens + stats.outputTokens + stats.thoughtTokens,
    cost: costOfRows(priceTable(), perModel),
  };
}

function titleFrom(message: string): string {
  const flat = message.replace(/\s+/g, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 59)}…` : flat;
}

/** This account's conversations in this project, most recent first. */
export async function listSessions(cloudId: string, projectKey: string, accountId: string, limit = 50): Promise<ChatSessionSummary[]> {
  const { rows } = await db().query<{
    id: string;
    title: string | null;
    message_count: string;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT s.id, s.title, s.created_at, s.updated_at,
            (SELECT count(*) FROM ai_chat_message m WHERE m.session_id = s.id AND m.superseded_at IS NULL)::text AS message_count
       FROM ai_chat_session s
      WHERE s.cloud_id = $1 AND s.project_key = $2 AND s.created_by = $3 AND s.deleted_at IS NULL
      ORDER BY s.updated_at DESC
      LIMIT $4`,
    [cloudId, projectKey, accountId, limit]
  );
  return rows
    .filter((r) => Number(r.message_count) > 0)
    .map((r) => ({
      id: r.id,
      title: r.title ?? "Cuộc trò chuyện",
      messageCount: Number(r.message_count),
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    }));
}

export async function renameSession(cloudId: string, projectKey: string, accountId: string, sessionId: string, title: string): Promise<boolean> {
  if (!UUID.test(sessionId)) return false;
  const { rowCount } = await db().query(
    `UPDATE ai_chat_session SET title = $5
      WHERE id = $1 AND cloud_id = $2 AND project_key = $3 AND created_by = $4 AND deleted_at IS NULL`,
    [sessionId, cloudId, projectKey, accountId, titleFrom(title)]
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Hides the conversation from its owner. A soft delete: the messages' token
 * counters are the project's spend ledger (projectUsage sums every session), and
 * deleting a chat must not quietly lower what the project has cost.
 */
export async function deleteSession(cloudId: string, projectKey: string, accountId: string, sessionId: string): Promise<boolean> {
  if (!UUID.test(sessionId)) return false;
  const { rowCount } = await db().query(
    `UPDATE ai_chat_session SET deleted_at = now()
      WHERE id = $1 AND cloud_id = $2 AND project_key = $3 AND created_by = $4 AND deleted_at IS NULL`,
    [sessionId, cloudId, projectKey, accountId]
  );
  return (rowCount ?? 0) > 0;
}

/** The last exchange still on screen: the final user message and the model's answer to it, if any. */
export async function latestTurn(
  sessionId: string
): Promise<{
  user: { id: string; content: string; hasAttachments: boolean } | null;
  model: { id: string; mutated: boolean } | null;
}> {
  const { rows } = await db().query<{ id: string; role: "user" | "model"; content: string; mutated: boolean; attachments: unknown }>(
    `SELECT id, role, content, mutated, attachments FROM ai_chat_message
      WHERE session_id = $1 AND superseded_at IS NULL ORDER BY created_at DESC LIMIT 2`,
    [sessionId]
  );
  const last = rows[0];
  if (!last) return { user: null, model: null };
  const asUser = (r: typeof last) => ({ id: r.id, content: r.content, hasAttachments: Array.isArray(r.attachments) && r.attachments.length > 0 });
  if (last.role === "user") return { user: asUser(last), model: null };
  const before = rows[1]?.role === "user" ? rows[1] : null;
  return {
    user: before ? asUser(before) : null,
    model: { id: last.id, mutated: last.mutated },
  };
}

/** Hides messages from the transcript and the model's history; their tokens still count. */
export async function supersede(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db().query(`UPDATE ai_chat_message SET superseded_at = now() WHERE id = ANY($1::uuid[])`, [ids]);
}
