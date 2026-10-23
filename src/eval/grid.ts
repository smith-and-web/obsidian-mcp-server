import { DEFAULT_RANKING, rankingId, type RankingConfig } from '../index/ranking.js';

const weights = [
  [1, 1],
  [1, 2],
  [2, 1],
  [1, 1.5],
  [1.5, 1],
];
const configs: RankingConfig[] = [];
for (const rrfK of [10, 30, 60]) {
  for (const [wVector, wText] of weights) {
    for (const perNoteCap of [0, 2])
      configs.push({ fusion: 'rrf', rrfK, wVector, wText, perNoteCap });
  }
}
for (const [wVector, wText] of weights) {
  for (const perNoteCap of [0, 2])
    configs.push({ fusion: 'dbsf', rrfK: 60, wVector, wText, perNoteCap });
}
const baseline = configs.findIndex(cfg => rankingId(cfg) === rankingId(DEFAULT_RANKING));
export const GRID: RankingConfig[] = [
  configs[baseline],
  ...configs.filter((_, i) => i !== baseline),
];
