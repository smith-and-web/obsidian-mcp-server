import fs from 'fs';
import { parseArgs } from 'util';
import { readIndexConfig } from './index/config.js';
import { IndexStore } from './index/store.js';
import { buildReport } from './learn/report.js';

const USAGE = 'Usage: node dist/learn-report.js --out <file> [--days <n>]';
class InputError extends Error {}

function reportArguments() {
  try {
    const { values } = parseArgs({
      strict: true,
      options: {
        out: { type: 'string' },
        days: { type: 'string', default: '30' },
      },
    });
    const days = Number(values.days);
    if (!values.out || !Number.isInteger(days) || days < 1 || days > 365)
      throw new Error('Invalid arguments');
    return { out: values.out, days };
  } catch (err) {
    throw new InputError(`${(err as Error).message}\n${USAGE}`);
  }
}

function printLeaves(value: unknown, prefix = ''): void {
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === 'trailsShadow' && !prefix) console.log('Trails shadow');
      printLeaves(child, prefix ? `${prefix}.${key}` : key);
    }
  } else console.log(`${prefix}: ${value}`);
}

async function main(): Promise<void> {
  const args = reportArguments();
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (key.startsWith('SEARCH_') || key.startsWith('LEARN_')) env[key] = '';
  const config = readIndexConfig(env);
  if (!config) throw new InputError(`DATABASE_URL is required\n${USAGE}`);
  const store = new IndexStore({
    connectionString: config.databaseUrl,
    collection: config.collection,
    readOnly: true,
  });
  try {
    const serverVersion = JSON.parse(
      fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ).version as string;
    const report = await buildReport(store, args.days, serverVersion);
    fs.writeFileSync(args.out, JSON.stringify(report, null, 2) + '\n');
    printLeaves(report);
    console.log(`VOLUME GATE: ${report.volumeGate}`);
  } finally {
    await store.close();
  }
}

try {
  await main();
} catch (err) {
  console.error(`learn-report: ${(err as Error).message}`);
  process.exitCode = err instanceof InputError ? 2 : 1;
}
