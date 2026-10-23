import { describe, it, expect } from 'vitest';
import { scoreQuery, aggregate, gate, selectWinner, winnerOrder } from '../src/eval/metrics.js';
import { CATEGORIES } from '../src/eval/golden.js';
import { GRID } from '../src/eval/grid.js';
import { DEFAULT_RANKING, rankingId } from '../src/index/ranking.js';

const baselineId = rankingId(DEFAULT_RANKING);
const result = (id = 'candidate', overrides = {}) => ({
  id,
  config: { ...DEFAULT_RANKING },
  metrics: {
    mrr: 0.5,
    recall5: 1,
    ndcg8: 0.5,
    distinctNotes: 4,
    byCategory: { 'exact-id': { n: 1, mrr: 0.5, recall5: 1, ndcg8: 0.5 } },
  },
  perQuery: [{ id: 'a', firstRank: 2, notes: [] }],
  gate: { pass: true, reasons: [] },
  ...overrides,
});

describe('evaluation metrics', () => {
  it('scores hand examples over notes', () => {
    expect(scoreQuery(['Other.md', 'Example.md'], ['Example.md'])).toEqual({
      firstRank: 2,
      rr: 0.5,
      hit5: 1,
      ndcg8: 1 / Math.log2(3),
      distinctNotes: 2,
    });
    const expected = Array.from({ length: 10 }, (_, i) => `Item-${i}.md`);
    expect(scoreQuery(expected, expected).ndcg8).toBe(1);
    const sixth = scoreQuery(['a', 'b', 'c', 'd', 'e', 'Example.md'], ['Example.md']);
    expect(sixth.firstRank).toBe(6);
    expect(sixth.hit5).toBe(0);
    expect(sixth.rr).toBe(1 / 6);
    expect(scoreQuery(['Other.md'], ['Example.md'])).toEqual({
      firstRank: null,
      rr: 0,
      hit5: 0,
      ndcg8: 0,
      distinctNotes: 1,
    });
    expect(scoreQuery([], ['Example.md']).ndcg8).toBe(0);
  });
  it('aggregates means and categories in the fixed order', () => {
    const golden = {
      queries: [
        { id: 'b', category: 'recent' },
        { id: 'a', category: 'exact-id' },
      ],
    };
    const scores = [
      { id: 'b', ...scoreQuery([], ['Example.md']) },
      { id: 'a', ...scoreQuery(['Example.md'], ['Example.md']) },
    ];
    const metrics = aggregate(scores, golden);
    expect(metrics.mrr).toBe(0.5);
    expect(metrics.recall5).toBe(0.5);
    expect(metrics.distinctNotes).toBe(0.5);
    expect(Object.keys(metrics.byCategory)).toEqual(['exact-id', 'recent']);
    expect(metrics.byCategory.recent.n).toBe(1);
  });
  it('fires mrr alone, using integer rounding', () => {
    const base = result();
    const candidate = result();
    candidate.metrics.mrr = 0.52994;
    expect(gate(candidate, base)).toEqual({ pass: false, reasons: ['mrr'] });
    candidate.metrics.mrr = 0.52996;
    expect(gate(candidate, base)).toEqual({ pass: true, reasons: [] });
  });
  it.each(CATEGORIES)('fires category-recall:%s alone', category => {
    const base = result();
    const candidate = result();
    base.metrics.byCategory = { [category]: { recall5: 1 } };
    candidate.metrics.mrr = 0.6;
    candidate.metrics.byCategory = { [category]: { recall5: 0.5 } };
    expect(gate(candidate, base).reasons).toEqual([`category-recall:${category}`]);
  });
  it.each([null, 6])('fires a regression alone for rank %s', rank => {
    const base = result();
    const candidate = result();
    candidate.metrics.mrr = 0.6;
    candidate.perQuery[0].firstRank = rank;
    expect(gate(candidate, base).reasons).toEqual(['regression:a']);
  });
  it('orders failures by code, category order and golden query order', () => {
    const base = result();
    const candidate = result();
    for (const category of [...CATEGORIES].reverse()) {
      base.metrics.byCategory[category] = { recall5: 1 };
      candidate.metrics.byCategory[category] = { recall5: 0 };
    }
    base.perQuery = [
      { id: 'z', firstRank: 5 },
      { id: 'a', firstRank: 1 },
    ];
    candidate.perQuery = [];
    expect(gate(candidate, base).reasons).toEqual([
      'mrr',
      ...CATEGORIES.map(c => `category-recall:${c}`),
      'regression:z',
      'regression:a',
    ]);
  });
  it.each(['mrr', 'recall5', 'ndcg8'])('breaks metric ties using %s', key => {
    const a = result('z');
    const b = result('a');
    a.metrics[key] += 0.0001;
    expect([b, a].sort(winnerOrder)[0].id).toBe('z');
  });
  it('prefers fewer changed fields and ignores rrfK under dbsf', () => {
    const a = result('z');
    const b = result('a');
    b.config.wText = 2;
    expect(winnerOrder(a, b)).toBeLessThan(0);
    a.config = { ...DEFAULT_RANKING, fusion: 'dbsf', rrfK: 10 };
    expect(winnerOrder(a, b)).toBeGreaterThan(0); // one field each: lexical tie-break
    b.config.wVector = 2;
    expect(winnerOrder(a, b)).toBeLessThan(0);
  });
  it('breaks rounded metric ties lexicographically', () => {
    const a = result('a');
    const b = result('z');
    b.metrics.mrr += 0.00001;
    expect(winnerOrder(a, b)).toBeLessThan(0);
  });
  it('selects only passing candidates, or leaves the baseline unchanged', () => {
    const base = result(baselineId, { gate: { pass: false, reasons: ['baseline'] } });
    const fail = result('best', { gate: { pass: false, reasons: ['regression:a'] } });
    fail.metrics.mrr = 1;
    expect(selectWinner([base, fail], baselineId)).toEqual({ id: baselineId, changed: false });
    expect(selectWinner([base, fail, result('winner')], baselineId)).toEqual({
      id: 'winner',
      changed: true,
    });
  });
  it('builds the exact fixed grid with baseline first', () => {
    expect(GRID).toHaveLength(40);
    expect(new Set(GRID.map(rankingId)).size).toBe(40);
    expect(GRID[0]).toEqual(DEFAULT_RANKING);
    expect(GRID[1]).toEqual({ fusion: 'rrf', rrfK: 10, wVector: 1, wText: 1, perNoteCap: 0 });
    expect(GRID[30]).toEqual({ fusion: 'dbsf', rrfK: 60, wVector: 1, wText: 1, perNoteCap: 0 });
  });
});
