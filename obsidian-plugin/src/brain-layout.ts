import { isHub, seededRandom, type BrainModel } from './brain-model';

/** Radii of the single brain-proportioned volume, in units of BRAIN: front-back, width, height. */
const RZ = 0.95,
  RX = 0.78,
  RY = 0.6,
  FILL = 0.9,
  LIFT = 0.05;
type Vec3 = [number, number, number];
const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const mul = (m: number[][], v: Vec3): Vec3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];
/** Principal axes (largest variance first) of centred points, by deflated power iteration. */
function principalAxes(points: Vec3[]): Vec3[] {
  const m = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const p of points)
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) m[i][j] += (p[i] * p[j]) / points.length;
  const axes: Vec3[] = [];
  for (let k = 0; k < 3; k++) {
    let v = norm([1, 0.7 - k * 0.3, 0.4 + k * 0.2]);
    for (let it = 0; it < 60; it++) v = norm(mul(m, v));
    for (const a of axes) {
      const d = v[0] * a[0] + v[1] * a[1] + v[2] * a[2];
      v = norm([v[0] - d * a[0], v[1] - d * a[1], v[2] - d * a[2]]);
    }
    const mv = mul(m, v);
    const lambda = v[0] * mv[0] + v[1] * mv[1] + v[2] * mv[2];
    axes.push(v);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i][j] -= lambda * v[i] * v[j];
  }
  return axes;
}
export const BRAIN = 190;
export const VOLUME = { rz: RZ * FILL, rx: RX * FILL, ry: RY * FILL, lift: LIFT };
/**
 * Seeded force ticks, then one brain-proportioned volume: the cloud's longest spread runs front to back and the
 * whole layout is fitted into a single ellipsoid, so linked notes are never split into separate halves. The model
 * is never mutated.
 */
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
  const n0 = nodes.length;
  const centre: Vec3 = [0, 0, 0];
  for (const n of nodes) {
    centre[0] += n.x / n0;
    centre[1] += n.y / n0;
    centre[2] += n.z / n0;
  }
  const points = nodes.map(n => [n.x - centre[0], n.y - centre[1], n.z - centre[2]] as Vec3);
  const axes = principalAxes(points);
  // Coordinates along (longest, middle, shortest) become (front-back z, width x, height y).
  const coords = points.map(p => axes.map(a => p[0] * a[0] + p[1] * a[1] + p[2] * a[2]));
  const spread = [0, 1, 2].map(k => {
    const v = coords.map(c => Math.abs(c[k])).sort((x, y) => x - y);
    return v[Math.floor(v.length * 0.95)] || 1;
  });
  coords.forEach((c, i) => {
    const e = [c[0] / spread[0], c[1] / spread[1], c[2] / spread[2]];
    const r = Math.hypot(e[0], e[1], e[2]) + 1e-6;
    const t = Math.pow(Math.min(1, r), 0.7) / r; // soft radial compression; the rim sits at 1
    const n = nodes[i];
    n.z = e[0] * t * RZ * FILL * BRAIN;
    n.x = e[1] * t * RX * FILL * BRAIN;
    n.y = (e[2] * t * RY * FILL + LIFT) * BRAIN;
  });
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
