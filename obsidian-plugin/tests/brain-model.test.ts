import { describe, it, expect } from 'vitest';
import { buildModel, PALETTE, LOOSE, isHub } from '../src/brain-model';
import type { GraphResponse, GraphNode } from '../src/graph-parse';

const node = (name: string, type = '', up: string[] = []): GraphNode => ({
  path: `notes/${name}.md`,
  title: name,
  type,
  up,
  heat: 0,
  score: 0,
});
const graph = (
  nodes: GraphNode[],
  links: [number, number][] = [],
  trails: [number, number, number][] = []
): GraphResponse => ({ nodes, links, trails });
describe('buildModel', () => {
  it('uses the first resolving up hub before shared neighbours, by basename or path', () => {
    for (const up of [
      ['[[missing]]', '[[a]]', '[[b]]'],
      ['[[notes/a#section|label]]', '[[b]]'],
    ]) {
      const model = buildModel(
        graph(
          [node('a', 'project'), node('b', 'area'), node('child', '', up), node('peer')],
          [
            [2, 1],
            [2, 3],
            [1, 3],
          ]
        )
      );
      expect(model.nodes[2].lobe).toBe(model.nodes[0]);
    }
  });
  it('selects the neighbouring hub with the most shared neighbours', () => {
    const model = buildModel(
      graph(
        [node('a', 'project'), node('b', 'area'), node('child'), node('peer')],
        [
          [2, 0],
          [2, 1],
          [2, 3],
          [1, 3],
        ]
      )
    );
    expect(model.nodes[2].lobe).toBe(model.nodes[1]);
  });
  it('breaks a shared-neighbour tie by prototype neighbour insertion order', () => {
    const model = buildModel(
      graph(
        [node('a', 'project'), node('b', 'area'), node('child')],
        [
          [2, 1],
          [2, 0],
        ]
      )
    );
    expect(model.nodes[2].lobe).toBe(model.nodes[1]);
  });
  it('hubs are their own lobe even with an up to another hub; a loose journal has none', () => {
    const model = buildModel(
      graph([node('a', 'project', ['[[b]]']), node('b', 'area'), node('day', 'journal')])
    );
    expect(model.nodes[0].lobe).toBe(model.nodes[0]);
    expect(model.nodes[1].lobe).toBe(model.nodes[1]);
    expect(model.nodes[2].lobe).toBeNull();
    expect(model.nodes[2].paletteIndex).toBeNull();
    expect(isHub(model.nodes[2])).toBe(false);
    expect(LOOSE).toBe('#8590c0');
  });
  it('orders palette colours by lobe size, preserving input order for equal sizes', () => {
    const model = buildModel(
      graph([
        node('a', 'project'),
        node('b', 'area'),
        node('x', '', ['[[b]]']),
        node('y', '', ['[[b]]']),
        node('c', 'area'),
      ])
    );
    expect(model.lobesBySize.map(n => n.title)).toEqual(['b', 'a', 'c']);
    expect(model.lobeColor.get(model.nodes[1])).toBe(PALETTE[0]);
    expect(model.lobeColor.get(model.nodes[0])).toBe(PALETTE[1]);
    expect(model.nodes[2].paletteIndex).toBe(0);
  });
  it('includes trails in neighbours, preserves weights, and counts degree from links only', () => {
    const source = graph([node('a', 'project'), node('b'), node('c')], [[0, 1]], [[1, 2, 2.8]]);
    const snapshot = structuredClone(source);
    const model = buildModel(source);
    expect(model.neighbours.get(model.nodes[1])).toEqual(new Set([model.nodes[0], model.nodes[2]]));
    expect(model.nodes.map(n => n.deg)).toEqual([1, 1, 0]);
    expect(model.trails[0].w).toBe(2.8);
    expect(model.maxW).toBe(2.8);
    expect(source).toEqual(snapshot);
    expect(buildModel(source).trails[0].next).toBe(model.trails[0].next);
  });
  it('handles an empty graph', () => {
    const model = buildModel(graph([]));
    expect(model.nodes).toEqual([]);
    expect(model.lobesBySize).toEqual([]);
    expect(model.maxW).toBe(1);
  });
});
