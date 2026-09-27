-- AI progress reports, one row per generated report.
--
-- A report is a point-in-time document, so the metrics it was written from are
-- snapshotted alongside the narrative rather than re-derived on read: a report
-- from last Monday has to keep saying what it said on Monday, and re-computing
-- its numbers from today's tasks would put today's figures under last week's
-- prose. actual_pct / planned_pct / health are also lifted into columns so the
-- trend chart is one indexed query, not a JSON scan over every snapshot.
--
-- Token counters are kept per report, split the same four ways as chat messages
-- (see 002_ai_chat.sql) — they are billed differently, so one total can't be
-- turned back into money.
CREATE TABLE IF NOT EXISTS ai_progress_report (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  cloud_id       text          NOT NULL,
  project_key    text          NOT NULL,
  created_by     text          NOT NULL,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  as_of          date          NOT NULL,
  health         text          NOT NULL CHECK (health IN ('on_track', 'at_risk', 'off_track')),
  actual_pct     numeric(5, 1) NOT NULL,
  planned_pct    numeric(5, 1) NOT NULL,
  metrics        jsonb         NOT NULL,
  narrative      jsonb         NOT NULL,
  model          text,
  prompt_tokens  integer,
  output_tokens  integer,
  thought_tokens integer,
  cached_tokens  integer
);

CREATE INDEX IF NOT EXISTS ai_progress_report_project_idx
  ON ai_progress_report (cloud_id, project_key, created_at DESC);
