import type { GraphNode, GraphResponse } from './graph-parse';

export interface BrainNode extends GraphNode {
  i: number;
  deg: number;
  lobe: BrainNode | null;
  paletteIndex: number | null;
}
export interface BrainEdge {
  a: BrainNode;
  b: BrainNode;
}
export interface BrainTrail extends BrainEdge {
  w: number;
  next: number;
}
export interface BrainModel {
  nodes: BrainNode[];
  links: BrainEdge[];
  trails: BrainTrail[];
  neighbours: Map<BrainNode, Set<BrainNode>>;
  lobesBySize: BrainNode[];
  lobeColor: Map<BrainNode, string>;
  maxW: number;
}
export const PALETTE = [
  '#7aa2ff',
  '#c792ea',
  '#5ee0c8',
  '#ffb38a',
  '#f78fb3',
  '#9be38a',
  '#ffd97a',
  '#8fd3ff',
  '#b6a6ff',
  '#ff9e9e',
  '#7fe6a8',
  '#e0b0ff',
  '#a3c4ff',
  '#ffc4a3',
  '#94f0e0',
  '#d6e38a',
  '#c4c4ff',
  '#ffaedd',
  '#a0e8ff',
  '#e6c08f',
  '#b0ffd0',
  '#ffcf9e',
  '#c0a8ff',
  '#9ec8b0',
];
export const LOOSE = '#8590c0';
export const isHub = (n: Pick<GraphNode, 'type'>): boolean =>
  n.type === 'project' || n.type === 'area';
export function seededRandom(initialSeed = 20261030): () => number {
  let seed = initialSeed;
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
}
/** Build the prototype's graph and hub assignment without any rendering objects. */
export function buildModel(graph: GraphResponse): BrainModel {
  const byBase = new Map<string, BrainNode>();
  const nodes = graph.nodes.map((n, i): BrainNode => {
    const node = { ...n, up: [...n.up], i, deg: 0, lobe: null, paletteIndex: null };
    byBase.set(n.path.split('/').pop()!.replace(/\.md$/, ''), node);
    byBase.set(n.path.replace(/\.md$/, ''), node);
    return node;
  });
  const links = graph.links.map(([a, b]) => ({ a: nodes[a], b: nodes[b] }));
  links.forEach(l => {
    l.a.deg++;
    l.b.deg++;
  });
  const rand = seededRandom();
  const trails = graph.trails.map(([a, b, w]) => ({
    a: nodes[a],
    b: nodes[b],
    w,
    next: rand() * 4,
  }));
  const neighbours = new Map(nodes.map(n => [n, new Set<BrainNode>()]));
  for (const e of [...links, ...trails]) {
    neighbours.get(e.a)!.add(e.b);
    neighbours.get(e.b)!.add(e.a);
  }
  const hubs = nodes.filter(isHub);
  for (const n of nodes) {
    if (isHub(n)) {
      n.lobe = n;
      continue;
    }
    let hub: BrainNode | null = null;
    for (const u of n.up) {
      const m = /\[\[([^\]|#]+)/.exec(u);
      const h = m && byBase.get(m[1]);
      if (h && isHub(h)) {
        hub = h;
        break;
      }
    }
    if (!hub) {
      let best = 0;
      for (const h of neighbours.get(n)!)
        if (isHub(h)) {
          const c = [...neighbours.get(h)!].filter(x => neighbours.get(n)!.has(x)).length + 1;
          if (c > best) {
            best = c;
            hub = h;
          }
        }
    }
    n.lobe = hub;
  }
  const lobeSize = new Map(hubs.map(h => [h, 0]));
  nodes.forEach(n => {
    if (n.lobe) lobeSize.set(n.lobe, lobeSize.get(n.lobe)! + 1);
  });
  const lobesBySize = [...lobeSize.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  const lobeColor = new Map(lobesBySize.map((h, i) => [h, PALETTE[i % PALETTE.length]]));
  const indexes = new Map(lobesBySize.map((h, i) => [h, i % PALETTE.length]));
  nodes.forEach(n => {
    if (n.lobe) n.paletteIndex = indexes.get(n.lobe)!;
  });
  return {
    nodes,
    links,
    trails,
    neighbours,
    lobesBySize,
    lobeColor,
    maxW: Math.max(1, ...trails.map(t => t.w)),
  };
}
