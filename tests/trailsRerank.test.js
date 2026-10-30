import { describe, it, expect, vi } from 'vitest';
import { trailsRerank } from '../src/index/ranking.js';

const opts = { w: 0.5, anchors: 1, rrfK: 60 };
const hits = () => [
  { id: 1, documentId: 10, fused: 0.03 },
  { id: 2, documentId: 20, fused: 0.025 },
  { id: 3, documentId: 30, fused: 0.024 },
  { id: 4, documentId: 30, fused: 0.023 },
];
describe('trails rerank', () => {
  it('returns an identical order and scores without edges, including empty input', () => {
    const rows = hits();
    expect(trailsRerank(rows, () => 0, opts)).toEqual(rows);
    expect(trailsRerank(rows, () => 0, opts)).not.toBe(rows);
    expect(trailsRerank([], () => 0, opts)).toEqual([]);
  });
  it('lifts every chunk of a strongly connected note without mutating or losing anything', () => {
    const rows = hits().map(Object.freeze);
    Object.freeze(rows);
    const result = trailsRerank(rows, (a, b) => a === 10 && b === 30 ? 9 : 0, opts);
    expect(result.map(h => h.id)).toEqual([3, 4, 1, 2]);
    expect(result[0].fused).toBeCloseTo(0.024 + 0.5 / 61);
    expect(result[1].fused).toBeCloseTo(0.023 + 0.5 / 61);
    expect(new Set(result.map(h => h.id))).toEqual(new Set(rows.map(h => h.id)));
    expect(rows[2].fused).toBe(0.024);
  });
  it('takes distinct anchors in input order, excludes self, and sums their edges', () => {
    const rows = [{ documentId: 10, fused: 1 }, { documentId: 10, fused: 1 },
      { documentId: 20, fused: 1 }, { documentId: 30, fused: 1 }];
    const weight = vi.fn((a, b) => a === 20 && b === 30 ? 2 : a === 10 && b === 30 ? 1 : 0);
    const one = trailsRerank(rows, weight, opts);
    expect(weight.mock.calls.every(([a, b]) => a === 10 && a !== b)).toBe(true);
    expect(weight).toHaveBeenCalledTimes(2);
    weight.mockClear();
    const two = trailsRerank(rows, weight, { ...opts, anchors: 2 });
    expect(weight.mock.calls.map(([a]) => a)).toEqual([20, 10, 10, 20]);
    expect(two[0].documentId).toBe(30);
    expect(one[0].documentId).toBe(30);
  });
  it('orders trail ties by first document position and score ties by original hit position', () => {
    const rows = [{ id: 1, documentId: 10, fused: 0 },
      { id: 2, documentId: 20, fused: 0 }, { id: 3, documentId: 30, fused: 0 },
      { id: 4, documentId: 20, fused: 0 }];
    const result = trailsRerank(rows, () => 1, opts);
    expect(result.map(h => h.id)).toEqual([2, 4, 3, 1]);
    expect(result.map(h => h.fused)).toEqual([0.5 / 61, 0.5 / 61, 0.5 / 62, 0]);
  });
  it('uses the supplied RRF constant and gives no boost for nonpositive totals', () => {
    const result = trailsRerank(hits(), (a, b) => b === 30 ? 1 : -1, { ...opts, rrfK: 1 });
    expect(result[0].fused).toBe(0.024 + 0.5 / 2);
    expect(result.find(h => h.id === 2).fused).toBe(0.025);
  });
});
