import fs from 'fs';
import { createHash } from 'crypto';
import { parseArgs } from 'util';
import { readIndexConfig } from './index/config.js';
import { createEmbedder } from './index/embedder.js';
import { IndexStore } from './index/store.js';
import {
  DEFAULT_RANKING,
  parseRankingEnv,
  parseTrailsEnv,
  type TrailsConfig,
  rankingEnv,
  rankingId,
  type RankingConfig,
} from './index/ranking.js';
import { CATEGORIES, loadGolden } from './eval/golden.js';
import {
  aggregate,
  gate,
  scoreQuery,
  selectWinner,
  winnerOrder,
  type Evaluation,
  type Metrics,
} from './eval/metrics.js';
import { GRID } from './eval/grid.js';

const USAGE = "Usage: node dist/eval.js --golden <file> --out <file> (--grid | --config '<json>')";
class InputError extends Error {}

function argumentsForEval() {
  try {
    const { values } = parseArgs({
      strict: true,
      options: {
        golden: { type: 'string' },
        out: { type: 'string' },
        grid: { type: 'boolean' },
        config: { type: 'string' },
      },
    });
    if (!values.golden || !values.out || !!values.grid === (values.config !== undefined))
      throw new Error(USAGE);
    let ranking: RankingConfig | undefined;
    let trails: TrailsConfig | undefined;
    if (values.config !== undefined) {
      const obj: unknown = JSON.parse(values.config);
      if (obj === null || typeof obj !== 'object' || Array.isArray(obj))
        throw new Error('--config must be a JSON object');
      const fields = obj as Record<string, unknown>;
      if (Object.hasOwn(fields, 'trails')) {
        const value = fields.trails;
        delete fields.trails;
        if (value === null || typeof value !== 'object' || Array.isArray(value))
          throw new Error('Invalid --config trails: expected an object with w and anchors');
        const options = value as Record<string, unknown>;
        if (
          Object.keys(options).length !== 2 ||
          typeof options.w !== 'number' ||
          typeof options.anchors !== 'number'
        )
          throw new Error('Invalid --config trails: expected numeric w and anchors only');
        try {
          trails = parseTrailsEnv({
            SEARCH_TRAILS: 'on',
            SEARCH_TRAILS_W: String(options.w),
            SEARCH_TRAILS_ANCHORS: String(options.anchors),
          });
        } catch (err) {
          throw new Error(
            `Invalid --config trails: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
      for (const [key, value] of Object.entries(obj)) {
        if (
          !Object.hasOwn(DEFAULT_RANKING, key) ||
          typeof value !== (key === 'fusion' ? 'string' : 'number')
        ) {
          throw new Error(`Invalid --config field: ${key}`);
        }
      }
      ranking = parseRankingEnv(rankingEnv({ ...DEFAULT_RANKING, ...obj }));
    }
    return { golden: values.golden, out: values.out, grid: values.grid, ranking, trails };
  } catch (err) {
    throw new InputError(`${err instanceof Error ? err.message : String(err)}\n${USAGE}`);
  }
}

function rounded(metrics: Metrics) {
  const round = (value: number) => Math.round(value * 10000) / 10000;
  return {
    mrr: round(metrics.mrr),
    recall5: round(metrics.recall5),
    ndcg8: round(metrics.ndcg8),
    distinctNotes: round(metrics.distinctNotes),
    byCategory: Object.fromEntries(
      CATEGORIES.flatMap(category => {
        const values = metrics.byCategory[category];
        return values
          ? [
              [
                category,
                {
                  n: values.n,
                  mrr: round(values.mrr),
                  recall5: round(values.recall5),
                  ndcg8: round(values.ndcg8),
                },
              ],
            ]
          : [];
      })
    ),
  };
}

async function main(): Promise<void> {
  const args = argumentsForEval();
  let golden;
  try {
    golden = loadGolden(args.golden);
  } catch (err) {
    throw new InputError(err instanceof Error ? err.message : String(err));
  }
  const config = readIndexConfig({
    ...process.env,
    SEARCH_FUSION: '',
    SEARCH_RRF_K: '',
    SEARCH_W_VECTOR: '',
    SEARCH_W_TEXT: '',
    SEARCH_PER_NOTE_CAP: '',
    SEARCH_TRAILS: '',
    SEARCH_TRAILS_W: '',
    SEARCH_TRAILS_ANCHORS: '',
  });
  if (!config) throw new InputError('DATABASE_URL is required');
  const embedder = await createEmbedder(config.embedder);
  const store = new IndexStore({
    connectionString: config.databaseUrl,
    collection: config.collection,
    readOnly: true,
  });
  try {
    const meta = await store.getMeta();
    if (meta.embed_model !== embedder.model || meta.dim !== String(embedder.dim)) {
      throw new InputError(
        `Index model ${meta.embed_model} (dim ${meta.dim}) does not match ${embedder.model} (dim ${embedder.dim})`
      );
    }
    const missing: string[] = [];
    const expectedPaths = new Set(golden.queries.flatMap(q => q.expected));
    for (const path of expectedPaths) if (!(await store.hasDocument(path))) missing.push(path);
    if (missing.length) throw new InputError(`Missing expected paths:\n${missing.join('\n')}`);
    const vectors: number[][] = [];
    for (const query of golden.queries)
      vectors.push((await embedder.embed([query.query.trim()]))[0]);
    const baselineId = rankingId(DEFAULT_RANKING);
    const configs: { ranking: RankingConfig; trails?: TrailsConfig }[] = args.grid
      ? GRID.map(ranking => ({ ranking }))
      : [
          { ranking: DEFAULT_RANKING },
          ...(args.trails || rankingId(args.ranking!) !== baselineId
            ? [{ ranking: args.ranking!, trails: args.trails }]
            : []),
        ];
    const results: Evaluation[] = [];
    for (const { ranking, trails } of configs) {
      const perQuery = [];
      for (const [i, query] of golden.queries.entries()) {
        const { results: hits } = await store.searchRanked(vectors[i], query.query.trim(), {
          k: 8,
          mode: 'hybrid',
          ranking,
          trails,
        });
        const notes = [...new Set(hits.map(hit => hit.path))];
        perQuery.push({ id: query.id, notes, ...scoreQuery(notes, query.expected) });
      }
      const result: Evaluation = {
        id: rankingId(ranking, trails),
        config: ranking,
        metrics: aggregate(perQuery, golden),
        perQuery: perQuery.map(({ id, firstRank, notes }) => ({ id, firstRank, notes })),
        gate: { pass: false, reasons: ['baseline'] },
      };
      if (result.id !== baselineId) result.gate = gate(result, results[0]);
      results.push(result);
    }
    const selection = selectWinner(results, baselineId);
    const winner = results.find(result => result.id === selection.id)!;
    const report = {
      version: 1,
      ranAt: new Date().toISOString(),
      serverVersion: JSON.parse(
        fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
      ).version as string,
      collection: config.collection,
      embedModel: embedder.model,
      golden: {
        file: args.golden,
        sha256: createHash('sha256').update(fs.readFileSync(args.golden)).digest('hex'),
        queries: golden.queries.length,
      },
      baseline: baselineId,
      configs: results.map(result => ({ ...result, metrics: rounded(result.metrics) })),
      winner: { ...selection, config: winner.config, env: rankingEnv(winner.config) },
    };
    fs.writeFileSync(args.out, JSON.stringify(report, null, 2) + '\n');
    for (const result of [...results].sort(winnerOrder)) {
      console.log(
        [
          result.id,
          ...(['mrr', 'recall5', 'ndcg8', 'distinctNotes'] as const).map(key =>
            result.metrics[key].toFixed(4)
          ),
          result.gate.pass ? 'PASS' : 'fail',
        ].join('  ')
      );
    }
    console.log('category  baseline.mrr  baseline.recall5  winner.mrr  winner.recall5');
    for (const category of CATEGORIES) {
      const base = results[0].metrics.byCategory[category];
      const chosen = winner.metrics.byCategory[category];
      if (base && chosen)
        console.log(
          [category, base.mrr, base.recall5, chosen.mrr, chosen.recall5]
            .map(value => (typeof value === 'number' ? value.toFixed(4) : value))
            .join('  ')
        );
    }
    console.log(`WINNER: ${winner.id} (${selection.changed ? 'changed' : 'no change'})`);
  } finally {
    await store.close();
  }
}

try {
  await main();
} catch (err) {
  console.error(`brain-eval: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = err instanceof InputError ? 2 : 1;
}
