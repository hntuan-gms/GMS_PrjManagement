-- Chat sessions are private to the account that started them.
--
-- created_by was always recorded but never enforced: a session was looked up by
-- (id, cloud_id, project_key) alone, and the browser kept one session id per
-- machine rather than per account — so a second person logging in on the same
-- computer silently continued the first person's conversation. Every lookup is
-- now also keyed by created_by, and the session list reads exactly this index.
CREATE INDEX IF NOT EXISTS ai_chat_session_owner_idx
  ON ai_chat_session (cloud_id, project_key, created_by, updated_at DESC);

-- Deleting a conversation hides it from its owner; the rows stay, because their
-- token counters are the project's spend ledger and "delete a chat" must not
-- quietly lower what the project has cost.
ALTER TABLE ai_chat_session ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
