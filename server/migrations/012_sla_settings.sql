-- SLA policy per Jira project (routes/sla.ts): working hours allowed per priority,
-- which issue types count, and the business calendar the clock runs on (working
-- weekdays, working periods of the day, holidays, timezone).
--
-- One jsonb blob rather than columns, like kbkt_import_settings: it is always read
-- and written whole, and validated in code (sla.ts). A project with no row uses the
-- defaults, which have SLA switched off, so the table starting empty is a valid state.
CREATE TABLE IF NOT EXISTS sla_settings (
  cloud_id    text        NOT NULL,
  project_key text        NOT NULL,
  settings    jsonb       NOT NULL,
  updated_by  text        NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cloud_id, project_key)
);
