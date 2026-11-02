-- A copy of each project's Jira issues, so a page load asks Jira only what changed
-- (server/src/issueCache.ts). The app's Jira quota is one hourly pool shared by every
-- user, and reading a 4000-issue project whole on every load and every refresh spent it.
--
-- Jira stays the authority. Nothing here is unrecoverable: drop every row and the next
-- load reads the project again. And nothing here decides who may see what: an issue is
-- served to a user only if the id list read with THAT user's token names it
-- (jira_issue_visibility), so issue security and per-role browse rules still apply.
CREATE TABLE IF NOT EXISTS jira_issue_cache (
  cloud_id     text        NOT NULL,
  -- Jira's numeric issue id as text: stable across a move to another project, unlike the key.
  issue_id     text        NOT NULL,
  issue_key    text        NOT NULL,
  project_key  text        NOT NULL,
  -- { id, key, fields } as Jira's search returned it, minus the description.
  issue        jsonb       NOT NULL,
  -- The heaviest field, kept apart so the page load (which leaves it out) does not read it.
  description  jsonb,
  -- Which field list the row was read with; a different one is refreshed gradually.
  fields_sig   text        NOT NULL,
  -- Has an issue security level: re-read more often, never removed on a user's id list alone.
  secured      boolean     NOT NULL DEFAULT false,
  -- Jira's own `updated`, so an older copy from a lagging search index never replaces a newer one.
  jira_updated timestamptz,
  -- Set when this app wrote to the issue: the row is re-read by id (not by search) on the next load.
  stale_at     timestamptz,
  synced_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cloud_id, issue_id)
);
CREATE INDEX IF NOT EXISTS jira_issue_cache_project ON jira_issue_cache (cloud_id, project_key);
CREATE INDEX IF NOT EXISTS jira_issue_cache_key ON jira_issue_cache (cloud_id, issue_key);

-- Where the "what changed since" query starts for each project.
CREATE TABLE IF NOT EXISTS jira_project_sync (
  cloud_id      text        NOT NULL,
  project_key   text        NOT NULL,
  -- Changes since this instant are asked for (with a couple of minutes' overlap).
  delta_from    timestamptz,
  last_delta_at timestamptz,
  PRIMARY KEY (cloud_id, project_key)
);

-- The ids each user's own token can see in a project: the permission filter over the copy.
-- Kept so a refresh moments later need not ask again, and so a rate-limited Jira does not
-- leave everyone with a blank page.
CREATE TABLE IF NOT EXISTS jira_issue_visibility (
  cloud_id    text        NOT NULL,
  project_key text        NOT NULL,
  account_id  text        NOT NULL,
  issue_ids   text[]      NOT NULL,
  checked_at  timestamptz NOT NULL,
  -- false once this user created an issue: the next load lists the ids again.
  reusable    boolean     NOT NULL DEFAULT true,
  PRIMARY KEY (cloud_id, project_key, account_id)
);
