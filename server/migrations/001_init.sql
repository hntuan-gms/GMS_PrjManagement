-- Everything this app owns that Jira cannot hold.
--
-- Jira owns: summary, issuetype, status, assignee, parent, duedate, and (when the
-- site has one) a native Start date field. None of the columns below exist there:
-- Jira issue links carry no FS/SS/FF/SF type and no lag, Jira has no baseline
-- concept, standard issues have no % field, and there is nowhere to record a
-- person's skills or planned absence.

-- Scoping: every table is keyed by the Atlassian cloudId. Two sites can both
-- contain an issue called ABC-1, and a user's session is bound to exactly one
-- site, so cloud_id is part of every primary key and every lookup.

CREATE TABLE IF NOT EXISTS task_overlay (
  cloud_id         text        NOT NULL,
  issue_key        text        NOT NULL,
  -- Derived from the issue key prefix. Denormalised so loading one project's
  -- schedule is a single indexed read instead of a scan over the whole site.
  project_key      text        NOT NULL,
  start_date       date,
  duration_days    integer     NOT NULL DEFAULT 1 CHECK (duration_days >= 1),
  percent_complete integer     NOT NULL DEFAULT 0 CHECK (percent_complete BETWEEN 0 AND 100),
  baseline_start   date,
  baseline_due     date,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cloud_id, issue_key)
);

CREATE INDEX IF NOT EXISTS task_overlay_project_idx ON task_overlay (cloud_id, project_key);

-- One row per dependency edge, rather than a JSON array on the successor. The
-- cascade's hot question is "who depends on X?", which a JSON array can only
-- answer by scanning every task; here it is an index lookup.
CREATE TABLE IF NOT EXISTS task_dependency (
  cloud_id        text    NOT NULL,
  successor_key   text    NOT NULL,
  predecessor_key text    NOT NULL,
  type            text    NOT NULL CHECK (type IN ('FS', 'SS', 'FF', 'SF')),
  lag_days        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cloud_id, successor_key, predecessor_key, type),
  CONSTRAINT task_dependency_no_self_link CHECK (successor_key <> predecessor_key)
);

CREATE INDEX IF NOT EXISTS task_dependency_predecessor_idx
  ON task_dependency (cloud_id, predecessor_key);

-- Input 2 for the planning agent: who is on the team and what they can do.
-- Jira supplies accountId and displayName; role, skills and capacity exist
-- nowhere in Jira and are exactly what the agent needs to assign work.
CREATE TABLE IF NOT EXISTS resource_profile (
  cloud_id               text        NOT NULL,
  account_id             text        NOT NULL,
  display_name           text        NOT NULL,
  role                   text,
  skills                 text[]      NOT NULL DEFAULT '{}',
  capacity_hours_per_day numeric(4, 2) NOT NULL DEFAULT 8 CHECK (capacity_hours_per_day > 0),
  cost_per_day           numeric(12, 2),
  notes                  text,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cloud_id, account_id)
);

-- Input 3, the half that cannot be derived: leave, holidays, time on another
-- project. Load from assigned tasks is computed from task_overlay instead —
-- storing it would just be a cache that goes stale on the next drag.
CREATE TABLE IF NOT EXISTS resource_absence (
  id         bigserial   PRIMARY KEY,
  cloud_id   text        NOT NULL,
  account_id text        NOT NULL,
  from_date  date        NOT NULL,
  to_date    date        NOT NULL,
  reason     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT resource_absence_range CHECK (to_date >= from_date)
);

CREATE INDEX IF NOT EXISTS resource_absence_lookup_idx
  ON resource_absence (cloud_id, account_id, from_date);

-- One planning run by the agent. Kept whether it succeeds or fails: a failed run
-- with its raw output is the only way to debug a bad plan after the fact, and the
-- token counts are what keep spend visible.
CREATE TABLE IF NOT EXISTS ai_plan_run (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cloud_id      text        NOT NULL,
  project_key   text        NOT NULL,
  created_by    text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  status        text        NOT NULL DEFAULT 'running'
                            CHECK (status IN ('running', 'proposed', 'applied', 'failed', 'discarded')),
  brief         text        NOT NULL,
  model         text,
  input_tokens  integer,
  output_tokens integer,
  raw_output    jsonb,
  error         text,
  applied_at    timestamptz
);

CREATE INDEX IF NOT EXISTS ai_plan_run_project_idx
  ON ai_plan_run (cloud_id, project_key, created_at DESC);

-- The proposed plan, staged. Nothing here exists in Jira yet: a PM reviews and
-- edits these rows, and only on approval are they created as issues and their
-- keys written back to applied_issue_key. An LLM must never write straight into
-- a live backlog — a bad decomposition would otherwise mean dozens of manual
-- deletions.
CREATE TABLE IF NOT EXISTS ai_plan_item (
  id                  uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              uuid    NOT NULL REFERENCES ai_plan_run (id) ON DELETE CASCADE,
  -- The id the model assigned ("T1", "T2"). Dependencies and parents reference
  -- these, since no Jira key exists until the plan is applied.
  temp_id             text    NOT NULL,
  parent_temp_id      text,
  sort_order          integer NOT NULL,
  summary             text    NOT NULL,
  description         text,
  issue_type          text    NOT NULL,
  duration_days       integer NOT NULL CHECK (duration_days >= 1),
  assignee_account_id text,
  -- [{ "tempId": "T1", "type": "FS", "lagDays": 0 }, ...]
  dependencies        jsonb   NOT NULL DEFAULT '[]',
  -- Why the model chose this duration/assignee. Shown in the review UI so a PM
  -- can judge the estimate instead of taking it on faith.
  rationale           text,
  applied_issue_key   text,
  UNIQUE (run_id, temp_id)
);

CREATE INDEX IF NOT EXISTS ai_plan_item_run_idx ON ai_plan_item (run_id, sort_order);
