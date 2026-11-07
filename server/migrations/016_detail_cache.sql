-- What the task detail reads from Jira, kept so the app's one hourly Jira quota is not spent again for every
-- person who opens the same task (server/src/detailCache.ts). Jira stays the authority: drop every row and
-- the next read asks Jira again. Nothing here decides who may see what.

-- A project's own lists: priorities, issue types, labels, components, versions, link types. They change
-- rarely and every person reads the same answer, so they are kept ten minutes (a day when Jira refuses for
-- rate) instead of being read for each task opened. Served only after requireProject has confirmed the user
-- can browse the project.
CREATE TABLE IF NOT EXISTS project_list_cache (
  cloud_id    text        NOT NULL,
  project_key text        NOT NULL,
  kind        text        NOT NULL,
  items       jsonb       NOT NULL,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cloud_id, project_key, kind)
);

-- One task's comments and attachments. Served to a person only when the id list read with THEIR token names
-- the issue (jira_issue_visibility), and only while the issue's own `updated` is the one the row was read at,
-- so a comment added in Jira is seen as soon as the project's "what changed" read notices it.
--
-- A comment can be restricted to a group or role in Jira; such comments are never stored, and an issue that
-- has one is flagged `restricted` so it is always read from Jira (a copy would show some people less than
-- Jira does, or others more).
CREATE TABLE IF NOT EXISTS issue_detail_cache (
  cloud_id      text        NOT NULL,
  issue_id      text        NOT NULL,
  kind          text        NOT NULL,
  data          jsonb       NOT NULL,
  restricted    boolean     NOT NULL DEFAULT false,
  -- The issue's `updated` when this was read; a different value in the issue copy means it changed since.
  issue_updated timestamptz,
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cloud_id, issue_id, kind)
);
