/**
 * IndexStore — everything that touches Postgres/pgvector.
 *
 * One class, one pool. The indexer writes through it; the search tools read
 * through it. The schema is applied by `ensureSchema()` from sql/001_schema.sql
 * with the embedding dimension substituted, and the model name and dimension
 * are recorded in `meta` so a later run with a different model refuses to mix
 * vectors.
 */

import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import pgvector from 'pgvector/pg';
import type { Chunk } from './chunker.js';
import type { Frontmatter } from '../types/index.js';
import { DEFAULT_RANKING, fuse, capPerNote, type RankingConfig, type LegHit } from './ranking.js';

const { Pool } = pg;

export const SCHEMA_VERSION = '1';

/** How an MCP session reached the server: the legacy SSE stream or POST /sse with Mcp-Session-Id. */
export type SessionTransport = 'sse' | 'post';

export interface DocumentRecord {
  id: number;
  path: string;
  contentSha256: string;
  mtime: Date;
  size: number;
}

export interface UpsertDocumentInput {
  path: string;
  title: string;
  frontmatter: Frontmatter | null;
  tags: string[];
  contentSha256: string;
  mtime: Date;
  size: number;
  chunks: Chunk[];
  embeddings: number[][];
  links: string[];
  /** Parser error when the frontmatter is not valid YAML; stored so status can list it. */
  frontmatterError?: string | null;
}

export interface InvalidFrontmatterNote {
  path: string;
  error: string;
}

export interface SearchFilters {
  directory?: string;
  tags?: string[];
  type?: string;
  status?: string;
}

export interface SearchHit {
  path: string;
  title: string;
  headingPath: string;
  ord: number;
  score: number;
  vectorRank: number | null;
  textRank: number | null;
  snippet: string;
}

export interface SimilarHit {
  path: string;
  title: string;
  score: number;
}

export interface IndexRunRecord {
  id: number;
  startedAt: Date;
  finishedAt: Date | null;
  seen: number;
  changed: number;
  removed: number;
  errors: number;
  errorText: string | null;
}

export interface IndexStatus {
  collection: string;
  embedModel: string | null;
  dim: number | null;
  schemaVersion: string | null;
  documents: number;
  chunks: number;
  lastRun: IndexRunRecord | null;
  lagSeconds: number | null;
  /** Notes whose frontmatter is not valid YAML (indexed without it). `notes` is capped at 20. */
  invalidFrontmatter: { count: number; notes: InvalidFrontmatterNote[] };
}

export interface IndexStoreOptions {
  connectionString: string;
  collection: string;
  readOnly?: boolean;
  pgOptions?: string;
}

function toSqlVector(v: number[]): string {
  return pgvector.toSql(v) as string;
}

function snippetOf(content: string, max = 400): string {
  // Drop the breadcrumb line the chunker prepends; it is returned separately.
  const body = content.includes('\n\n') ? content.slice(content.indexOf('\n\n') + 2) : content;
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function normalizeDirectory(directory: string | undefined): string | null {
  if (!directory) return null;
  const clean = directory.replace(/^[/\\]+/, '').replace(/[/\\]+$/, '');
  return clean ? `${clean}/` : null;
}

export interface RecommendInput {
  positive: string[];
  negative: string[];
  k: number;
  strategy: 'best_score' | 'average_vector';
  type?: string;
  directory?: string;
}

export interface Candidate {
  key: string;
  paths: string[];
  detail: Record<string, unknown>;
}
export interface FindingRow {
  id: number;
  class: string;
  paths: string[];
  detail: Record<string, unknown>;
  status: string;
  decidedVia: string | null;
  decidedAt: Date | null;
}
export interface Hygiene {
  documents: number;
  unresolvedLinks: number;
  orphans: number;
  invalidFrontmatter: number;
  nearDuplicatePairs: number;
  missingLinkPairs: number;
}
function eligible(alias: string): string {
  return `coalesce(${alias}.frontmatter->>'type','') NOT IN ('journal','inbox')`;
}
function aliases(alias: string): string {
  return `CASE WHEN jsonb_typeof(${alias}.frontmatter->'aliases')='array' THEN ${alias}.frontmatter->'aliases' ELSE '[]'::jsonb END`;
}
/** Journal notes are a historical record: they neither get nor give link suggestions. */
function outsideJournal(alias: string): string {
  return `${alias}.path NOT LIKE 'Journal/%'`;
}
function unlinked(a: string, b: string): string {
  return `NOT EXISTS (SELECT 1 FROM links l WHERE (l.src_document_id=${a}.id AND l.target_document_id=${b}.id)
    OR (l.src_document_id=${b}.id AND l.target_document_id=${a}.id))`;
}

export class IndexStore {
  private pool: pg.Pool;
  readonly collection: string;

  constructor(options: IndexStoreOptions) {
    const opts = [options.readOnly ? '-c default_transaction_read_only=on' : '', options.pgOptions]
      .filter(Boolean)
      .join(' ');
    this.pool = new Pool({
      connectionString: options.connectionString,
      max: 4,
      ...(opts ? { options: opts } : {}),
    });
    this.collection = options.collection;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  // ------------------------------------------------------------------
  // Schema and metadata
  // ------------------------------------------------------------------

  /**
   * Apply sql/001_schema.sql with the dimension substituted, then record or
   * verify the embedding model. Safe to call on every start.
   */
  async ensureSchema(embedModel: string, dim: number): Promise<void> {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // dist/index/store.js → ../../sql ; src/index/store.ts → ../../sql
    const sqlPath = path.resolve(here, '..', '..', 'sql', '001_schema.sql');
    const ddl = (await fs.readFile(sqlPath, 'utf-8')).replace(/__DIM__/g, String(dim));
    const learningDdl = (
      await fs.readFile(path.resolve(here, '..', '..', 'sql', '002_learning.sql'), 'utf-8')
    ).replace(/__DIM__/g, String(dim));
    const client = await this.pool.connect();
    try {
      await client.query(ddl);
      await client.query(learningDdl);
      await client.query(
        await fs.readFile(path.resolve(here, '..', '..', 'sql', '003_maintenance.sql'), 'utf-8')
      );
      await client.query(
        await fs.readFile(path.resolve(here, '..', '..', 'sql', '004_trails.sql'), 'utf-8')
      );
      const existing = await client.query<{ key: string; value: string }>(
        'SELECT key, value FROM meta WHERE key IN ($1, $2, $3)',
        ['embed_model', 'dim', 'schema_version']
      );
      const meta = Object.fromEntries(existing.rows.map(r => [r.key, r.value]));
      if (meta.embed_model && (meta.embed_model !== embedModel || meta.dim !== String(dim))) {
        throw new Error(
          `Index was built with model ${meta.embed_model} (dim ${meta.dim}); ` +
            `refusing to index with ${embedModel} (dim ${dim}). Run with --reindex to rebuild.`
        );
      }
      await client.query(
        `INSERT INTO meta (key, value) VALUES ('embed_model', $1), ('dim', $2), ('schema_version', $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [embedModel, String(dim), SCHEMA_VERSION]
      );
    } finally {
      client.release();
    }
  }

  /**
   * Drop every row for this collection and the recorded model, for `--reindex`.
   * The schema stays; if the dimension changed the caller recreates the
   * vector columns through `resetSchema()`.
   */
  async truncateCollection(): Promise<void> {
    await this.pool.query('DELETE FROM documents WHERE collection = $1', [this.collection]);
    await this.pool.query('DELETE FROM index_runs WHERE collection = $1', [this.collection]);
    const others = await this.pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM documents'
    );
    if (others.rows[0].n === '0') {
      await this.pool.query("DELETE FROM meta WHERE key IN ('embed_model', 'dim')");
    }
  }

  /**
   * Drop the index tables entirely (all collections). Used when the embedding
   * dimension changes, because a vector column's dimension is fixed.
   */
  async resetSchema(): Promise<void> {
    await this.pool.query('ALTER TABLE IF EXISTS search_log DROP COLUMN IF EXISTS query_embedding');
    await this.pool.query(
      'DROP TABLE IF EXISTS trails, note_heat, trails_runs, doc_history, links, chunks, documents, index_runs, meta CASCADE'
    );
  }

  async ensureMaintenanceSchema(): Promise<void> {
    const exists = await this.pool.query("SELECT to_regclass('documents') AS table_name");
    if (!exists.rows[0].table_name) throw new Error('index not built: run the indexer first');
    const here = path.dirname(fileURLToPath(import.meta.url));
    await this.pool.query(
      await fs.readFile(path.resolve(here, '..', '..', 'sql', '003_maintenance.sql'), 'utf-8')
    );
    await this.pool.query(
      await fs.readFile(path.resolve(here, '..', '..', 'sql', '004_trails.sql'), 'utf-8')
    );
  }

  async ensureTrailsSchema(): Promise<void> {
    await this.ensureMaintenanceSchema();
  }

  private trailsClient: pg.PoolClient | null = null;

  async trailsLock(): Promise<boolean> {
    if (this.trailsClient) return false;
    const client = await this.pool.connect();
    try {
      const r = await client.query(
        "SELECT pg_try_advisory_lock(hashtext('brain-trails:' || $1)) AS locked",
        [this.collection]
      );
      if (r.rows[0].locked) {
        this.trailsClient = client;
        return true;
      }
      client.release();
      return false;
    } catch (err) {
      client.release(err as Error);
      throw err;
    }
  }
  async trailsUnlock(): Promise<void> {
    const client = this.trailsClient;
    if (!client) return;
    this.trailsClient = null;
    try {
      await client.query("SELECT pg_advisory_unlock(hashtext('brain-trails:' || $1))", [
        this.collection,
      ]);
      client.release();
    } catch (err) {
      client.release(err as Error);
      throw err;
    }
  }
  async startTrailsRun(): Promise<number> {
    const r = await this.pool.query('INSERT INTO trails_runs(collection) VALUES($1) RETURNING id', [
      this.collection,
    ]);
    return Number(r.rows[0].id);
  }
  async finishTrailsRun(
    id: number,
    metrics: Record<string, unknown>,
    error: string | null
  ): Promise<void> {
    await this.pool.query(
      'UPDATE trails_runs SET finished_at=now(), metrics=$2, error_text=$3 WHERE id=$1 AND collection=$4',
      [id, metrics, error, this.collection]
    );
  }
  async rebuildTrailsAndHeat(opts: {
    now: Date;
    windowDays: number;
    halfLifeDays: number;
    tz: string;
    thresholds: number[];
    commit: boolean;
  }): Promise<{ edges: number; buckets: number[] }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const params = [this.collection, opts.now, opts.windowDays, opts.halfLifeDays, opts.tz];
      await client.query('DELETE FROM trails WHERE collection=$1', [this.collection]);
      await client.query(
        `INSERT INTO trails (collection, path_a, path_b, weight, events, last_at, computed_at)
WITH docs AS (
  SELECT path FROM documents WHERE collection = $1
),
raw AS (
  SELECT 'q:' || r.request_id::text || ':' || ((r.at AT TIME ZONE $5)::date)::text AS unit,
         coalesce(r.session_id, 'q:' || r.request_id::text) AS sk,
         1.0::float8 AS w, r.path, r.at
  FROM note_reads r
  WHERE r.collection = $1 AND r.request_id IS NOT NULL
    AND r.at >= $2::timestamptz - make_interval(days => $3)
  UNION ALL
  SELECT 's:' || r.session_id || ':' || ((r.at AT TIME ZONE $5)::date)::text,
         r.session_id, 0.5, r.path, r.at
  FROM note_reads r
  WHERE r.collection = $1 AND r.request_id IS NULL AND r.session_id IS NOT NULL
    AND r.at >= $2::timestamptz - make_interval(days => $3)
  UNION ALL
  SELECT 'f:' || f.id::text,
         coalesce(s.session_id, 'q:' || s.id::text),
         CASE f.source WHEN 'user' THEN 3.0 ELSE 2.0 END,
         CASE WHEN right(ltrim(p.path, '/'), 3) = '.md' THEN ltrim(p.path, '/') ELSE ltrim(p.path, '/') || '.md' END,
         f.at
  FROM search_feedback f
  JOIN search_log s ON s.id = f.search_id
  CROSS JOIN LATERAL unnest(f.used_paths) AS p(path)
  WHERE s.collection = $1 AND f.rating <> 'negative'
    AND f.at >= $2::timestamptz - make_interval(days => $3)
),
units AS (
  SELECT unit, sk, max(w) AS w, path, max(at) AS at
  FROM raw WHERE path IN (SELECT path FROM docs)
  GROUP BY unit, sk, path
),
pair_days AS (
  SELECT a.sk, (greatest(a.at, b.at) AT TIME ZONE $5)::date AS day,
         a.path AS path_a, b.path AS path_b,
         max(a.w) AS w, max(greatest(a.at, b.at)) AS at
  FROM units a JOIN units b ON a.unit = b.unit AND a.path < b.path
  GROUP BY 1, 2, 3, 4
)
SELECT $1, path_a, path_b,
       sum(w * power(0.5, extract(epoch FROM ($2::timestamptz - at)) / 86400.0 / $4))::real,
       count(*)::int, max(at), $2::timestamptz
FROM pair_days
GROUP BY path_a, path_b;`,
        params
      );
      await client.query('DELETE FROM note_heat WHERE collection=$1', [this.collection]);
      await client.query(
        `INSERT INTO note_heat (collection, path, score, bucket, computed_at)
WITH docs AS (SELECT path FROM documents WHERE collection = $1),
raw AS (
  SELECT coalesce(r.session_id, 'q:' || r.request_id::text, 'r:' || r.id::text) AS sk,
         1.0::float8 AS w, r.path, r.at
  FROM note_reads r
  WHERE r.collection = $1 AND r.at >= $2::timestamptz - make_interval(days => $3)
  UNION ALL
  SELECT coalesce(s.session_id, 'q:' || s.id::text),
         CASE f.source WHEN 'user' THEN 3.0 ELSE 2.0 END,
         CASE WHEN right(ltrim(p.path, '/'), 3) = '.md' THEN ltrim(p.path, '/') ELSE ltrim(p.path, '/') || '.md' END,
         f.at
  FROM search_feedback f
  JOIN search_log s ON s.id = f.search_id
  CROSS JOIN LATERAL unnest(f.used_paths) AS p(path)
  WHERE s.collection = $1 AND f.rating <> 'negative'
    AND f.at >= $2::timestamptz - make_interval(days => $3)
),
days AS (
  SELECT path, sk, (at AT TIME ZONE $5)::date AS day, max(w) AS w, max(at) AS at
  FROM raw WHERE path IN (SELECT path FROM docs)
  GROUP BY 1, 2, 3
),
scores AS (
  SELECT path, sum(w * power(0.5, extract(epoch FROM ($2::timestamptz - at)) / 86400.0 / $4)) AS score
  FROM days GROUP BY path
)
SELECT $1, path, score::real, width_bucket(score, $6::float8[])::smallint, $2::timestamptz
FROM scores;`,
        [...params, opts.thresholds]
      );
      const edges = Number(
        (await client.query('SELECT count(*) FROM trails WHERE collection=$1', [this.collection]))
          .rows[0].count
      );
      const rows = (
        await client.query(
          'SELECT bucket, count(*)::int AS n FROM note_heat WHERE collection=$1 GROUP BY bucket',
          [this.collection]
        )
      ).rows;
      const buckets = Array<number>(6).fill(0);
      for (const row of rows) buckets[row.bucket] = row.n;
      await client.query(opts.commit ? 'COMMIT' : 'ROLLBACK');
      client.release();
      return { edges, buckets };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } finally {
        client.release(err as Error);
      }
      throw err;
    }
  }
  async heatCandidates(
    types: string[],
    clear: boolean
  ): Promise<{ path: string; bucket: number }[]> {
    return (
      await this.pool.query(
        `SELECT d.path, coalesce(h.bucket,0)::int AS bucket FROM documents d
      LEFT JOIN note_heat h ON h.collection=d.collection AND h.path=d.path
      WHERE d.collection=$1 AND ($3::boolean OR d.frontmatter->>'type'=ANY($2)) ORDER BY d.path`,
        [this.collection, types, clear]
      )
    ).rows;
  }
  async trailEdges(minWeight: number): Promise<{ pathA: string; pathB: string; weight: number }[]> {
    return (
      await this.pool.query(
        'SELECT path_a AS "pathA", path_b AS "pathB", weight FROM trails WHERE collection=$1 AND weight >= $2 ORDER BY path_a, path_b',
        [this.collection, minWeight]
      )
    ).rows;
  }
  async heatScores(): Promise<{ path: string; score: number }[]> {
    return (
      await this.pool.query('SELECT path, score FROM note_heat WHERE collection=$1', [
        this.collection,
      ])
    ).rows;
  }

  async recordDocHistory(client: pg.PoolClient, documentId: number): Promise<void> {
    await client.query(
      `INSERT INTO doc_history (document_id, content_sha256, summary, summary_body_cosine)
      SELECT d.id, d.content_sha256, d.frontmatter->>'summary',
        (SELECT 1 - (c0.embedding <=> b.v)
         FROM chunks c0, (SELECT avg(embedding) AS v FROM chunks WHERE document_id = d.id AND ord > 0) b
         WHERE c0.document_id = d.id AND c0.ord = 0 AND b.v IS NOT NULL)
      FROM documents d WHERE d.id = $1 AND d.collection = $2`,
      [documentId, this.collection]
    );
  }

  async backfillDocHistory(): Promise<number> {
    const result = await this.pool.query(
      `INSERT INTO doc_history (document_id, content_sha256, summary, summary_body_cosine)
      SELECT d.id, d.content_sha256, d.frontmatter->>'summary',
        (SELECT 1 - (c0.embedding <=> b.v)
         FROM chunks c0, (SELECT avg(embedding) AS v FROM chunks WHERE document_id = d.id AND ord > 0) b
         WHERE c0.document_id = d.id AND c0.ord = 0 AND b.v IS NOT NULL)
      FROM documents d WHERE d.collection = $1 AND NOT EXISTS (SELECT 1 FROM doc_history h WHERE h.document_id = d.id)`,
      [this.collection]
    );
    return result.rowCount ?? 0;
  }

  private candidates(
    cls: string,
    rows: { paths: string[]; detail: Record<string, unknown> }[]
  ): Candidate[] {
    return rows.map(row => {
      const paths = ['link-related', 'merge-duplicate', 'link-coread'].includes(cls)
        ? [...row.paths].sort()
        : row.paths;
      return { key: `${cls}:${paths.join('|')}`, paths, detail: row.detail };
    });
  }

  async findMissingLinks(minCosine: number): Promise<Candidate[]> {
    const result = await this.pool.query(
      `SELECT ARRAY[a.path,b.path] AS paths,
      jsonb_build_object('cosine', round((1-(a.centroid <=> b.centroid))::numeric,4)) AS detail
      FROM documents a JOIN documents b ON a.id < b.id AND b.collection = a.collection
      WHERE a.collection = $1 AND ${eligible('a')} AND ${eligible('b')}
        AND ${outsideJournal('a')} AND ${outsideJournal('b')}
        AND 1-(a.centroid <=> b.centroid) > $2 AND ${unlinked('a', 'b')}
      ORDER BY 1-(a.centroid <=> b.centroid) DESC, a.path, b.path`,
      [this.collection, minCosine]
    );
    return this.candidates('link-related', result.rows);
  }

  /**
   * Notes whose prose names another note (its title or an alias) without linking to it. The
   * full-text index narrows the pairs; `mentionedName` then checks the source's prose, which
   * the chunks cannot give exactly (they repeat the title in every breadcrumb), and returns the
   * first of the names, longest first, that it really contains.
   */
  async findCoReadPairs(minWeight: number, minEvents: number): Promise<Candidate[]> {
    const sql = `
    SELECT ARRAY[t.path_a, t.path_b] AS paths,
           jsonb_build_object('weight', round(t.weight::numeric, 1), 'events', t.events, 'lastAt', t.last_at) AS detail
    FROM trails t
    JOIN documents a ON a.collection = t.collection AND a.path = t.path_a
    JOIN documents b ON b.collection = t.collection AND b.path = t.path_b
    WHERE t.collection = $1 AND t.weight >= $2 AND t.events >= $3
      AND ${eligible('a')} AND ${eligible('b')}
      AND ${outsideJournal('a')} AND ${outsideJournal('b')}
      AND ${unlinked('a', 'b')}
    ORDER BY t.weight DESC, t.path_a, t.path_b`;
    const rows = (await this.pool.query(sql, [this.collection, minWeight, minEvents])).rows;
    return this.candidates('link-coread', rows);
  }

  async findUnlinkedMentions(
    mentionedName: (source: string, names: string[]) => Promise<string | null>
  ): Promise<Candidate[]> {
    const result = await this.pool.query(
      `WITH names AS (
      SELECT d.id, d.title AS name FROM documents d WHERE d.collection=$1
      UNION SELECT d.id, a.value #>> '{}' FROM documents d,
        LATERAL jsonb_array_elements(${aliases('d')}) a(value)
        WHERE d.collection=$1 AND jsonb_typeof(a.value)='string'
    ) SELECT src.path AS source, dst.path AS target,
        array_agg(n.name ORDER BY length(n.name) DESC, n.name) AS names,
        coalesce(1-(src.centroid <=> dst.centroid),0) AS cosine
      FROM names n JOIN documents dst ON dst.id=n.id
      JOIN documents src ON src.collection=dst.collection AND src.id<>dst.id
      WHERE dst.collection=$1 AND ${eligible('dst')} AND length(n.name)>=4
        AND ${outsideJournal('src')} AND ${outsideJournal('dst')}
        AND EXISTS (SELECT 1 FROM chunks c WHERE c.document_id=src.id AND c.ord>0
          AND c.tsv @@ phraseto_tsquery('english',n.name)) AND ${unlinked('src', 'dst')}
      GROUP BY src.id, dst.id
      ORDER BY cosine DESC, source, target`,
      [this.collection]
    );
    const rows = [];
    for (const row of result.rows) {
      const name = await mentionedName(row.source, row.names);
      if (name)
        rows.push({
          paths: [row.source, row.target],
          detail: { name, cosine: Number(Number(row.cosine).toFixed(4)) },
        });
    }
    return this.candidates('link-mention', rows);
  }

  async findLinkRepairs(): Promise<Candidate[]> {
    const result = await this.pool.query(
      `WITH matches AS (
      SELECT src.path AS source,l.target_path,dst.path AS target,dst.frontmatter,
        count(*) OVER (PARTITION BY src.id,l.target_path) AS matches
      FROM links l JOIN documents src ON src.id=l.src_document_id
      JOIN documents dst ON dst.collection=src.collection AND (
        lower(dst.title)=lower(regexp_replace(regexp_replace(l.target_path,'^.*/',''),'\\.md$','','i'))
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(${aliases('dst')}) a(value)
          WHERE jsonb_typeof(a.value)='string' AND lower(a.value #>> '{}')=
            lower(regexp_replace(regexp_replace(l.target_path,'^.*/',''),'\\.md$','','i'))))
      WHERE src.collection=$1 AND l.target_document_id IS NULL
    ) SELECT DISTINCT ARRAY[source,target] AS paths,jsonb_build_object('target',target_path) AS detail
      FROM matches WHERE matches=1 AND coalesce(frontmatter->>'type','') NOT IN ('journal','inbox')
      ORDER BY paths`,
      [this.collection]
    );
    return this.candidates('link-repair', result.rows);
  }

  async findMissingFrontmatter(): Promise<Candidate[]> {
    const result = await this.pool.query(
      `SELECT ARRAY[d.path] AS paths,
      jsonb_build_object('fields',ARRAY(SELECT f FROM unnest(ARRAY['aliases','index']) f
        WHERE NOT (d.frontmatter ? f) ORDER BY f)) AS detail
      FROM documents d WHERE d.collection=$1 AND ${eligible('d')}
        AND (NOT (d.frontmatter ? 'index') OR NOT (d.frontmatter ? 'aliases')) ORDER BY d.path`,
      [this.collection]
    );
    return this.candidates('fm-missing', result.rows);
  }

  async findStaleSummaries(minDrop: number): Promise<Candidate[]> {
    const result = await this.pool.query(
      `WITH history AS (
      SELECT d.path,h.*,row_number() OVER w AS rn,first_value(h.summary) OVER w AS current_summary
      FROM documents d JOIN doc_history h ON h.document_id=d.id
      WHERE d.collection=$1 AND ${eligible('d')}
      WINDOW w AS (PARTITION BY d.id ORDER BY h.at DESC,h.id DESC)
    ), bounds AS (
      SELECT document_id, min(rn) FILTER (WHERE summary IS DISTINCT FROM current_summary) AS stop
      FROM history GROUP BY document_id
    ), current_run AS (
      SELECT h.* FROM history h JOIN bounds b USING(document_id) WHERE b.stop IS NULL OR h.rn<b.stop
    ), bases AS (
      SELECT DISTINCT ON (document_id) * FROM current_run ORDER BY document_id,rn DESC
    ) SELECT ARRAY[c.path] AS paths,
      jsonb_build_object('baseCosine',b.summary_body_cosine,'currentCosine',c.summary_body_cosine,'summarySince',b.at) AS detail
      FROM current_run c JOIN bases b USING(document_id) WHERE c.rn=1 AND b.rn>=2
        AND c.summary_body_cosine < b.summary_body_cosine-$2
      ORDER BY b.summary_body_cosine-c.summary_body_cosine DESC,c.path`,
      [this.collection, minDrop]
    );
    return this.candidates('summary-refresh', result.rows);
  }

  async findNearDuplicates(minCosine: number, minTitleSim: number): Promise<Candidate[]> {
    const result = await this.pool.query(
      `SELECT ARRAY[a.path,b.path] AS paths,
      jsonb_build_object('cosine',round((1-(a.centroid <=> b.centroid))::numeric,4),
        'titleSimilarity',round(similarity(lower(a.title),lower(b.title))::numeric,4)) AS detail
      FROM documents a JOIN documents b ON a.id<b.id AND b.collection=a.collection
      WHERE a.collection=$1 AND ${eligible('a')} AND ${eligible('b')}
        AND (1-(a.centroid <=> b.centroid)>$2 OR similarity(lower(a.title),lower(b.title))>$3)
        AND ${unlinked('a', 'b')}
        AND NOT (a.frontmatter->>'type' = 'plan' AND b.frontmatter->>'type' = 'plan')
      ORDER BY greatest(1-(a.centroid <=> b.centroid),similarity(lower(a.title),lower(b.title))) DESC,a.path,b.path`,
      [this.collection, minCosine, minTitleSim]
    );
    return this.candidates('merge-duplicate', result.rows);
  }

  async findStaleHubs(days: number): Promise<Candidate[]> {
    const result = await this.pool.query(
      `WITH dated AS (
      SELECT d.*, CASE WHEN d.frontmatter->>'updated' ~ '^\\d{4}-\\d{2}-\\d{2}'
        AND pg_input_is_valid(d.frontmatter->>'updated','timestamp with time zone')
        THEN (d.frontmatter->>'updated')::timestamptz END AS updated
      FROM documents d WHERE d.collection=$1
    ), hubs AS (
      SELECT DISTINCT ON (h.id) h.path,h.updated,n.path AS newest,n.updated AS newest_updated
      FROM dated h JOIN dated n ON h.id<>n.id AND ${eligible('n')}
        AND EXISTS (SELECT 1 FROM links l WHERE (l.src_document_id=h.id AND l.target_document_id=n.id)
          OR (l.src_document_id=n.id AND l.target_document_id=h.id))
      WHERE h.frontmatter->>'type' IN ('project','area') AND h.updated IS NOT NULL AND n.updated IS NOT NULL
      ORDER BY h.id,n.updated DESC,n.path
    ) SELECT ARRAY[path] AS paths,jsonb_build_object('hubUpdated',updated,'newestLinked',newest,
      'newestUpdated',newest_updated,'days',floor(extract(epoch FROM newest_updated-updated)/86400)) AS detail
      FROM hubs WHERE newest_updated>updated+make_interval(days=>$2)
      ORDER BY newest_updated-updated DESC,path`,
      [this.collection, days]
    );
    return this.candidates('hub-review', result.rows);
  }

  async hygieneMetrics(): Promise<Hygiene> {
    const result = await this.pool.query(
      `SELECT count(*)::int AS documents,
      count(*) FILTER (WHERE d.frontmatter_error IS NOT NULL)::int AS "invalidFrontmatter",
      count(*) FILTER (WHERE ${eligible('d')} AND NOT EXISTS (SELECT 1 FROM links l
        WHERE l.target_document_id=d.id AND l.src_document_id<>d.id))::int AS orphans,
      (SELECT count(*)::int FROM links l JOIN documents src ON src.id=l.src_document_id
        WHERE src.collection=$1 AND l.target_document_id IS NULL) AS "unresolvedLinks"
      FROM documents d WHERE d.collection=$1`,
      [this.collection]
    );
    return {
      ...result.rows[0],
      nearDuplicatePairs: (await this.findNearDuplicates(0.92, 0.6)).length,
      missingLinkPairs: (await this.findMissingLinks(0.85)).length,
    };
  }

  private maintenanceClient: pg.PoolClient | null = null;

  async maintenanceLock(): Promise<boolean> {
    if (this.maintenanceClient) return false;
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        "SELECT pg_try_advisory_lock(hashtext('brain-maintain:' || $1)) AS locked",
        [this.collection]
      );
      if (result.rows[0].locked) {
        this.maintenanceClient = client;
        return true;
      }
      client.release();
      return false;
    } catch (err) {
      client.release(err as Error);
      throw err;
    }
  }

  async maintenanceUnlock(): Promise<void> {
    const client = this.maintenanceClient;
    if (!client) return;
    this.maintenanceClient = null;
    try {
      await client.query("SELECT pg_advisory_unlock(hashtext('brain-maintain:' || $1))", [
        this.collection,
      ]);
      client.release();
    } catch (err) {
      client.release(err as Error);
      throw err;
    }
  }

  async startMaintenanceRun(): Promise<number> {
    const result = await this.pool.query(
      'INSERT INTO maintenance_runs(collection) VALUES($1) RETURNING id',
      [this.collection]
    );
    return Number(result.rows[0].id);
  }

  async finishMaintenanceRun(
    id: number,
    r: {
      reportId: string | null;
      reportPath: string | null;
      metrics: Record<string, unknown>;
      error: string | null;
    }
  ): Promise<void> {
    await this.pool.query(
      `UPDATE maintenance_runs SET finished_at=now(),report_id=$2,report_path=$3,
      metrics=$4::jsonb,error_text=$5 WHERE id=$1 AND collection=$6`,
      [id, r.reportId, r.reportPath, JSON.stringify(r.metrics), r.error, this.collection]
    );
  }

  async previousRun(
    beforeRunId: number
  ): Promise<{ startedAt: Date; metrics: Record<string, unknown> } | null> {
    const result = await this.pool.query(
      `SELECT started_at AS "startedAt",metrics FROM maintenance_runs
      WHERE collection=$1 AND id<$2 AND finished_at IS NOT NULL AND error_text IS NULL ORDER BY id DESC LIMIT 1`,
      [this.collection, beforeRunId]
    );
    return result.rows[0] ?? null;
  }

  async upsertChangeClasses(classes: { class: string; graduable: boolean }[]): Promise<void> {
    for (const c of classes)
      await this.pool.query(
        `INSERT INTO change_classes(collection,class,graduable) VALUES($1,$2,$3)
      ON CONFLICT(collection,class) DO UPDATE SET graduable=EXCLUDED.graduable`,
        [this.collection, c.class, c.graduable]
      );
  }

  async refreshClassCounts(): Promise<void> {
    await this.pool.query(
      `UPDATE change_classes c SET decided=s.decided,accepted=s.accepted,updated_at=now()
      FROM (SELECT c.class,count(f.id) FILTER (WHERE f.status IN ('accepted','rejected'))::int AS decided,
        count(f.id) FILTER (WHERE f.status='accepted')::int AS accepted
        FROM change_classes c LEFT JOIN maintenance_findings f ON f.class=c.class AND f.collection=c.collection
        WHERE c.collection=$1 GROUP BY c.class) s WHERE c.collection=$1 AND c.class=s.class`,
      [this.collection]
    );
  }

  async upsertFindings(
    runId: number,
    reportId: string,
    cls: string,
    candidates: Candidate[],
    maxNew: number
  ): Promise<{ inserted: number; updated: number }> {
    let inserted = 0,
      updated = 0;
    for (const c of candidates) {
      const existing = await this.pool.query(
        'SELECT id FROM maintenance_findings WHERE collection=$1 AND finding_key=$2',
        [this.collection, c.key]
      );
      if (existing.rowCount) {
        const result = await this.pool.query(
          `UPDATE maintenance_findings SET status='open',detail=$3::jsonb,paths=$4::text[],
          last_seen_run=$5,last_reported_in=$6 WHERE collection=$1 AND finding_key=$2 AND status IN ('open','resolved')`,
          [this.collection, c.key, JSON.stringify(c.detail), c.paths, runId, reportId]
        );
        updated += result.rowCount ?? 0;
      } else if (inserted < maxNew) {
        const result = await this.pool.query(
          `INSERT INTO maintenance_findings(collection,class,finding_key,paths,detail,
          first_reported_in,last_reported_in,last_seen_run) VALUES($1,$2,$3,$4::text[],$5::jsonb,$6,$6,$7)
          ON CONFLICT(collection,finding_key) DO NOTHING`,
          [this.collection, cls, c.key, c.paths, JSON.stringify(c.detail), reportId, runId]
        );
        inserted += result.rowCount ?? 0;
      }
    }
    return { inserted, updated };
  }

  async resolveUnseenFindings(runId: number, classes: string[]): Promise<number> {
    const result = await this.pool.query(
      `UPDATE maintenance_findings SET status='resolved' WHERE collection=$1
      AND status='open' AND class=ANY($2::text[]) AND last_seen_run IS DISTINCT FROM $3`,
      [this.collection, classes, runId]
    );
    return result.rowCount ?? 0;
  }

  private findingColumns =
    'id,class,paths,detail,status,decided_via AS "decidedVia",decided_at AS "decidedAt"';
  private findingRows(rows: FindingRow[]): FindingRow[] {
    return rows.map(r => ({ ...r, id: Number(r.id) }));
  }

  async openFindings(limit: number): Promise<FindingRow[]> {
    const result = await this.pool.query(
      `SELECT ${this.findingColumns} FROM maintenance_findings WHERE collection=$1 AND status='open'
      ORDER BY array_position(ARRAY['link-related','link-mention','link-repair','fm-missing','summary-refresh','merge-duplicate','hub-review','link-coread'],class),id LIMIT $2`,
      [this.collection, limit]
    );
    return this.findingRows(result.rows);
  }

  async findingsDecidedSince(at: Date): Promise<FindingRow[]> {
    const result = await this.pool.query(
      `SELECT ${this.findingColumns} FROM maintenance_findings WHERE collection=$1
      AND status IN ('accepted','rejected') AND decided_at>=$2 ORDER BY decided_at,id`,
      [this.collection, at]
    );
    return this.findingRows(result.rows);
  }

  async decideFinding(
    id: number,
    decision: 'accepted' | 'rejected',
    via: 'checkbox' | 'tool',
    note: string | null,
    onlyIfOpen: boolean
  ): Promise<FindingRow | null> {
    const result = await this.pool.query(
      `UPDATE maintenance_findings SET status=$2,decided_via=$3,decided_at=now(),decision_note=$4
      WHERE id=$1 AND collection=$5 ${onlyIfOpen ? "AND status='open'" : ''} RETURNING ${this.findingColumns}`,
      [id, decision, via, note, this.collection]
    );
    return this.findingRows(result.rows)[0] ?? null;
  }

  async maintenanceFindingCounts(): Promise<{
    findings: Record<string, number>;
    openClasses: number;
  }> {
    const result = await this.pool.query(
      `SELECT status,count(*)::int AS n,count(DISTINCT class)::int AS classes
      FROM maintenance_findings WHERE collection=$1 GROUP BY status`,
      [this.collection]
    );
    const findings: Record<string, number> = { open: 0, accepted: 0, rejected: 0, resolved: 0 };
    let openClasses = 0;
    for (const r of result.rows) {
      findings[r.status] = r.n;
      if (r.status === 'open') openClasses = r.classes;
    }
    return { findings, openClasses };
  }

  async maintenanceClassCounts(): Promise<{ class: string; decided: number; accepted: number }[]> {
    const result = await this.pool.query(
      `SELECT class,decided,accepted FROM change_classes WHERE collection=$1
      ORDER BY array_position(ARRAY['link-related','link-mention','link-repair','fm-missing','summary-refresh','merge-duplicate','hub-review','link-coread'],class)`,
      [this.collection]
    );
    return result.rows;
  }

  async missingPaths(paths: string[]): Promise<string[]> {
    const result = await this.pool.query(
      'SELECT path FROM documents WHERE collection=$1 AND path=ANY($2::text[])',
      [this.collection, paths]
    );
    const known = new Set(result.rows.map(r => r.path));
    return paths.filter(p => !known.has(p));
  }

  async recommendNotes(
    input: RecommendInput
  ): Promise<{ path: string; title: string; score: number }[]> {
    const params: unknown[] = [this.collection, input.positive, input.negative, input.k];
    const filter = this.filterSql(input, params);
    const cte = `WITH p AS (SELECT centroid FROM documents WHERE collection=$1 AND path=ANY($2::text[])),
      n AS (SELECT centroid FROM documents WHERE collection=$1 AND path=ANY($3::text[]))`;
    let sql: string;
    if (input.strategy === 'average_vector') {
      sql = `${cte},q AS (SELECT coalesce((SELECT avg(centroid) FROM p)+(SELECT avg(centroid) FROM p)-(SELECT avg(centroid) FROM n),
        (SELECT avg(centroid) FROM p)) AS v)
        SELECT d.path,d.title,1-(d.centroid <=> q.v) AS score FROM documents d,q
        WHERE d.collection=$1 AND d.centroid IS NOT NULL AND q.v IS NOT NULL AND NOT(d.path=ANY($2::text[] || $3::text[])) ${filter}
        ORDER BY score DESC,d.path LIMIT $4`;
    } else {
      sql = `${cte},scores AS (SELECT d.path,d.title,
        (SELECT max(1-(d.centroid <=> p.centroid)) FROM p) AS best_pos,
        (SELECT max(1-(d.centroid <=> n.centroid)) FROM n) AS best_neg
        FROM documents d WHERE d.collection=$1 AND d.centroid IS NOT NULL
          AND NOT(d.path=ANY($2::text[] || $3::text[])) ${filter})
        SELECT path,title,CASE WHEN best_pos>coalesce(best_neg,-1) THEN best_pos ELSE -best_neg END AS score
        FROM scores ORDER BY score DESC NULLS LAST,path LIMIT $4`;
    }
    const result = await this.pool.query(sql, params);
    return result.rows.map(r => ({ ...r, score: Number(Number(r.score).toFixed(4)) }));
  }

  async getMeta(): Promise<Record<string, string>> {
    const res = await this.pool.query<{ key: string; value: string }>(
      'SELECT key, value FROM meta'
    );
    return Object.fromEntries(res.rows.map(r => [r.key, r.value]));
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.pool.query(
      'INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [key, value]
    );
  }

  async insertSearchLog(row: {
    id: string;
    sessionId: string | null;
    clientName: string | null;
    tool: string;
    query: string | null;
    redacted: boolean;
    embedding: number[] | null;
    params: Record<string, unknown>;
    ranker: string;
    results: unknown[];
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO search_log
       (id, collection, session_id, client_name, tool, query, redacted, query_embedding, params, ranker, results)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::vector, $9::jsonb, $10, $11::jsonb)`,
      [
        row.id,
        this.collection,
        row.sessionId,
        row.clientName,
        row.tool,
        row.query,
        row.redacted,
        row.embedding === null ? null : toSqlVector(row.embedding),
        JSON.stringify(row.params),
        row.ranker,
        JSON.stringify(row.results),
      ]
    );
  }

  async insertNoteReads(
    rows: {
      sessionId: string | null;
      clientName: string | null;
      tool: string;
      path: string;
      requestId: string | null;
    }[]
  ): Promise<void> {
    const values: unknown[] = [this.collection];
    const tuples = rows.map(row => {
      const start = values.length + 1;
      const requestId =
        row.requestId &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.requestId)
          ? row.requestId
          : null;
      values.push(row.sessionId, row.clientName, row.tool, row.path, requestId);
      return `($1, $${start}, $${start + 1}, $${start + 2}, $${start + 3},
        (SELECT id FROM search_log WHERE id = $${start + 4}::uuid AND collection = $1))`;
    });
    await this.pool.query(
      `INSERT INTO note_reads (collection, session_id, client_name, tool, path, request_id)
       VALUES ${tuples.join(', ')}`,
      values
    );
  }

  async insertFeedback(row: {
    searchId: string;
    source: 'user' | 'agent';
    rating: 'positive' | 'negative' | 'neutral';
    usedPaths: string[];
    expectedPaths: string[];
    note: string | null;
    redacted: boolean;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO search_feedback (search_id, source, rating, used_paths, expected_paths, note, redacted)
       SELECT id, $3, $4, $5::text[], $6::text[], $7, $8
       FROM search_log WHERE id = $2::uuid AND collection = $1`,
      [
        this.collection,
        row.searchId,
        row.source,
        row.rating,
        row.usedPaths,
        row.expectedPaths,
        row.note,
        row.redacted,
      ]
    );
  }

  async searchLogExists(id: string): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT 1 FROM search_log WHERE id = $2::uuid AND collection = $1',
      [this.collection, id]
    );
    return result.rows.length > 0;
  }

  async upsertSession(row: {
    sessionId: string;
    transport: SessionTransport;
    clientName: string | null;
    clientVersion: string | null;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO mcp_sessions (session_id, collection, transport, client_name, client_version)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (session_id) DO UPDATE SET client_name = EXCLUDED.client_name, client_version = EXCLUDED.client_version`,
      [row.sessionId, this.collection, row.transport, row.clientName, row.clientVersion]
    );
  }

  /** The recorded session's client name: undefined when no such session, null when it sent none. */
  async sessionClient(sessionId: string): Promise<string | null | undefined> {
    const result = await this.pool.query<{ client_name: string | null }>(
      'SELECT client_name FROM mcp_sessions WHERE session_id = $1 AND collection = $2',
      [sessionId, this.collection]
    );
    return result.rows.length ? result.rows[0].client_name : undefined;
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.pool.query(
      'UPDATE mcp_sessions SET closed_at = now() WHERE session_id = $1 AND closed_at IS NULL',
      [sessionId]
    );
  }

  async applyRetention(days: number): Promise<{ queries: number; notes: number }> {
    const client = await this.pool.connect();
    let releaseErr: Error | undefined;
    try {
      await client.query('BEGIN');
      const queries = await client.query(
        `UPDATE search_log SET query = NULL, query_embedding = NULL
         WHERE collection = $1 AND at < now() - make_interval(days => $2)
           AND (query IS NOT NULL OR query_embedding IS NOT NULL)`,
        [this.collection, days]
      );
      const notes = await client.query(
        `UPDATE search_feedback f SET note = NULL FROM search_log s
         WHERE f.search_id = s.id AND s.collection = $1
           AND f.at < now() - make_interval(days => $2) AND f.note IS NOT NULL`,
        [this.collection, days]
      );
      await client.query('COMMIT');
      return { queries: queries.rowCount ?? 0, notes: notes.rowCount ?? 0 };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        releaseErr = rollbackErr as Error;
      }
      throw err;
    } finally {
      if (releaseErr) client.release(releaseErr);
      else client.release();
    }
  }

  async learnReportSessions(days: number) {
    const totals = await this.pool.query<{ total: string; median: number | null }>(
      `SELECT count(*) AS total,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (closed_at - connected_at)) / 60)
         FILTER (WHERE closed_at IS NOT NULL) AS median
       FROM mcp_sessions WHERE collection = $1 AND connected_at >= now() - make_interval(days => $2)`,
      [this.collection, days]
    );
    const clients = await this.pool.query<{ client: string; n: string }>(
      `SELECT coalesce(client_name, '(none)') AS client, count(*) AS n FROM mcp_sessions
       WHERE collection = $1 AND connected_at >= now() - make_interval(days => $2)
       GROUP BY 1 ORDER BY 1`,
      [this.collection, days]
    );
    return { ...totals.rows[0], clients: clients.rows };
  }

  async learnReportSearches(days: number) {
    const result = await this.pool.query<{ tool: string; n: string; redacted: string }>(
      `SELECT tool, count(*) AS n, count(*) FILTER (WHERE redacted) AS redacted FROM search_log
       WHERE collection = $1 AND at >= now() - make_interval(days => $2) GROUP BY tool`,
      [this.collection, days]
    );
    return result.rows;
  }

  async learnReportLinks(days: number) {
    const result = await this.pool.query<{
      semantic: string;
      linked: string;
      reads: string;
      at1: string;
      at3: string;
      at8: string;
      misses: string;
    }>(
      `WITH searches AS (
         SELECT id, results FROM search_log WHERE collection = $1 AND tool = 'semantic-search'
           AND at >= now() - make_interval(days => $2)
       ), reads AS (
         SELECT r.request_id, (SELECT min((hit->>'rank')::int)
           FROM jsonb_array_elements(s.results) hit WHERE hit->>'path' = r.path) AS rank
         FROM note_reads r JOIN searches s ON s.id = r.request_id
         WHERE r.collection = $1 AND r.at >= now() - make_interval(days => $2)
       ) SELECT (SELECT count(*) FROM searches) AS semantic,
         count(DISTINCT request_id) AS linked, count(*) AS reads,
         count(*) FILTER (WHERE rank <= 1) AS at1, count(*) FILTER (WHERE rank <= 3) AS at3,
         count(*) FILTER (WHERE rank <= 8) AS at8, count(*) FILTER (WHERE rank IS NULL) AS misses
       FROM reads`,
      [this.collection, days]
    );
    return result.rows[0];
  }

  async learnReportBehaviour(days: number) {
    const result = await this.pool.query<{
      total: string;
      reformulations: string;
      fallbacks: string;
    }>(
      `WITH searches AS (
         SELECT id, at, session_id, tool FROM search_log
         WHERE collection = $1 AND at >= now() - make_interval(days => $2)
       ) SELECT count(*) AS total,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM searches next
           WHERE next.session_id = s.session_id AND next.tool = 'semantic-search'
             AND next.at > s.at AND next.at <= s.at + interval '120 seconds')) AS reformulations,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM searches next
           WHERE next.session_id = s.session_id AND next.tool = 'search-vault'
             AND next.at > s.at AND next.at <= s.at + interval '120 seconds')) AS fallbacks
       FROM searches s WHERE s.tool = 'semantic-search' AND s.session_id IS NOT NULL`,
      [this.collection, days]
    );
    return result.rows[0];
  }

  async learnReportFeedback(days: number) {
    const result = await this.pool.query<{
      total: string;
      agent: string;
      user: string;
      negative: string;
      negative_user: string;
      covered: string;
    }>(
      `SELECT count(*) AS total, count(*) FILTER (WHERE f.source = 'agent') AS agent,
         count(*) FILTER (WHERE f.source = 'user') AS "user",
         count(*) FILTER (WHERE f.rating = 'negative') AS negative,
         count(*) FILTER (WHERE f.rating = 'negative' AND f.source = 'user') AS negative_user,
         count(DISTINCT s.id) FILTER (WHERE s.tool = 'semantic-search') AS covered
       FROM search_feedback f JOIN search_log s ON s.id = f.search_id
       WHERE s.collection = $1 AND s.at >= now() - make_interval(days => $2)
         AND f.at >= now() - make_interval(days => $2)`,
      [this.collection, days]
    );
    return result.rows[0];
  }

  // ------------------------------------------------------------------
  // Documents
  // ------------------------------------------------------------------

  async listDocuments(): Promise<Map<string, DocumentRecord>> {
    const res = await this.pool.query<{
      id: number;
      path: string;
      content_sha256: string;
      mtime: Date;
      size: string;
    }>('SELECT id, path, content_sha256, mtime, size FROM documents WHERE collection = $1', [
      this.collection,
    ]);
    const map = new Map<string, DocumentRecord>();
    for (const r of res.rows) {
      map.set(r.path, {
        id: Number(r.id),
        path: r.path,
        contentSha256: r.content_sha256,
        mtime: r.mtime,
        size: Number(r.size),
      });
    }
    return map;
  }

  /**
   * Insert or replace a document and all of its chunks and links in one
   * transaction. The centroid is the mean of the chunk embeddings.
   */
  async upsertDocument(input: UpsertDocumentInput): Promise<number> {
    if (input.chunks.length !== input.embeddings.length) {
      throw new Error('chunks and embeddings length mismatch');
    }
    const dim = input.embeddings[0]?.length ?? 0;
    const centroid = new Array<number>(dim).fill(0);
    for (const e of input.embeddings) for (let i = 0; i < dim; i++) centroid[i] += e[i];
    for (let i = 0; i < dim; i++) centroid[i] /= input.embeddings.length || 1;

    const client = await this.pool.connect();
    let releaseErr: Error | undefined;
    try {
      await client.query('BEGIN');
      const doc = await client.query<{ id: number }>(
        `INSERT INTO documents (collection, path, title, frontmatter, tags, content_sha256, mtime, size, centroid, frontmatter_error, indexed_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9::vector, $10, now())
         ON CONFLICT (collection, path) DO UPDATE SET
           title = EXCLUDED.title, frontmatter = EXCLUDED.frontmatter, tags = EXCLUDED.tags,
           content_sha256 = EXCLUDED.content_sha256, mtime = EXCLUDED.mtime, size = EXCLUDED.size,
           centroid = EXCLUDED.centroid, frontmatter_error = EXCLUDED.frontmatter_error, indexed_at = now()
         RETURNING id`,
        [
          this.collection,
          input.path,
          input.title,
          JSON.stringify(input.frontmatter ?? {}),
          input.tags,
          input.contentSha256,
          input.mtime,
          input.size,
          dim ? toSqlVector(centroid) : null,
          input.frontmatterError ?? null,
        ]
      );
      const id = Number(doc.rows[0].id);
      await client.query('DELETE FROM chunks WHERE document_id = $1', [id]);
      for (let i = 0; i < input.chunks.length; i++) {
        const c = input.chunks[i];
        await client.query(
          `INSERT INTO chunks (document_id, ord, heading_path, content, content_sha256, tokens, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7::vector)`,
          [
            id,
            c.ord,
            c.headingPath,
            c.content,
            sha256(c.content),
            c.tokens,
            toSqlVector(input.embeddings[i]),
          ]
        );
      }
      await this.recordDocHistory(client, id);
      await client.query('DELETE FROM links WHERE src_document_id = $1', [id]);
      for (const target of input.links) {
        // Resolve the way Obsidian does for "shortest path" links: an exact
        // vault path first, else a unique basename match anywhere in the vault.
        // Ambiguous basenames stay unresolved (NULL) rather than guessing.
        await client.query(
          `INSERT INTO links (src_document_id, target_path, target_document_id)
           VALUES ($1, $2, (
             SELECT id FROM (
               SELECT id, (path = $2 OR path = $2 || '.md') AS exact
               FROM documents
               WHERE collection = $3
                 AND (path = $2 OR path = $2 || '.md' OR right(path, length($2) + 1) = '/' || $2
                      OR right(path, length($2) + 4) = '/' || $2 || '.md')
             ) m
             WHERE exact OR (SELECT count(*) FROM documents d2 WHERE d2.collection = $3
                               AND (right(d2.path, length($2) + 1) = '/' || $2
                                    OR right(d2.path, length($2) + 4) = '/' || $2 || '.md')) = 1
             ORDER BY exact DESC LIMIT 1))
           ON CONFLICT DO NOTHING`,
          [id, target, this.collection]
        );
      }
      // Resolve links from other documents that pointed at this note by full path.
      await client.query(
        `UPDATE links l SET target_document_id = $1
         FROM documents src
         WHERE l.src_document_id = src.id AND src.collection = $4
           AND l.target_document_id IS NULL
           AND (l.target_path = $2 OR l.target_path || '.md' = $2 OR l.target_path = $3)`,
        [id, input.path, input.path.replace(/\.md$/i, ''), this.collection]
      );
      // Basename ("shortest path") links: resolve to this note if its basename is
      // unique in the vault; if this note made a basename ambiguous, un-resolve
      // every link that used it, so the answer does not depend on index order.
      const base = input.path.split('/').pop() ?? input.path;
      const baseNoExt = base.replace(/\.md$/i, '');
      const same = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM documents
         WHERE collection = $1 AND (path = $2 OR right(path, length($2) + 1) = '/' || $2)`,
        [this.collection, base]
      );
      const unique = same.rows[0].n === '1';
      await client.query(
        `UPDATE links l SET target_document_id = $1
         FROM documents src
         WHERE l.src_document_id = src.id AND src.collection = $2
           AND (l.target_path = $3 OR l.target_path = $4)`,
        [unique ? id : null, this.collection, base, baseNoExt]
      );
      await client.query('COMMIT');
      return id;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        releaseErr = rollbackErr as Error;
      }
      throw err;
    } finally {
      // A failed ROLLBACK means the connection is suspect; destroy it rather than pool it.
      if (releaseErr) client.release(releaseErr);
      else client.release();
    }
  }

  /** Refresh mtime/size for a document whose bytes did not change. */
  async upsertDocumentStat(docPath: string, mtime: Date, size: number): Promise<void> {
    await this.pool.query(
      'UPDATE documents SET mtime = $3, size = $4 WHERE collection = $1 AND path = $2',
      [this.collection, docPath, mtime, size]
    );
  }

  async deleteDocument(docPath: string): Promise<void> {
    await this.pool.query('DELETE FROM documents WHERE collection = $1 AND path = $2', [
      this.collection,
      docPath,
    ]);
  }

  // ------------------------------------------------------------------
  // Index runs
  // ------------------------------------------------------------------

  async startRun(): Promise<number> {
    const res = await this.pool.query<{ id: number }>(
      'INSERT INTO index_runs (collection) VALUES ($1) RETURNING id',
      [this.collection]
    );
    return Number(res.rows[0].id);
  }

  async finishRun(
    id: number,
    stats: { seen: number; changed: number; removed: number; errors: number; errorText?: string }
  ): Promise<void> {
    await this.pool.query(
      `UPDATE index_runs SET finished_at = now(), seen = $2, changed = $3, removed = $4, errors = $5, error_text = $6
       WHERE id = $1`,
      [id, stats.seen, stats.changed, stats.removed, stats.errors, stats.errorText ?? null]
    );
  }

  // ------------------------------------------------------------------
  // Reads for the MCP tools
  // ------------------------------------------------------------------

  /** Notes whose frontmatter is not valid YAML, with the parser error (capped). */
  async listInvalidFrontmatter(
    limit = 20
  ): Promise<{ count: number; notes: InvalidFrontmatterNote[] }> {
    const count = await this.pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM documents WHERE collection = $1 AND frontmatter_error IS NOT NULL',
      [this.collection]
    );
    const rows = await this.pool.query<{ path: string; frontmatter_error: string }>(
      `SELECT path, frontmatter_error FROM documents
       WHERE collection = $1 AND frontmatter_error IS NOT NULL ORDER BY path LIMIT $2`,
      [this.collection, limit]
    );
    return {
      count: Number(count.rows[0].n),
      notes: rows.rows.map(r => ({ path: r.path, error: r.frontmatter_error })),
    };
  }

  async status(): Promise<IndexStatus> {
    const meta = await this.getMeta();
    const invalidFrontmatter = await this.listInvalidFrontmatter();
    const counts = await this.pool.query<{ documents: string; chunks: string }>(
      `SELECT (SELECT count(*) FROM documents WHERE collection = $1)::text AS documents,
              (SELECT count(*) FROM chunks c JOIN documents d ON d.id = c.document_id WHERE d.collection = $1)::text AS chunks`,
      [this.collection]
    );
    const run = await this.pool.query<{
      id: number;
      started_at: Date;
      finished_at: Date | null;
      seen: number;
      changed: number;
      removed: number;
      errors: number;
      error_text: string | null;
    }>(
      `SELECT id, started_at, finished_at, seen, changed, removed, errors, error_text
       FROM index_runs WHERE collection = $1 AND finished_at IS NOT NULL
       ORDER BY started_at DESC LIMIT 1`,
      [this.collection]
    );
    const r = run.rows[0];
    const lastRun: IndexRunRecord | null = r
      ? {
          id: Number(r.id),
          startedAt: r.started_at,
          finishedAt: r.finished_at,
          seen: r.seen,
          changed: r.changed,
          removed: r.removed,
          errors: r.errors,
          errorText: r.error_text,
        }
      : null;
    return {
      collection: this.collection,
      embedModel: meta.embed_model ?? null,
      dim: meta.dim ? Number(meta.dim) : null,
      schemaVersion: meta.schema_version ?? null,
      documents: Number(counts.rows[0].documents),
      chunks: Number(counts.rows[0].chunks),
      lastRun,
      lagSeconds: lastRun?.finishedAt
        ? Math.round((Date.now() - lastRun.finishedAt.getTime()) / 1000)
        : null,
      invalidFrontmatter,
    };
  }

  private filterSql(filters: SearchFilters, params: unknown[], alias = 'd'): string {
    const clauses: string[] = [];
    const dir = normalizeDirectory(filters.directory);
    if (dir) {
      params.push(dir);
      clauses.push(`left(${alias}.path, length($${params.length})) = $${params.length}`);
    }
    if (filters.tags && filters.tags.length) {
      params.push(filters.tags);
      clauses.push(`${alias}.tags && $${params.length}::text[]`);
    }
    if (filters.type) {
      params.push(filters.type);
      clauses.push(`${alias}.frontmatter->>'type' = $${params.length}`);
    }
    if (filters.status) {
      params.push(filters.status);
      clauses.push(`${alias}.frontmatter->>'status' = $${params.length}`);
    }
    return clauses.length ? ` AND ${clauses.join(' AND ')}` : '';
  }

  /**
   * Vector cosine and full-text legs with configurable fusion and a per-note
   * cap. `mode` can restrict retrieval to one leg.
   */
  async search(
    queryEmbedding: number[] | null,
    queryText: string,
    options: {
      k?: number;
      mode?: 'hybrid' | 'vector' | 'text';
      candidates?: number;
      ranking?: RankingConfig;
    } & SearchFilters = {}
  ): Promise<SearchHit[]> {
    const k = Math.max(1, Math.min(options.k ?? 8, 50));
    const candidates = Math.max(k, Math.min(options.candidates ?? 40, 200));
    const mode = options.mode ?? 'hybrid';
    const ranking = options.ranking ?? DEFAULT_RANKING;
    const useVector = mode !== 'text' && queryEmbedding !== null;
    const useText = mode !== 'vector' && queryText.trim().length > 0;
    if (!useVector && !useText) return [];

    const params: unknown[] = [this.collection];
    const filter = this.filterSql(options, params);
    const client = await this.pool.connect();
    type LegRow = { id: string; document_id: string; ord: number; score: number; rn: string };
    const toLeg = (rows: LegRow[]): LegHit[] =>
      rows.map(r => ({
        id: Number(r.id),
        documentId: Number(r.document_id),
        ord: Number(r.ord),
        rank: Number(r.rn),
        score: Number(r.score),
      }));
    let releaseErr: Error | undefined;
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL hnsw.iterative_scan = strict_order');
      if (filter) await client.query('SET LOCAL hnsw.ef_search = 100');
      let vector: LegHit[] = [];
      let text: LegHit[] = [];
      if (useVector) {
        const legParams = [...params, toSqlVector(queryEmbedding!), candidates];
        const p = params.length + 1;
        const lim = params.length + 2;
        const res = await client.query<LegRow>(
          `
          SELECT c.id, c.document_id, c.ord, 1 - (c.embedding <=> $${p}::vector) AS score,
                 row_number() OVER (ORDER BY c.embedding <=> $${p}::vector) AS rn
          FROM chunks c JOIN documents d ON d.id = c.document_id
          WHERE d.collection = $1${filter}
          ORDER BY c.embedding <=> $${p}::vector
          LIMIT $${lim}`,
          legParams
        );
        vector = toLeg(res.rows);
      }
      if (useText) {
        const legParams = [...params, queryText, candidates];
        const q = params.length + 1;
        const lim = params.length + 2;
        const res = await client.query<LegRow>(
          `
          SELECT c.id, c.document_id, c.ord, ts_rank_cd(c.tsv, websearch_to_tsquery('english', $${q})) AS score,
                 row_number() OVER (ORDER BY ts_rank_cd(c.tsv, websearch_to_tsquery('english', $${q})) DESC, c.id) AS rn
          FROM chunks c JOIN documents d ON d.id = c.document_id
          WHERE d.collection = $1${filter} AND c.tsv @@ websearch_to_tsquery('english', $${q})
          ORDER BY score DESC, c.id
          LIMIT $${lim}`,
          legParams
        );
        text = toLeg(res.rows);
      }
      const hits = capPerNote(fuse(vector, text, ranking), ranking.perNoteCap).slice(0, k);
      let results: SearchHit[] = [];
      if (hits.length) {
        const details = await client.query<{
          id: string;
          path: string;
          title: string;
          heading_path: string;
          ord: number;
          content: string;
        }>(
          `SELECT c.id, d.path, d.title, c.heading_path, c.ord, c.content FROM chunks c JOIN documents d ON d.id = c.document_id WHERE c.id = ANY($1::bigint[])`,
          [hits.map(h => h.id)]
        );
        const byId = new Map(details.rows.map(r => [Number(r.id), r]));
        results = hits.map(hit => {
          const row = byId.get(hit.id)!;
          return {
            path: row.path,
            title: row.title,
            headingPath: row.heading_path,
            ord: Number(row.ord),
            score: Number(hit.fused.toFixed(5)),
            vectorRank: hit.vectorRank,
            textRank: hit.textRank,
            snippet: snippetOf(row.content),
          };
        });
      }
      await client.query('COMMIT');
      return results;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        releaseErr = rollbackErr as Error;
      }
      throw err;
    } finally {
      // A failed ROLLBACK means the connection is suspect; destroy it rather than pool it.
      if (releaseErr) client.release(releaseErr);
      else client.release();
    }
  }

  /**
   * Notes nearest to a given note by centroid cosine similarity.
   */
  async similar(docPath: string, k = 8): Promise<SimilarHit[]> {
    const res = await this.pool.query<{ path: string; title: string; score: string }>(
      `WITH me AS (SELECT centroid FROM documents WHERE collection = $1 AND path = $2)
       SELECT d.path, d.title, (1 - (d.centroid <=> me.centroid))::text AS score
       FROM documents d, me
       WHERE d.collection = $1 AND d.path <> $2 AND d.centroid IS NOT NULL AND me.centroid IS NOT NULL
       ORDER BY d.centroid <=> me.centroid
       LIMIT $3`,
      [this.collection, docPath, Math.max(1, Math.min(k, 50))]
    );
    return res.rows.map(r => ({
      path: r.path,
      title: r.title,
      score: Number(Number(r.score).toFixed(4)),
    }));
  }

  async hasDocument(docPath: string): Promise<boolean> {
    const res = await this.pool.query(
      'SELECT 1 FROM documents WHERE collection = $1 AND path = $2',
      [this.collection, docPath]
    );
    return (res.rowCount ?? 0) > 0;
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
