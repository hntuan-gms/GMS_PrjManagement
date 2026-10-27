-- Daily progress numbers, kept without needing an AI report.
--
-- The trend chart used to be drawn only from ai_progress_report, which exists only when
-- staff ask for one — so a guest, or a project nobody had analysed, never saw a trend. This
-- keeps the *measured* figures (the same ones computeProgress returns) once a day per
-- project instead.
--
-- Written by whoever opens the report page (routes/progress.ts), not by a scheduler: Cloud Run
-- scales to zero, so nothing runs in the background, and a project nobody opens has no
-- progress to report anyway. One row per project per day; a later visit the same day
-- refreshes it (at most every few hours) so the row ends up close to end-of-day.
CREATE TABLE IF NOT EXISTS progress_snapshot (
  cloud_id     text          NOT NULL,
  project_key  text          NOT NULL,
  snap_date    date          NOT NULL,
  actual_pct   numeric(5, 1) NOT NULL,
  planned_pct  numeric(5, 1) NOT NULL,
  spi          numeric(6, 2),
  health       text          NOT NULL CHECK (health IN ('on_track', 'at_risk', 'off_track')),
  total        integer       NOT NULL,
  done         integer       NOT NULL,
  in_progress  integer       NOT NULL,
  overdue      integer       NOT NULL,
  recorded_at  timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (cloud_id, project_key, snap_date)
);
