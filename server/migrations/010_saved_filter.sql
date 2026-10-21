-- Named filters over the Gantt / resource tab (routes/filters.ts). Before this the
-- filter lived only in one browser's localStorage, with no name and no way to hand
-- it to a teammate.
--
-- `spec` is the facet set (savedFilters.ts validates it) as one jsonb blob: it is
-- always read and applied whole. The signed-in user's own account id is stored as
-- "@me", so a shared "Của tôi" filter shows each person their own work.
--
-- Visibility is two-valued on purpose: private to its creator, or `shared` with
-- everyone who can open the project. Only the creator can change or delete it.
CREATE TABLE IF NOT EXISTS saved_filter (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cloud_id    text        NOT NULL,
  project_key text        NOT NULL,
  name        text        NOT NULL,
  spec        jsonb       NOT NULL,
  shared      boolean     NOT NULL DEFAULT false,
  created_by  text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS saved_filter_project_idx ON saved_filter (cloud_id, project_key);
