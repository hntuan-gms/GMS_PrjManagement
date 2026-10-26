-- Settings for importing KBKT test-case workbooks (routes/kbkt.ts), one row per
-- Jira project: what jira_sync_config.json used to hard-code — issue type names,
-- the status each test result / bug state maps to, severity → priority, link type,
-- which new issues get a due date.
--
-- One jsonb blob rather than columns: it is always read and written whole, and
-- validated in code (kbkt/settings.ts). A project with no row uses the defaults,
-- so the table starting empty is a valid state, not a setup step.
CREATE TABLE IF NOT EXISTS kbkt_import_settings (
  cloud_id    text        NOT NULL,
  project_key text        NOT NULL,
  settings    jsonb       NOT NULL,
  updated_by  text        NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cloud_id, project_key)
);
