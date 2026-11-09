import { parseArgs } from 'util';
import { ApplyStore } from './maintain/applyStore.js';
import { undoChange } from './maintain/undo.js';

const USAGE = 'Usage: node dist/undo.js <change-id> [--dry]';

async function main(): Promise<number> {
  let id: number;
  let dry: boolean;
  try {
    const args = parseArgs({
      strict: true,
      allowPositionals: true,
      options: { dry: { type: 'boolean' } },
    });
    dry = Boolean(args.values.dry);
    if (args.positionals.length !== 1 || !/^\d+$/.test(args.positionals[0])) throw new Error();
    id = Number(args.positionals[0]);
  } catch {
    console.error(USAGE);
    return 2;
  }
  for (const name of ['DATABASE_URL', 'VAULT_PATH'])
    if (!process.env[name]) {
      console.error(`${name} is required`);
      return 2;
    }
  const store = new ApplyStore(
    process.env.DATABASE_URL!,
    process.env.INDEX_COLLECTION || 'default'
  );
  try {
    const outcome = await undoChange(store, process.env.VAULT_PATH!, id, { dry, log: console.log });
    if (outcome.code === 1) console.error(`brain-undo: ${outcome.message}`);
    else if (!dry) console.log(`brain-undo: change ${id} reverted`);
    return outcome.code;
  } finally {
    await store.close();
  }
}
try {
  process.exitCode = await main();
} catch (err) {
  console.error(`brain-undo: ${(err as Error).message}`);
  process.exitCode = 1;
}
