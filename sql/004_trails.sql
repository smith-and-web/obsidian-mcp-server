-- Trails (server >= 1.12.0): derived from the learn log, rebuilt in full by `trails`. Dropping these tables changes
-- search only when SEARCH_TRAILS is shadow or on.
CREATE TABLE IF NOT EXISTS trails (
  collection  text NOT NULL,
  path_a      text NOT NULL,
  path_b      text NOT NULL,
  weight      real NOT NULL,
  events      integer NOT NULL,
  last_at     timestamptz NOT NULL,
  computed_at timestamptz NOT NULL,
  PRIMARY KEY (collection, path_a, path_b),
  CHECK (path_a < path_b)
);
CREATE INDEX IF NOT EXISTS trails_b ON trails (collection, path_b);

CREATE TABLE IF NOT EXISTS note_heat (
  collection  text NOT NULL,
  path        text NOT NULL,
  score       real NOT NULL,
  bucket      smallint NOT NULL CHECK (bucket BETWEEN 0 AND 5),
  computed_at timestamptz NOT NULL,
  PRIMARY KEY (collection, path)
);

CREATE TABLE IF NOT EXISTS trails_runs (
  id          bigserial PRIMARY KEY,
  collection  text NOT NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  metrics     jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_text  text
);
CREATE INDEX IF NOT EXISTS trails_runs_collection_started ON trails_runs (collection, started_at DESC);

-- Written only when SEARCH_TRAILS=shadow (server >= 1.14.0).
ALTER TABLE search_log ADD COLUMN IF NOT EXISTS shadow jsonb;
