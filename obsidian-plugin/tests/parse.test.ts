import { describe, it, expect } from 'vitest';
import { parseRelated } from '../src/parse';

const response = () => ({
  path: 'notes/a.md',
  title: 'A',
  heat: { score: 3.2, bucket: 2 },
  trails: [
    {
      path: 'notes/b.md',
      title: 'B',
      weight: 4.1,
      events: 3,
      lastAt: '2026-10-29T14:00:00.000Z',
      linked: false,
    },
  ],
  similar: [{ path: 'notes/c.md', title: 'C', score: 0.83, linked: true }],
});
describe('parseRelated', () => {
  it('accepts the endpoint shape', () => {
    const data = response();
    expect(parseRelated(data)).toEqual(data);
  });
  it('accepts null heat and empty results', () => {
    expect(
      parseRelated({ path: 'notes/a.md', title: 'A', heat: null, trails: [], similar: [] }).heat
    ).toBeNull();
  });
  it.each(['path', 'title', 'heat', 'trails', 'similar'])('rejects missing %s', key => {
    const data: Record<string, unknown> = response();
    delete data[key];
    expect(() => parseRelated(data)).toThrow('Invalid related notes response');
  });
  it.each(['path', 'title', 'weight', 'events', 'lastAt', 'linked'])(
    'rejects missing trail %s',
    key => {
      const data = response();
      delete (data.trails[0] as Record<string, unknown>)[key];
      expect(() => parseRelated(data)).toThrow();
    }
  );
  it.each(['path', 'title', 'score', 'linked'])('rejects missing similar %s', key => {
    const data = response();
    delete (data.similar[0] as Record<string, unknown>)[key];
    expect(() => parseRelated(data)).toThrow();
  });
  it.each([null, [], {}, 'response', 1])('rejects non-responses %j', data => {
    expect(() => parseRelated(data)).toThrow();
  });
  it('rejects invalid values and unsafe paths', () => {
    for (const patch of [
      { heat: { score: NaN, bucket: 2 } },
      { heat: { score: 1, bucket: 6 } },
      { heat: {} },
      { path: '../a.md' },
      { trails: [{}] },
      { similar: 'bad' },
    ]) {
      expect(() => parseRelated({ ...response(), ...patch })).toThrow();
    }
    const data = response();
    data.trails[0].lastAt = 'bad';
    expect(() => parseRelated(data)).toThrow();
    data.trails[0].lastAt = '2026-10-29T14:00:00.000Z';
    data.similar[0].score = Infinity;
    expect(() => parseRelated(data)).toThrow();
  });
});
