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
      // One seed's sparse 50-node cloud can leave a gap near 0.18; the two-hemisphere split this guards left ~0.8.
      expect(gap).toBeLessThan(0.3 * BRAIN);
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
  it('keeps hub-heavy groups spread out instead of collapsing them into dense balls', () => {
    // Four projects of 150 notes, each with eight map notes linked to every member (the shape a code-graph ingest
    // produces), plus a link between neighbouring projects. With constant-strength springs a map note summed more
    // pull than one tick absorbs, the simulation overshot, and each group collapsed to ~0.04 of the volume across.
    const groups = 4,
      maps = 8,
      size = 1 + maps + 150;
    const g: GraphResponse = { nodes: [], links: [], trails: [] };
    for (let k = 0; k < groups; k++) {
      const base = k * size;
      for (let i = 0; i < size; i++)
        g.nodes.push({
          path: `notes/p${k}-${i}.md`,
          title: `P${k}-${i}`,
          type: i === 0 ? 'project' : '',
          up: i === 0 ? [] : [`[[p${k}-0]]`],
          heat: 0,
          score: 0,
        });
      for (let m = 1; m <= maps; m++)
        for (let i = 0; i < size; i++) if (i !== m) g.links.push([base + m, base + i]);
      g.links.push([base + size - 1, ((k + 1) % groups) * size + size - 2]);
    }
    const p = layout(buildModel(g));
    for (let k = 0; k < groups; k++) {
      const c = [0, 0, 0];
      for (let i = k * size; i < (k + 1) * size; i++)
        for (let a = 0; a < 3; a++) c[a] += p[i * 3 + a] / size;
      let spread = 0;
      for (let i = k * size; i < (k + 1) * size; i++)
        spread += Math.hypot(p[i * 3] - c[0], p[i * 3 + 1] - c[1], p[i * 3 + 2] - c[2]) / size;
      expect(spread).toBeGreaterThan(0.15 * BRAIN);
    }
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
