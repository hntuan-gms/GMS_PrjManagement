-- Reports can be deleted from the page, softly.
--
-- Same reasoning as ai_chat_session.deleted_at (see 005): the token counters on
-- each report are part of the project's AI spend ledger, so tidying the history
-- must hide a row, never remove it.
ALTER TABLE ai_progress_report ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
