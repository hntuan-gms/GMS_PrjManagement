-- What Jira last said about the app's quota, shared by every instance (jiraQuota.ts).
-- `scope` is "app" for the app-wide hourly pool, "site:<cloudId>" for one site's.
CREATE TABLE IF NOT EXISTS jira_quota_state (
  scope            text        PRIMARY KEY,
  -- Jira answered X-RateLimit-NearLimit: true. Background reads stop until this passes.
  near_limit_until timestamptz,
  -- Jira refused with a long Retry-After. Nothing is asked of Jira until this passes.
  limited_until    timestamptz,
  reason           text,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- A project's member list as one viewer's permissions resolve it (projectMembers.ts):
-- one Jira call per role and per group, for an answer that changes a few times a year.
-- Names, avatars and account ids only — never an email address.
CREATE TABLE IF NOT EXISTS project_member_cache (
  cloud_id    text        NOT NULL,
  project_key text        NOT NULL,
  account_id  text        NOT NULL,
  members     jsonb       NOT NULL,
  expires_at  timestamptz NOT NULL,
  PRIMARY KEY (cloud_id, project_key, account_id)
);

-- One Jira dynamic webhook per project (jiraWebhooks.ts), registered with whichever user's
-- token first opened the project while JIRA_WEBHOOKS is on. Jira expires it after 30 days.
CREATE TABLE IF NOT EXISTS jira_webhook (
  cloud_id        text        NOT NULL,
  project_key     text        NOT NULL,
  webhook_id      bigint,
  registered_by   text,
  expires_at      timestamptz,
  last_attempt_at timestamptz,
  last_error      text,
  PRIMARY KEY (cloud_id, project_key)
);
CREATE INDEX IF NOT EXISTS jira_webhook_id ON jira_webhook (webhook_id);

-- Fields a project's board needs beyond the task list (rank, estimate, flag), added to
-- what the issue copy reads once the board is opened.
ALTER TABLE jira_project_sync ADD COLUMN IF NOT EXISTS extra_fields text[] NOT NULL DEFAULT '{}';
-- Set when a webhook says something changed: the next load asks "what changed" at once.
ALTER TABLE jira_project_sync ADD COLUMN IF NOT EXISTS changed_at timestamptz;
