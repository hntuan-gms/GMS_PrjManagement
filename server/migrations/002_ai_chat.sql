-- Chat sessions for the planning assistant, and the token ledger.
--
-- Usage is recorded per message rather than per session: a session's cost is a
-- SUM over these rows, but a single expensive turn is only findable if each turn
-- is stored on its own. Every counter Gemini reports gets its own column —
-- rolling them into one total would hide that thinking tokens and cached input
-- are billed differently from ordinary input and output.

CREATE TABLE IF NOT EXISTS ai_chat_session (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cloud_id    text        NOT NULL,
  project_key text        NOT NULL,
  created_by  text        NOT NULL,
  title       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_chat_session_project_idx
  ON ai_chat_session (cloud_id, project_key, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_chat_message (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid        NOT NULL REFERENCES ai_chat_session (id) ON DELETE CASCADE,
  role        text        NOT NULL CHECK (role IN ('user', 'model')),
  content     text        NOT NULL DEFAULT '',
  -- The model's streamed reasoning, kept so a turn can be reopened later and
  -- still show why it did what it did.
  thinking    text,
  -- Set when this turn produced a plan; the chat bubble links to it.
  plan_run_id uuid        REFERENCES ai_plan_run (id) ON DELETE SET NULL,
  model       text,
  -- Gemini's four counters, kept apart because they price differently.
  prompt_tokens integer   NOT NULL DEFAULT 0,
  output_tokens integer   NOT NULL DEFAULT 0,
  thought_tokens integer  NOT NULL DEFAULT 0,
  cached_tokens integer   NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_chat_message_session_idx
  ON ai_chat_message (session_id, created_at);
