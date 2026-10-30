import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import { parseArgs } from 'util';
import { isDeepStrictEqual } from 'util';
import { IndexStore } from './index/store.js';
import { sha256 } from './index/scanner.js';
import { confinedNotePath } from './vault/confinedPath.js';
import { atomicFrontmatterEdit } from './vault/atomicEdit.js';
import { parseFrontmatter, setFrontmatterField } from './vault/frontmatter.js';

export interface BackfillOptions {
  plan: string;
  apply: boolean;
  revert: boolean;
  field: string;
  hubTypes: string[];
  childTypes: string[];
  max: number;
}
interface PlanEntry {
  path: string;
  sha256: string;
  value: string[];
}
interface Plan {
  version: 1;
  createdAt: string;
  field: string;
  entries: PlanEntry[];
  noHub: string[];
  reformat: string[];
  alreadySet: number;
}
export function readBackfillOptions(
  args: string[]
): { options: BackfillOptions } | { error: string } {
  try {
    const v = parseArgs({
      args,
      strict: true,
      options: {
        plan: { type: 'string' },
        apply: { type: 'boolean' },
        revert: { type: 'boolean' },
        field: { type: 'string', default: 'up' },
        'hub-types': { type: 'string', default: 'project,area' },
        'child-types': { type: 'string', default: 'reference,decision,plan' },
        max: { type: 'string', default: '3' },
      },
    }).values;
    if (
      !v.plan ||
      (v.apply && v.revert) ||
      !/^[A-Za-z0-9_-]+$/.test(v.field!) ||
      !/^\d+$/.test(v.max!) ||
      Number(v.max) < 1 ||
      Number(v.max) > 10
    )
      return {
        error:
          'Usage: node dist/backfill-up.js --plan <file> [--apply | --revert] [--field <key>] [--hub-types <list>] [--child-types <list>] [--max <1-10>]',
      };
    const list = (text: string) =>
      text
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    return {
      options: {
        plan: v.plan,
        apply: Boolean(v.apply),
        revert: Boolean(v.revert),
        field: v.field!,
        hubTypes: list(v['hub-types']!),
        childTypes: list(v['child-types']!),
        max: Number(v.max),
      },
    };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
async function basenames(root: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const walk = async (dir: string): Promise<void> => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) await walk(abs);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        const name = e.name.slice(0, -3).toLowerCase();
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
  };
  await walk(root);
  return counts;
}
function validatePlan(raw: unknown): Plan {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid backfill plan');
  const p = raw as Plan;
  if (
    p.version !== 1 ||
    typeof p.field !== 'string' ||
    !/^[A-Za-z0-9_-]+$/.test(p.field) ||
    !Array.isArray(p.entries) ||
    p.entries.some(
      e =>
        !e ||
        typeof e.path !== 'string' ||
        typeof e.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(e.sha256) ||
        !Array.isArray(e.value) ||
        !e.value.every(v => typeof v === 'string')
    )
  )
    throw new Error('Invalid backfill plan');
  return p;
}
export async function runBackfillUp(
  store: IndexStore,
  config: { vaultPath: string },
  options: BackfillOptions,
  opts: { now: Date; log: (line: string) => void }
): Promise<void> {
  const root = path.resolve(config.vaultPath);
  if (!options.apply && !options.revert) {
    const names = await basenames(root);
    const plan: Plan = {
      version: 1,
      createdAt: opts.now.toISOString(),
      field: options.field,
      entries: [],
      noHub: [],
      reformat: [],
      alreadySet: 0,
    };
    for (const row of await store.backfillUpCandidates(
      options.field,
      options.hubTypes,
      options.childTypes,
      options.max
    )) {
      if (row.alreadySet) {
        plan.alreadySet++;
        continue;
      }
      if (!row.hubs.length) {
        plan.noHub.push(row.path);
        continue;
      }
      const value = row.hubs.map(
        hub =>
          `[[${names.get(path.basename(hub, '.md').toLowerCase()) === 1 ? path.basename(hub, '.md') : hub.replace(/\.md$/, '')}]]`
      );
      const abs = await confinedNotePath(root, row.path);
      const source = await fs.readFile(abs, 'utf8');
      const result = await atomicFrontmatterEdit(
        abs,
        d => setFrontmatterField(d, options.field, value),
        {
          now: opts.now,
          minAgeMs: 0,
          onlyKey: options.field,
          checkOnly: true,
          vaultPath: root,
          checkContent: content => content === source,
        }
      );
      if (result === 'roundtrip' || result === 'invalid') {
        plan.reformat.push(row.path);
        continue;
      }
      if (result === 'missing' || result === 'raced') continue;
      plan.entries.push({ path: row.path, sha256: sha256(source), value });
    }
    const target = path.resolve(options.plan),
      temp = path.join(path.dirname(target), `.${path.basename(target)}.tmp`);
    let staged = false;
    try {
      await fs.writeFile(temp, JSON.stringify(plan, null, 2) + '\n', {
        encoding: 'utf8',
        flag: 'wx',
      });
      staged = true;
      await fs.rename(temp, target);
    } finally {
      if (staged) await fs.rm(temp, { force: true });
    }
    for (const e of plan.entries) opts.log(`${e.path} -> ${e.value.join(', ')}`);
    for (const p of plan.reformat) opts.log(`reformat: ${p}`);
    opts.log(
      `entries: ${plan.entries.length}, no hub: ${plan.noHub.length}, reformat: ${plan.reformat.length}, already set: ${plan.alreadySet}`
    );
    return;
  }
  const plan = validatePlan(JSON.parse(await fs.readFile(options.plan, 'utf8')));
  const counts = {
    written: 0,
    changed: 0,
    unchanged: 0,
    invalid: 0,
    roundtrip: 0,
    raced: 0,
    missing: 0,
  };
  const changed: string[] = [];
  for (const entry of plan.entries) {
    const abs = await confinedNotePath(root, entry.path);
    let text;
    try {
      text = await fs.readFile(abs, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        counts.missing++;
        continue;
      }
      throw err;
    }
    if (options.apply && sha256(text) !== entry.sha256) {
      counts.changed++;
      changed.push(entry.path);
      continue;
    }
    if (options.revert) {
      const parsed = parseFrontmatter(text);
      if (parsed.error || !parsed.frontmatter) {
        counts.invalid++;
        continue;
      }
      if (!Object.hasOwn(parsed.frontmatter, plan.field)) {
        counts.unchanged++;
        continue;
      }
      if (!isDeepStrictEqual(parsed.frontmatter[plan.field], entry.value)) {
        counts.changed++;
        changed.push(entry.path);
        continue;
      }
    }
    let mismatch = false;
    let checksumChanged = false;
    const result = await atomicFrontmatterEdit(
      abs,
      d => {
        if (options.revert && !isDeepStrictEqual(d.toJS()[plan.field], entry.value)) {
          mismatch = true;
          return;
        }
        setFrontmatterField(d, plan.field, options.revert ? null : entry.value);
      },
      {
        now: opts.now,
        minAgeMs: 0,
        onlyKey: plan.field,
        vaultPath: root,
        checkContent: options.apply
          ? content => {
              checksumChanged = sha256(content) !== entry.sha256;
              return !checksumChanged;
            }
          : undefined,
      }
    );
    if (mismatch || checksumChanged) {
      counts.changed++;
      changed.push(entry.path);
    } else counts[result as keyof typeof counts]++;
  }
  opts.log(
    `written: ${counts.written}, changed: ${counts.changed}, unchanged: ${counts.unchanged}, invalid: ${counts.invalid}, roundtrip: ${counts.roundtrip}, raced: ${counts.raced}, missing: ${counts.missing}`
  );
  for (const p of changed) opts.log(`changed: ${p}`);
}
export async function main(args = process.argv.slice(2), env = process.env): Promise<number> {
  const parsed = readBackfillOptions(args);
  if ('error' in parsed) {
    console.error(parsed.error);
    return 2;
  }
  for (const key of ['DATABASE_URL', 'VAULT_PATH'])
    if (!env[key]) {
      console.error(`${key} is required`);
      return 2;
    }
  const store = new IndexStore({
    connectionString: env.DATABASE_URL!,
    collection: env.INDEX_COLLECTION || 'default',
  });
  try {
    await store.ensureTrailsSchema();
    await runBackfillUp(store, { vaultPath: env.VAULT_PATH! }, parsed.options, {
      now: new Date(),
      log: console.log,
    });
    return 0;
  } finally {
    await store.close();
  }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    process.exitCode = await main();
  } catch (err) {
    console.error(`backfill-up: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}
