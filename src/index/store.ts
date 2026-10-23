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
    const client = await this.pool.connect();
    try {
      await client.query(ddl);
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
    await this.pool.query(
      'DROP TABLE IF EXISTS links, chunks, documents, index_runs, meta CASCADE'
    );
  }

  async getMeta(): Promise<Record<string, string>> {
    const res = await this.pool.query<{ key: string; value: string }>(
      'SELECT key, value FROM meta'
    );
    return Object.fromEntries(res.rows.map(r => [r.key, r.value]));
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
                 AND (path = $2 OR path = $2 || '.md' OR path LIKE '%/' || $2 OR path LIKE '%/' || $2 || '.md')
             ) m
             WHERE exact OR (SELECT count(*) FROM documents d2 WHERE d2.collection = $3
                               AND (d2.path LIKE '%/' || $2 OR d2.path LIKE '%/' || $2 || '.md')) = 1
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
         WHERE collection = $1 AND (path = $2 OR path LIKE '%/' || $2)`,
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
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
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
      clauses.push(`${alias}.path LIKE $${params.length} || '%'`);
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
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
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
