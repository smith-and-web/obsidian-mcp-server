import { describe, it, expect } from 'vitest';
import { buildModel, seededRandom } from '../src/brain-model';
import { layout, BRAIN } from '../src/brain-layout';
import type { GraphResponse } from '../src/graph-parse';

function graph(count: number): GraphResponse {
  const rand = seededRandom(7);
  return {
    nodes: Array.from({ length: count }, (_, i) => ({
      path: `notes/n${i}.md`,
      title: `N${i}`,
      type: i % 20 === 0 ? 'project' : i % 7 === 0 ? 'journal' : '',
      up: [],
      heat: 0,
      score: 0,
    })),
    links: Array.from(
      { length: count * 2 },
      () => [Math.floor(rand() * count), Math.floor(rand() * count)] as [number, number]
    ).filter(([a, b]) => a !== b),
    trails: count > 1 ? [[0, 1, 2.8]] : [],
  };
}
describe('layout', () => {
  it('gives identical positions twice for the same model and seed without mutating it', () => {
    const model = buildModel(graph(80));
    const degrees = model.nodes.map(n => n.deg);
    const a = layout(model);
    const b = layout(model);
    expect(a).toBeInstanceOf(Float32Array);
    expect(a).toEqual(b);
    expect(model.nodes.map(n => n.deg)).toEqual(degrees);
    expect(layout(model, { seed: 9 })).not.toEqual(a);
  });
  it('returns finite xyz positions for each node including a singleton', () => {
    for (const count of [0, 1, 2, 100]) {
      const result = layout(buildModel(graph(count)));
      expect(result.length).toBe(count * 3);
      expect([...result].every(Number.isFinite)).toBe(true);
    }
  });
  it('keeps nodes on a hemisphere side and out of the fissure allowing 3.2 units of relaxation', () => {
    const positions = layout(buildModel(graph(160)));
    const signs = new Set<number>();
    for (let i = 0; i < positions.length; i += 3) {
      signs.add(Math.sign(positions[i]));
      expect(Math.abs(positions[i])).toBeGreaterThanOrEqual(0.04 * BRAIN - 3.2);
    }
    expect(signs).toEqual(new Set([-1, 1]));
  });
  it('respects a 200ms tick budget on a 2,000-node random graph in under 1s', () => {
    const model = buildModel(graph(2000));
    const start = performance.now();
    const positions = layout(model, { budgetMs: 200 });
    const elapsed = performance.now() - start;
    expect(positions.length).toBe(6000);
    expect([...positions].every(Number.isFinite)).toBe(true);
    expect(elapsed).toBeLessThan(1000);
  });
});
