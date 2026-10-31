import { describe, it, expect } from 'vitest';
import { buildModel, seededRandom } from '../src/brain-model';
import { layout, BRAIN, VOLUME } from '../src/brain-layout';
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
  it('keeps every node inside one brain-proportioned volume, allowing 3.2 units of relaxation', () => {
    const positions = layout(buildModel(graph(160)));
    const slack = 3.2 / (VOLUME.ry * BRAIN);
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i] / (VOLUME.rx * BRAIN),
        y = (positions[i + 1] - VOLUME.lift * BRAIN) / (VOLUME.ry * BRAIN),
        z = positions[i + 2] / (VOLUME.rz * BRAIN);
      expect(Math.hypot(x, y, z)).toBeLessThanOrEqual(1 + slack);
    }
  });
  it('does not split a densely linked cluster into two sides', () => {
    const count = 50;
    const g: GraphResponse = {
      nodes: Array.from({ length: count }, (_, i) => ({
        path: `notes/c${i}.md`,
        title: `C${i}`,
        type: i === 0 ? 'project' : '',
        up: [],
        heat: 0,
        score: 0,
      })),
      links: [],
      trails: [],
    };
    for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j += 3) g.links.push([i, j]);
    const positions = layout(buildModel(g));
    for (const axis of [0, 1, 2]) {
      const v: number[] = [];
      for (let i = axis; i < positions.length; i += 3) v.push(positions[i]);
      v.sort((a, b) => a - b);
      let gap = 0;
      for (let i = 1; i < v.length; i++) gap = Math.max(gap, v[i] - v[i - 1]);
      expect(gap).toBeLessThan(0.15 * BRAIN);
    }
  });
  it('keeps linked notes closer than unlinked ones', () => {
    const size = 40;
    const g: GraphResponse = {
      nodes: Array.from({ length: size * 2 }, (_, i) => ({
        path: `notes/g${i}.md`,
        title: `G${i}`,
        type: i % size === 0 ? 'project' : '',
        up: [],
        heat: 0,
        score: 0,
      })),
      links: [[0, size]],
      trails: [],
    };
    for (const base of [0, size])
      for (let i = 0; i < size; i++)
        for (let j = i + 1; j < size; j += 4) g.links.push([base + i, base + j]);
    const p = layout(buildModel(g));
    const dist = (a: number, b: number) =>
      Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
    let inside = 0,
      across = 0,
      ni = 0,
      na = 0;
    for (let a = 0; a < size * 2; a++)
      for (let b = a + 1; b < size * 2; b++) {
        if (Math.floor(a / size) === Math.floor(b / size)) {
          inside += dist(a, b);
          ni++;
        } else {
          across += dist(a, b);
          na++;
        }
      }
    expect(inside / ni).toBeLessThan(0.7 * (across / na));
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
