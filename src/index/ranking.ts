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

export function rankingId(cfg: RankingConfig): string {
  const prefix = cfg.fusion === 'rrf' ? `rrf-k${cfg.rrfK}` : 'dbsf';
  return `${prefix}-v${cfg.wVector}-t${cfg.wText}-cap${cfg.perNoteCap}`;
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
