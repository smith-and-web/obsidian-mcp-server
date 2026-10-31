import { describe, it, expect } from 'vitest';
import { parseGraph } from '../src/graph-parse';

const response = () => ({
  nodes: [
    { path: 'notes/a.md', title: 'A', type: 'project', up: ['[[B]]'], heat: 2, score: 5.43 },
    { path: 'notes/b.md', title: 'B', type: '', up: [], heat: 0, score: 0 },
  ],
  links: [[0, 1]],
  trails: [[0, 1, 2.8]],
});
describe('parseGraph', () => {
  it('accepts the endpoint shape and empty graph', () => {
    expect(parseGraph(response())).toEqual(response());
    expect(parseGraph({ nodes: [], links: [], trails: [] })).toEqual({
      nodes: [],
      links: [],
      trails: [],
    });
  });
  it.each(['nodes', 'links', 'trails'])('rejects missing or non-array %s', key => {
    const data: Record<string, unknown> = response();
    delete data[key];
    expect(() => parseGraph(data)).toThrow('Invalid graph response');
    data[key] = {};
    expect(() => parseGraph(data)).toThrow('Invalid graph response');
  });
  it.each([-1, 2, 0.5, NaN, Infinity, '0', null])(
    'rejects bad indexes %j in links and trails',
    index => {
      expect(() => parseGraph({ ...response(), links: [[index, 1]] })).toThrow(
        'Invalid graph response'
      );
      expect(() => parseGraph({ ...response(), trails: [[0, index, 1]] })).toThrow(
        'Invalid graph response'
      );
    }
  );
  it.each([NaN, Infinity, -Infinity])('rejects non-finite score, heat and weight %j', value => {
    for (const field of ['score', 'heat']) {
      const data = response();
      (data.nodes[0] as Record<string, unknown>)[field] = value;
      expect(() => parseGraph(data)).toThrow('Invalid graph response');
    }
    expect(() => parseGraph({ ...response(), trails: [[0, 1, value]] })).toThrow(
      'Invalid graph response'
    );
  });
  it.each([
    '../a.md',
    '/a.md',
    'notes/../a.md',
    'notes//a.md',
    'notes/.hidden/a.md',
    'notes/a\\b.md',
    'notes/a\u0000.md',
    'notes/a.txt',
    'notes/./a.md',
  ])('rejects unsafe path %j', path => {
    const data = response();
    data.nodes[0].path = path;
    expect(() => parseGraph(data)).toThrow('Invalid graph response');
  });
  it('rejects malformed node fields and edge tuples', () => {
    for (const patch of [
      { title: 1 },
      { type: null },
      { up: '[[B]]' },
      { up: [1] },
      { heat: -1 },
      { heat: 6 },
      { heat: 1.5 },
    ]) {
      const data = response();
      Object.assign(data.nodes[0], patch);
      expect(() => parseGraph(data)).toThrow('Invalid graph response');
    }
    for (const links of [[[0]], [[0, 1, 2]], [null]])
      expect(() => parseGraph({ ...response(), links })).toThrow();
    for (const trails of [[[0, 1]], [[0, 1, 2, 3]], [null]])
      expect(() => parseGraph({ ...response(), trails })).toThrow();
    for (const data of [null, [], 1, 'response', {}])
      expect(() => parseGraph(data)).toThrow('Invalid graph response');
  });
});
