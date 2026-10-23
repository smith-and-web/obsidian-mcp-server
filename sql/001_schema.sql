-- obsidian-mcp-server semantic index — schema v1
-- Apply with the embedding dimension substituted, e.g.
--   sed 's/__DIM__/768/' sql/001_schema.sql | psql "$DATABASE_URL"
-- The indexer also applies this itself on first run (see src/index/store.ts),
-- so running it by hand is optional.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS meta (
  key   text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id             bigserial PRIMARY KEY,
  collection     text NOT NULL,
  path           text NOT NULL,
  title          text NOT NULL,
  frontmatter    jsonb NOT NULL DEFAULT '{}'::jsonb,
  tags           text[] NOT NULL DEFAULT '{}',
  content_sha256 text NOT NULL,
  mtime          timestamptz NOT NULL,
  size           bigint NOT NULL,
  centroid       vector(__DIM__),
  indexed_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collection, path)
);

-- Added in 1.7.0: why a note's frontmatter could not be parsed (NULL = fine). Safe on existing databases.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS frontmatter_error text;

CREATE TABLE IF NOT EXISTS chunks (
  id             bigserial PRIMARY KEY,
  document_id    bigint NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ord            integer NOT NULL,
  heading_path   text NOT NULL DEFAULT '',
  content        text NOT NULL,
  content_sha256 text NOT NULL,
  tokens         integer NOT NULL,
  embedding      vector(__DIM__) NOT NULL,
  tsv            tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  UNIQUE (document_id, ord)
);

CREATE TABLE IF NOT EXISTS links (
  src_document_id    bigint NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  target_path        text NOT NULL,
  target_document_id bigint REFERENCES documents(id) ON DELETE SET NULL,
  PRIMARY KEY (src_document_id, target_path)
);

CREATE TABLE IF NOT EXISTS index_runs (
  id          bigserial PRIMARY KEY,
  collection  text NOT NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  seen        integer NOT NULL DEFAULT 0,
  changed     integer NOT NULL DEFAULT 0,
  removed     integer NOT NULL DEFAULT 0,
  errors      integer NOT NULL DEFAULT 0,
  error_text  text
);

CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS chunks_tsv_gin ON chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS documents_tags_gin ON documents USING gin (tags);
CREATE INDEX IF NOT EXISTS documents_collection_path ON documents (collection, path);
CREATE INDEX IF NOT EXISTS documents_type ON documents ((frontmatter->>'type'));
CREATE INDEX IF NOT EXISTS documents_status ON documents ((frontmatter->>'status'));
CREATE INDEX IF NOT EXISTS links_target_path ON links (target_path);
CREATE INDEX IF NOT EXISTS index_runs_collection_started ON index_runs (collection, started_at DESC);
