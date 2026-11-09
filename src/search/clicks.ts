/**
 * Query-click rerank: lightly boost existing candidates that earlier, similar searches led to
 * reads of. "Similar" is query-embedding cosine >= tau; a note's evidence `t` is the summed
 * cosine of the matching past searches that read it (each search counts a note once). The boost
 * `w * t / (t + c) / (rrfK + 1)` saturates in `t` and stays on the scale of one RRF position.
 *
 * The math mirrors the offline analysis of 2026-11-08 (trails-tune-click.mjs) so offline and
 * online numbers agree. Candidates are only reordered, never added or dropped.
 */
import type pg from 'pg';

export interface ClicksConfig {
  mode: 'off' | 'shadow' | 'on';
  tau: number;
  w: number;
  c: number;
  windowDays: number;
}

export const DEFAULT_CLICKS: ClicksConfig = {
  mode: 'off',
  tau: 0.8,
  w: 0.5,
  c: 1,
  windowDays: 30,
};

/** Validate SEARCH_CLICKS* independently of the fusion configuration. */
export function parseClicksEnv(env: NodeJS.ProcessEnv): ClicksConfig {
  const mode = env.SEARCH_CLICKS || 'off';
  if (mode !== 'off' && mode !== 'shadow' && mode !== 'on')
    throw new Error(`Invalid SEARCH_CLICKS=${mode}: expected off, shadow or on`);
  const number = (
    name: string,
    fallback: number,
    ok: (v: number) => boolean,
    expected: string
  ): number => {
    const raw = env[name];
    const value = raw === undefined || raw === '' ? fallback : Number(raw);
    if (!Number.isFinite(value) || !ok(value))
      throw new Error(`Invalid ${name}=${raw}: expected ${expected}`);
    return value;
  };
  return {
    mode,
    tau: number(
      'SEARCH_CLICKS_TAU',
      DEFAULT_CLICKS.tau,
      v => v > 0 && v < 1,
      'a number between 0 and 1'
    ),
    w: number(
      'SEARCH_CLICKS_W',
      DEFAULT_CLICKS.w,
      v => v > 0 && v <= 10,
      'a number greater than 0 and at most 10'
    ),
    c: number(
      'SEARCH_CLICKS_C',
      DEFAULT_CLICKS.c,
      v => v > 0 && v <= 100,
      'a number greater than 0 and at most 100'
    ),
    windowDays: number(
      'SEARCH_CLICKS_WINDOW_DAYS',
      DEFAULT_CLICKS.windowDays,
      v => Number.isInteger(v) && v >= 1 && v <= 365,
      'an integer from 1 to 365'
    ),
  };
}

/** Ranker id suffix for an enabled clicks rerank, e.g. `-ck0.8w0.5c1`. */
export function clicksSuffix(clicks?: ClicksConfig): string {
  return clicks?.mode === 'on' ? `-ck${clicks.tau}w${clicks.w}c${clicks.c}` : '';
}

/** Pure rerank: add each candidate's boost and sort stably by the new score. */
export function clicksRerank<T extends { documentId: number; fused: number }>(
  hits: T[],
  totals: Map<number, number>,
  opts: { w: number; c: number; rrfK: number }
): T[] {
  return hits
    .map((hit, position) => {
      const t = totals.get(hit.documentId) ?? 0;
      const boost = t > 0 ? (opts.w * t) / (t + opts.c) / (opts.rrfK + 1) : 0;
      return { hit: { ...hit, fused: hit.fused + boost }, position };
    })
    .sort((a, b) => b.hit.fused - a.hit.fused || a.position - b.position)
    .map(({ hit }) => hit);
}

/**
 * Summed cosine per candidate document from earlier searches in the window. A bounded scan of
 * the collection's recent search_log rows (index `search_log_collection_at`): the learn log
 * keeps 30 days, a few thousand rows, and a 1024-dim cosine over 5,000 rows measured ~10 ms.
 * Redacted searches carry no embedding and never match. The current search is not logged yet.
 */
export async function clickTotals(
  db: pg.Pool | pg.PoolClient,
  collection: string,
  queryVector: string,
  documentIds: number[],
  cfg: Pick<ClicksConfig, 'tau' | 'windowDays'>
): Promise<Map<number, number>> {
  if (!documentIds.length) return new Map();
  const result = await db.query<{ document_id: string; t: number }>(
    `WITH past AS (
       SELECT s.id, 1 - (s.query_embedding <=> $2::vector) AS cos
       FROM search_log s
       WHERE s.collection = $1 AND s.query_embedding IS NOT NULL
         AND s.at >= now() - make_interval(days => $4)
     ), matched AS (
       SELECT DISTINCT p.id, p.cos, r.path
       FROM past p JOIN note_reads r ON r.request_id = p.id AND r.collection = $1
       WHERE p.cos >= $3
     )
     SELECT d.id AS document_id, sum(m.cos)::float8 AS t
     FROM matched m JOIN documents d ON d.collection = $1 AND d.path = m.path
     WHERE d.id = ANY($5::bigint[])
     GROUP BY d.id`,
    [collection, queryVector, cfg.tau, cfg.windowDays, documentIds]
  );
  return new Map(result.rows.map(row => [Number(row.document_id), Number(row.t)]));
}
