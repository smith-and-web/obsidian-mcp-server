import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RANKING as defaults,
  fuse,
  capPerNote,
  rankingId,
  rankingEnv,
} from '../src/index/ranking.js';

const hit = (id, rank, score = 1, ord = 0, documentId = id) => ({
  id,
  rank,
  score,
  ord,
  documentId,
});
describe('ranking', () => {
  it('reproduces the legacy sums and missing-leg zero exactly', () => {
    const rows = fuse([hit(1, 1), hit(2, 2)], [hit(2, 1), hit(3, 2)], defaults);
    expect(rows.map(h => h.id)).toEqual([2, 1, 3]);
    expect(rows.map(h => h.fused)).toEqual([1 / 62 + 1 / 61, 1 / 61, 1 / 62]);
    expect(rows[1].textRank).toBeNull();
    expect(rows[2].vectorRank).toBeNull();
  });
  it('orders exact ties by ord, then id', () => {
    expect(
      fuse([hit(3, 1, 1, 2), hit(2, 1, 1, 1), hit(1, 1, 1, 1)], [], defaults).map(h => h.id)
    ).toEqual([1, 2, 3]);
  });
  it('scales each leg by its weight', () => {
    expect(fuse([hit(1, 2)], [hit(1, 3)], { ...defaults, wVector: 2, wText: 1.5 })[0].fused).toBe(
      2 / 62 + 1.5 / 63
    );
  });
  it('normalises DBSF using population deviation and weighted missing legs', () => {
    const rows = fuse([hit(1, 1, 2), hit(2, 2, 0)], [hit(1, 1, 8)], {
      ...defaults,
      fusion: 'dbsf',
      wVector: 2,
      wText: 3,
    });
    expect(rows[0].fused).toBeCloseTo(2 * (2 / 3) + 3);
    expect(rows[1].fused).toBeCloseTo(2 / 3);
    expect(
      fuse([hit(1, 1, 4), hit(2, 2, 4)], [], { ...defaults, fusion: 'dbsf' }).map(h => h.fused)
    ).toEqual([1, 1]);
    expect(fuse([], [hit(1, 1, 0)], { ...defaults, fusion: 'dbsf' })[0].fused).toBe(1);
    expect(fuse([], [], { ...defaults, fusion: 'dbsf' })).toEqual([]);
  });
  it('clamps DBSF outliers to the unit interval', () => {
    const leg = Array.from({ length: 20 }, (_, i) => hit(i, i + 1, i === 0 ? 100 : 0));
    expect(fuse(leg, [], { ...defaults, fusion: 'dbsf' })[0].fused).toBe(1);
    const negative = leg.map(h => ({ ...h, score: -h.score }));
    expect(fuse(negative, [], { ...defaults, fusion: 'dbsf' }).at(-1).fused).toBe(0);
  });
  it('caps in order and returns the original array for cap zero', () => {
    const rows = [hit(1, 1, 0, 0, 9), hit(2, 2, 0, 1, 9), hit(3, 3, 0, 2, 8), hit(4, 4, 0, 3, 9)];
    expect(capPerNote(rows, 0)).toBe(rows);
    expect(capPerNote(rows, 1).map(h => h.id)).toEqual([1, 3]);
    expect(capPerNote(rows, 2).map(h => h.id)).toEqual([1, 2, 3]);
  });
  it('prints stable ids and all five env variables in order', () => {
    expect(rankingId(defaults)).toBe('rrf-k60-v1-t1-cap0');
    expect(rankingId({ ...defaults, fusion: 'dbsf', wVector: 1.5, perNoteCap: 2 })).toBe(
      'dbsf-v1.5-t1-cap2'
    );
    expect(rankingId({ ...defaults, wText: 1.5 })).toBe('rrf-k60-v1-t1.5-cap0');
    expect(Object.entries(rankingEnv(defaults))).toEqual([
      ['SEARCH_FUSION', 'rrf'],
      ['SEARCH_RRF_K', '60'],
      ['SEARCH_W_VECTOR', '1'],
      ['SEARCH_W_TEXT', '1'],
      ['SEARCH_PER_NOTE_CAP', '0'],
    ]);
  });
});
