import { parseArgs } from 'util';
import { IndexStore } from './index/store.js';
import { readMaintainConfig } from './maintain/config.js';
import { runMaintenance } from './maintain/run.js';

async function main(): Promise<number> {
  let dry: boolean;
  try {
    dry = Boolean(parseArgs({ strict: true, options: { dry: { type: 'boolean' } } }).values.dry);
  } catch {
    console.error('Usage: node dist/maintain.js [--dry]');
    return 2;
  }
  const result = readMaintainConfig(process.env, dry);
  if ('error' in result) {
    console.error(result.error);
    return 2;
  }
  const config = result.config;
  const store = new IndexStore({
    connectionString: config.databaseUrl,
    collection: config.collection,
    readOnly: false,
  });
  try {
    const outcome = await runMaintenance(store, config, { dry, now: new Date(), log: console.log });
    if (outcome.code === 1) console.error(`brain-maintain: ${outcome.message}`);
    return outcome.code;
  } finally {
    await store.close();
  }
}
try {
  process.exitCode = await main();
} catch (err) {
  console.error(`brain-maintain: ${(err as Error).message}`);
  process.exitCode = 1;
}
