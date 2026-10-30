import { parseArgs } from 'util';
import { IndexStore } from './index/store.js';
import { readTrailsConfig } from './trails/config.js';
import { runTrails } from './trails/run.js';
async function main(): Promise<number> {
  let dry: boolean, clearHeat: boolean;
  try {
    const args = parseArgs({
      strict: true,
      options: { dry: { type: 'boolean' }, 'clear-heat': { type: 'boolean' } },
    }).values;
    dry = Boolean(args.dry);
    clearHeat = Boolean(args['clear-heat']);
    if (dry && clearHeat) throw new Error('exclusive modes');
  } catch {
    console.error('Usage: node dist/trails.js [--dry | --clear-heat]');
    return 2;
  }
  const result = readTrailsConfig(process.env);
  if ('error' in result) {
    console.error(result.error);
    return 2;
  }
  const store = new IndexStore({
    connectionString: result.config.databaseUrl,
    collection: result.config.collection,
  });
  try {
    const outcome = await runTrails(store, result.config, {
      dry,
      clearHeat,
      now: new Date(),
      log: console.log,
    });
    if (outcome.message) console.error(outcome.message);
    return outcome.code;
  } finally {
    await store.close();
  }
}
try {
  process.exitCode = await main();
} catch (err) {
  console.error(`brain-trails: ${(err as Error).message}`);
  process.exitCode = 1;
}
