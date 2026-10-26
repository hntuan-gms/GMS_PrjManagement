-- Named filters on the Gantt / resource view, saved and optionally shared.
--
-- Keyed by cloud_id + project_key like every other table, because two sites can
-- both have a project "ABC". A filter is a few words and some ids — the same
-- TaskFilter the toolbar holds, plus an optional JQL — so `spec` is jsonb and the
-- server only sanitises it; it never interprets it.
--
-- `shared` filters are visible to everyone who can open the project; an unshared one
-- only to its owner. Only the owner can change or delete either.
CREATE TABLE IF NOT EXISTS saved_filter (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cloud_id       text        NOT NULL,
  project_key    text        NOT NULL,
  name           text        NOT NULL,
  spec           jsonb       NOT NULL,
  shared         boolean     NOT NULL DEFAULT true,
  created_by     text        NOT NULL,
  -- Shown beside a shared filter ("tạo bởi …"); a display name is not secret, and
  -- reading it back from Jira for every row would be a call per owner.
  created_by_name text       NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS saved_filter_project_idx
  ON saved_filter (cloud_id, project_key, updated_at DESC);
