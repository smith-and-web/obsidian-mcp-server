-- Maintenance (server >= 1.11.0): derived data about the vault; dropping these tables changes nothing about
-- search. brain_changes is written only by auto-apply (a later stage).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS doc_history (
  id                  bigserial PRIMARY KEY,
  document_id         bigint NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  at                  timestamptz NOT NULL DEFAULT now(),
  content_sha256      text NOT NULL,
  summary             text,
  summary_body_cosine real
);
CREATE INDEX IF NOT EXISTS doc_history_doc_at ON doc_history (document_id, at);

CREATE TABLE IF NOT EXISTS maintenance_runs (
  id           bigserial PRIMARY KEY,
  collection   text NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  report_id    text,
  report_path  text,
  metrics      jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_text   text
);
CREATE INDEX IF NOT EXISTS maintenance_runs_collection_started ON maintenance_runs (collection, started_at DESC);

CREATE TABLE IF NOT EXISTS maintenance_findings (
  id                bigserial PRIMARY KEY,
  collection        text NOT NULL,
  at                timestamptz NOT NULL DEFAULT now(),
  class             text NOT NULL,
  finding_key       text NOT NULL,
  paths             text[] NOT NULL,
  detail            jsonb NOT NULL,
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'rejected', 'resolved')),
  decided_at        timestamptz,
  decided_via       text CHECK (decided_via IN ('checkbox', 'tool')),
  decision_note     text,
  first_reported_in text,
  last_reported_in  text,
  last_seen_run     bigint REFERENCES maintenance_runs(id) ON DELETE SET NULL,
  UNIQUE (collection, finding_key)
);
CREATE INDEX IF NOT EXISTS maintenance_findings_status ON maintenance_findings (collection, status);

CREATE TABLE IF NOT EXISTS change_classes (
  collection  text NOT NULL,
  class       text NOT NULL,
  graduable   boolean NOT NULL,
  mode        text NOT NULL DEFAULT 'report' CHECK (mode IN ('report', 'apply')),
  decided     int NOT NULL DEFAULT 0,
  accepted    int NOT NULL DEFAULT 0,
  applied     int NOT NULL DEFAULT 0,
  reverted    int NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, class)
);

CREATE TABLE IF NOT EXISTS brain_changes (
  id          bigserial PRIMARY KEY,
  collection  text NOT NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  class       text NOT NULL,
  path        text NOT NULL,
  finding_id  bigint REFERENCES maintenance_findings(id) ON DELETE SET NULL,
  before_sha  text NOT NULL,
  after_sha   text NOT NULL,
  before_text text NOT NULL,
  reverted_at timestamptz
);
