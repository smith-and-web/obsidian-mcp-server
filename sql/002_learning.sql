-- Learn log (server >= 1.10.0): searches, reads, feedback and sessions. Derived data only;
-- dropping these tables changes nothing about search.
CREATE TABLE IF NOT EXISTS mcp_sessions (
  session_id      text PRIMARY KEY,
  collection      text NOT NULL,
  transport       text NOT NULL CHECK (transport IN ('sse')),
  connected_at    timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz,
  client_name     text,
  client_version  text
);
CREATE INDEX IF NOT EXISTS mcp_sessions_connected ON mcp_sessions (collection, connected_at);

CREATE TABLE IF NOT EXISTS search_log (
  id              uuid PRIMARY KEY,
  collection      text NOT NULL,
  at              timestamptz NOT NULL DEFAULT now(),
  session_id      text,
  client_name     text,
  tool            text NOT NULL CHECK (tool IN ('semantic-search', 'similar-notes', 'search-vault')),
  query           text,
  redacted        boolean NOT NULL DEFAULT false,
  params          jsonb NOT NULL,
  ranker          text NOT NULL,
  results         jsonb NOT NULL
);
ALTER TABLE search_log ADD COLUMN IF NOT EXISTS query_embedding vector(__DIM__);
CREATE INDEX IF NOT EXISTS search_log_collection_at ON search_log (collection, at);
CREATE INDEX IF NOT EXISTS search_log_session_at ON search_log (session_id, at);

CREATE TABLE IF NOT EXISTS note_reads (
  id          bigserial PRIMARY KEY,
  collection  text NOT NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  session_id  text,
  client_name text,
  tool        text NOT NULL CHECK (tool IN ('read-note', 'read-multiple-notes', 'read-section')),
  path        text NOT NULL,
  request_id  uuid REFERENCES search_log(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS note_reads_request ON note_reads (request_id);
CREATE INDEX IF NOT EXISTS note_reads_session_at ON note_reads (session_id, at);

CREATE TABLE IF NOT EXISTS search_feedback (
  id             bigserial PRIMARY KEY,
  search_id      uuid NOT NULL REFERENCES search_log(id) ON DELETE CASCADE,
  at             timestamptz NOT NULL DEFAULT now(),
  source         text NOT NULL CHECK (source IN ('user', 'agent')),
  rating         text NOT NULL CHECK (rating IN ('positive', 'negative', 'neutral')),
  used_paths     text[] NOT NULL DEFAULT '{}',
  expected_paths text[] NOT NULL DEFAULT '{}',
  note           text,
  redacted       boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS search_feedback_search ON search_feedback (search_id);
