/** Pure ranking configuration and fusion shared by search and offline evaluation. */
export type Fusion = 'rrf' | 'dbsf';

export interface RankingConfig {
  fusion: Fusion;
  rrfK: number;
  wVector: number;
  wText: number;
  perNoteCap: number;
}

export const DEFAULT_RANKING: RankingConfig = {
  fusion: 'rrf',
  rrfK: 60,
  wVector: 1,
  wText: 1,
  perNoteCap: 0,
};

/** One leg's hit; rank is 1-based within the leg. */
export interface LegHit {
  id: number;
  documentId: number;
  ord: number;
  rank: number;
  score: number;
}

export interface FusedHit {
  id: number;
  documentId: number;
  ord: number;
  fused: number;
  vectorRank: number | null;
  textRank: number | null;
}

function normalise(leg: LegHit[]): Map<number, number> {
  if (!leg.length) return new Map();
  const mean = leg.reduce((sum, hit) => sum + hit.score, 0) / leg.length;
  const sigma = Math.sqrt(leg.reduce((sum, hit) => sum + (hit.score - mean) ** 2, 0) / leg.length);
  return new Map(
    leg.map(hit => [
      hit.id,
      sigma === 0 ? 1 : Math.max(0, Math.min(1, (hit.score - (mean - 3 * sigma)) / (6 * sigma))),
    ])
  );
}

export function fuse(vector: LegHit[], text: LegHit[], cfg: RankingConfig): FusedHit[] {
  const hits = new Map<number, FusedHit>();
  const vectorScores = cfg.fusion === 'dbsf' ? normalise(vector) : new Map<number, number>();
  const textScores = cfg.fusion === 'dbsf' ? normalise(text) : new Map<number, number>();
  for (const [leg, weight, scores, rankKey] of [
    [vector, cfg.wVector, vectorScores, 'vectorRank'],
    [text, cfg.wText, textScores, 'textRank'],
  ] as const) {
    for (const hit of leg) {
      let fused = hits.get(hit.id);
      if (!fused) {
        fused = {
          id: hit.id,
          documentId: hit.documentId,
          ord: hit.ord,
          fused: 0,
          vectorRank: null,
          textRank: null,
        };
        hits.set(hit.id, fused);
      }
      fused[rankKey] = hit.rank;
      fused.fused +=
        cfg.fusion === 'rrf' ? weight / (cfg.rrfK + hit.rank) : weight * scores.get(hit.id)!;
    }
  }
  return [...hits.values()].sort((a, b) => b.fused - a.fused || a.ord - b.ord || a.id - b.id);
}

export function capPerNote(hits: FusedHit[], cap: number): FusedHit[] {
  if (cap === 0) return hits;
  const counts = new Map<number, number>();
  return hits.filter(hit => {
    const count = counts.get(hit.documentId) ?? 0;
    if (count >= cap) return false;
    counts.set(hit.documentId, count + 1);
    return true;
  });
}

export function rankingId(cfg: RankingConfig, trails?: TrailsConfig): string {
  const prefix = cfg.fusion === 'rrf' ? `rrf-k${cfg.rrfK}` : 'dbsf';
  return `${prefix}-v${cfg.wVector}-t${cfg.wText}-cap${cfg.perNoteCap}${trails?.mode === 'on' ? `-tr${trails.w}a${trails.anchors}` : ''}`;
}

export function rankingEnv(cfg: RankingConfig): Record<string, string> {
  return {
    SEARCH_FUSION: cfg.fusion,
    SEARCH_RRF_K: String(cfg.rrfK),
    SEARCH_W_VECTOR: String(cfg.wVector),
    SEARCH_W_TEXT: String(cfg.wText),
    SEARCH_PER_NOTE_CAP: String(cfg.perNoteCap),
  };
}

export function parseRankingEnv(env: NodeJS.ProcessEnv): RankingConfig {
  const fusion = env.SEARCH_FUSION || 'rrf';
  if (fusion !== 'rrf' && fusion !== 'dbsf') {
    throw new Error(`Invalid SEARCH_FUSION=${fusion}: expected rrf or dbsf`);
  }
  const number = (name: string, fallback: number, min: number, max: number, integer = false) => {
    const raw = env[name];
    const value = raw === undefined || raw === '' ? fallback : Number(raw);
    if (
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (integer && !Number.isInteger(value))
    ) {
      const allowed = integer
        ? `an integer from ${min} to ${max}`
        : `a number from ${min} to ${max}`;
      throw new Error(`Invalid ${name}=${raw}: expected ${allowed}`);
    }
    return value;
  };
  const config: RankingConfig = {
    fusion,
    rrfK: number('SEARCH_RRF_K', 60, 1, 1000, true),
    wVector: number('SEARCH_W_VECTOR', 1, 0, 10),
    wText: number('SEARCH_W_TEXT', 1, 0, 10),
    perNoteCap: number('SEARCH_PER_NOTE_CAP', 0, 0, 8, true),
  };
  if (config.wVector === 0 && config.wText === 0) {
    throw new Error('Invalid SEARCH_W_VECTOR/SEARCH_W_TEXT: both are 0');
  }
  return config;
}

export interface TrailsConfig {
  mode: 'off' | 'shadow' | 'on';
  w: number;
  anchors: number;
}

export const DEFAULT_TRAILS: TrailsConfig = { mode: 'off', w: 0.5, anchors: 3 };

/** Validate trails independently of the existing fusion configuration. */
export function parseTrailsEnv(env: NodeJS.ProcessEnv): TrailsConfig {
  const mode = env.SEARCH_TRAILS || 'off';
  if (mode !== 'off' && mode !== 'shadow' && mode !== 'on')
    throw new Error(`Invalid SEARCH_TRAILS=${mode}: expected off, shadow or on`);
  const rawW = env.SEARCH_TRAILS_W;
  const w = rawW === undefined || rawW === '' ? DEFAULT_TRAILS.w : Number(rawW);
  if (!Number.isFinite(w) || w <= 0 || w > 10)
    throw new Error(
      `Invalid SEARCH_TRAILS_W=${rawW}: expected a number greater than 0 and at most 10`
    );
  const rawAnchors = env.SEARCH_TRAILS_ANCHORS;
  const anchors =
    rawAnchors === undefined || rawAnchors === '' ? DEFAULT_TRAILS.anchors : Number(rawAnchors);
  if (!Number.isInteger(anchors) || anchors < 1 || anchors > 8)
    throw new Error(`Invalid SEARCH_TRAILS_ANCHORS=${rawAnchors}: expected an integer from 1 to 8`);
  return { mode, w, anchors };
}

/** Boost existing candidates using trails to the first distinct anchor notes. */
export function trailsRerank<T extends { documentId: number; fused: number }>(
  hits: T[],
  weight: (a: number, b: number) => number,
  opts: { w: number; anchors: number; rrfK: number }
): T[] {
  const documents = [...new Set(hits.map(hit => hit.documentId))];
  const anchors = documents.slice(0, opts.anchors);
  const totals = new Map(
    documents.map(n => [n, anchors.reduce((sum, a) => sum + (a === n ? 0 : weight(a, n)), 0)])
  );
  const trailOrder = documents
    .filter(n => totals.get(n)! > 0)
    .sort((a, b) => totals.get(b)! - totals.get(a)!);
  const ranks = new Map(trailOrder.map((n, i) => [n, i + 1]));
  return hits
    .map((hit, position) => ({
      hit: {
        ...hit,
        fused:
          hit.fused +
          (ranks.has(hit.documentId) ? opts.w / (opts.rrfK + ranks.get(hit.documentId)!) : 0),
      },
      position,
    }))
    .sort((a, b) => b.hit.fused - a.hit.fused || a.position - b.position)
    .map(({ hit }) => hit);
}
