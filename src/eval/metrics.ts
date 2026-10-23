import { DEFAULT_RANKING, type RankingConfig } from '../index/ranking.js';
import { CATEGORIES, type Category, type Golden } from './golden.js';

export function scoreQuery(notes: string[], expected: string[]) {
  const relevant = new Set(expected);
  const index = notes.findIndex(note => relevant.has(note));
  const firstRank = index < 0 ? null : index + 1;
  const dcg = notes
    .slice(0, 8)
    .reduce((sum, note, i) => sum + (relevant.has(note) ? 1 / Math.log2(i + 2) : 0), 0);
  const idcg = Array.from(
    { length: Math.min(expected.length, 8) },
    (_, i) => 1 / Math.log2(i + 2)
  ).reduce((a, b) => a + b, 0);
  return {
    firstRank,
    rr: firstRank === null ? 0 : 1 / firstRank,
    hit5: firstRank !== null && firstRank <= 5 ? 1 : 0,
    ndcg8: dcg / idcg,
    distinctNotes: notes.length,
  };
}

export interface QueryScore extends ReturnType<typeof scoreQuery> {
  id: string;
  notes: string[];
}

interface Means {
  mrr: number;
  recall5: number;
  ndcg8: number;
  distinctNotes: number;
}
export interface Metrics extends Means {
  byCategory: Partial<Record<Category, Means & { n: number }>>;
}

export function aggregate(perQuery: QueryScore[], golden: Golden): Metrics {
  const means = (rows: QueryScore[]): Means => ({
    mrr: rows.reduce((sum, row) => sum + row.rr, 0) / rows.length,
    recall5: rows.reduce((sum, row) => sum + row.hit5, 0) / rows.length,
    ndcg8: rows.reduce((sum, row) => sum + row.ndcg8, 0) / rows.length,
    distinctNotes: rows.reduce((sum, row) => sum + row.distinctNotes, 0) / rows.length,
  });
  const byCategory: Metrics['byCategory'] = {};
  for (const category of CATEGORIES) {
    const ids = new Set(golden.queries.filter(q => q.category === category).map(q => q.id));
    const rows = perQuery.filter(q => ids.has(q.id));
    if (rows.length) byCategory[category] = { n: rows.length, ...means(rows) };
  }
  return { ...means(perQuery), byCategory };
}

export interface GateResult {
  pass: boolean;
  reasons: string[];
}
export interface Evaluation {
  id: string;
  config: RankingConfig;
  metrics: Metrics;
  perQuery: Pick<QueryScore, 'id' | 'firstRank' | 'notes'>[];
  gate: GateResult;
}

const r4 = (x: number) => Math.round(x * 10000);

export function gate(
  candidate: Pick<Evaluation, 'metrics' | 'perQuery'>,
  baseline: Pick<Evaluation, 'metrics' | 'perQuery'>
): GateResult {
  const reasons: string[] = [];
  if (r4(candidate.metrics.mrr) < r4(baseline.metrics.mrr) + 300) reasons.push('mrr');
  for (const category of CATEGORIES) {
    const base = baseline.metrics.byCategory[category];
    if (base && r4(candidate.metrics.byCategory[category]?.recall5 ?? 0) < r4(base.recall5)) {
      reasons.push(`category-recall:${category}`);
    }
  }
  const byId = new Map(candidate.perQuery.map(q => [q.id, q.firstRank]));
  for (const query of baseline.perQuery) {
    if (query.firstRank !== null && query.firstRank <= 5) {
      const rank = byId.get(query.id);
      if (rank === undefined || rank === null || rank > 5) reasons.push(`regression:${query.id}`);
    }
  }
  return { pass: reasons.length === 0, reasons };
}

function differences(cfg: RankingConfig): number {
  return (Object.keys(DEFAULT_RANKING) as (keyof RankingConfig)[]).filter(
    key => !(cfg.fusion === 'dbsf' && key === 'rrfK') && cfg[key] !== DEFAULT_RANKING[key]
  ).length;
}

/** Winner order also applies to the unfiltered stdout ranking table. */
export function winnerOrder(a: Evaluation, b: Evaluation): number {
  for (const key of ['mrr', 'recall5', 'ndcg8'] as const) {
    const delta = r4(b.metrics[key]) - r4(a.metrics[key]);
    if (delta) return delta;
  }
  return differences(a.config) - differences(b.config) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function selectWinner(
  results: Evaluation[],
  baselineId: string
): { id: string; changed: boolean } {
  const winner = [...results].filter(r => r.id !== baselineId && r.gate.pass).sort(winnerOrder)[0];
  return winner ? { id: winner.id, changed: true } : { id: baselineId, changed: false };
}
