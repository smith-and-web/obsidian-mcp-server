import { isHub, seededRandom, type BrainModel } from './brain-model';

const HEMI = [
  { c: [-0.34, 0.06, 0.02], r: [0.4, 0.56, 0.86] },
  { c: [0.34, 0.06, 0.02], r: [0.4, 0.56, 0.86] },
];
const inEll = (p: number[], e: { c: number[]; r: number[] }, pad = 1): boolean => {
  let s = 0;
  for (let k = 0; k < 3; k++) {
    const d = (p[k] - e.c[k]) / (e.r[k] * pad);
    s += d * d;
  }
  return s <= 1;
};
const inCerebrum = (p: number[]): boolean =>
  p[1] > -0.42 + 0.18 * Math.max(0, p[2] + 0.2) && HEMI.some(h => inEll(p, h));
export const BRAIN = 190;
/** Seeded force ticks and the approved two-hemisphere warp. The model is never mutated. */
export function layout(
  model: BrainModel,
  { seed = 20261030, budgetMs = 2500 }: { seed?: number; budgetMs?: number } = {}
): Float32Array {
  if (!model.nodes.length) return new Float32Array();
  const start = performance.now();
  const rand = seededRandom(seed);
  // The prototype initializes trail timers before seeding positions.
  model.trails.forEach(() => rand());
  const nodes = model.nodes.map(n => ({
    type: n.type,
    i: n.i,
    lobe: n.lobe?.i ?? null,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
  }));
  const links = model.links.map(l => ({ a: nodes[l.a.i], b: nodes[l.b.i] }));
  nodes.forEach(n => {
    const u = rand() * 2 - 1,
      th = rand() * Math.PI * 2,
      r = Math.cbrt(rand()) * 120;
    n.x = Math.sqrt(1 - u * u) * Math.cos(th) * r;
    n.y = u * r;
    n.z = Math.sqrt(1 - u * u) * Math.sin(th) * r;
  });
  function tick(alpha: number): void {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = b.x - a.x,
          dy = b.y - a.y,
          dz = b.z - a.z;
        const d2 = dx * dx + dy * dy + dz * dz + 0.01;
        if (d2 > 160000) continue;
        const s = ((isHub(a) || isHub(b) ? 900 : 260) * alpha) / d2;
        a.vx -= dx * s;
        a.vy -= dy * s;
        a.vz -= dz * s;
        b.vx += dx * s;
        b.vy += dy * s;
        b.vz += dz * s;
      }
    }
    for (const l of links) {
      const dx = l.b.x - l.a.x,
        dy = l.b.y - l.a.y,
        dz = l.b.z - l.a.z,
        d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01;
      const k = ((d - 26) / d) * 0.025 * alpha;
      l.a.vx += dx * k;
      l.a.vy += dy * k;
      l.a.vz += dz * k;
      l.b.vx -= dx * k;
      l.b.vy -= dy * k;
      l.b.vz -= dz * k;
    }
    for (const n of nodes) {
      const lobe = n.lobe === null ? null : nodes[n.lobe];
      if (lobe && lobe !== n) {
        const k = 0.012 * alpha;
        n.vx += (lobe.x - n.x) * k;
        n.vy += (lobe.y - n.y) * k;
        n.vz += (lobe.z - n.z) * k;
      }
      n.vx -= n.x * 0.004 * alpha;
      n.vy -= n.y * 0.004 * alpha;
      n.vz -= n.z * 0.004 * alpha;
      n.x += n.vx;
      n.y += n.vy;
      n.z += n.vz;
      n.vx *= 0.6;
      n.vy *= 0.6;
      n.vz *= 0.6;
    }
  }
  for (let i = 0; i < 320 && performance.now() - start < budgetMs; i++) tick(1 - i / 340);
  const cx = nodes.reduce((s, n) => s + n.x, 0) / nodes.length,
    cy = nodes.reduce((s, n) => s + n.y, 0) / nodes.length,
    cz = nodes.reduce((s, n) => s + n.z, 0) / nodes.length;
  const rs = nodes.map(n => Math.hypot(n.x - cx, n.y - cy, n.z - cz)).sort((a, b) => a - b);
  const r95 = rs[Math.floor(rs.length * 0.95)];
  for (const n of nodes) {
    let dx = n.x - cx,
      dy = n.y - cy,
      dz = n.z - cz;
    const r = Math.hypot(dx, dy, dz) + 1e-6;
    dx /= r;
    dy /= r;
    dz /= r;
    const h = dx < 0 ? HEMI[0] : HEMI[1];
    let R = 0;
    while (
      R < 1.4 &&
      inCerebrum([h.c[0] + dx * (R + 0.01), h.c[1] + dy * (R + 0.01), h.c[2] + dz * (R + 0.01)])
    )
      R += 0.01;
    const t = Math.pow(Math.min(1, r / r95), 0.55);
    const gap = Math.sign(dx || 1) * 0.04;
    n.x = (h.c[0] + gap + dx * R * 0.86 * t) * BRAIN;
    n.y = (h.c[1] + dy * R * 0.86 * t) * BRAIN;
    n.z = (h.c[2] + dz * R * 0.86 * t) * BRAIN;
  }
  for (let it = 0; it < 30; it++)
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i],
          b = nodes[j];
        const dx = b.x - a.x,
          dy = b.y - a.y,
          dz = b.z - a.z,
          min = 3.2;
        // A pair separated by min on any axis cannot overlap. Keep the exact
        // prototype distance and relaxation for every possible overlap.
        if (Math.abs(dx) >= min || Math.abs(dy) >= min || Math.abs(dz) >= min) continue;
        const d = Math.hypot(dx, dy, dz) + 1e-6;
        if (d < min) {
          const s = ((min - d) / d) * 0.5;
          a.x -= dx * s;
          a.y -= dy * s;
          a.z -= dz * s;
          b.x += dx * s;
          b.y += dy * s;
          b.z += dz * s;
        }
      }
  return new Float32Array(nodes.flatMap(n => [n.x, n.y, n.z]));
}
