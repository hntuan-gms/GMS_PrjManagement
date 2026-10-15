-- Regenerating an answer and editing the last question.
--
-- Neither deletes anything: a message's token counters are the project's spend
-- ledger (projectUsage sums every row), so a replaced answer must keep counting.
-- It is marked superseded instead, and every transcript/history query skips it.
ALTER TABLE ai_chat_message ADD COLUMN IF NOT EXISTS superseded_at timestamptz;

-- Whether the turn wrote to Jira (a created task, a comment, logged time…).
-- Answering such a turn again would write it again, so the server refuses to
-- regenerate or edit one; the flag is what it checks.
ALTER TABLE ai_chat_message ADD COLUMN IF NOT EXISTS mutated boolean NOT NULL DEFAULT false;
