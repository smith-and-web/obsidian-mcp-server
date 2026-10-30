import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { IndexStore } from '../src/index/store.js';
import { buildReport } from '../src/learn/report.js';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const results = paths => paths.map((name, i) => ({ path: `notes/${name}.md`, ord: i, rank: i + 1 }));
run('Trails shadow report', () => {
  let root, store, other;
  const collection = `test-shadow-report-${process.pid}-${Date.now()}`;
  const add = async (live, shadow, reads = [], days = 0, target = store) => {
    const id = randomUUID();
    await target.insertSearchLog({ id, sessionId: null, clientName: 'test', tool: 'semantic-search',
      query: 'synthetic', redacted: false, embedding: null, params: {}, ranker: 'live', results: results(live),
      shadow: shadow === null ? null : { ranker: 'shadow', results: results(shadow) } });
    if (days) await target['pool'].query("UPDATE search_log SET at = now() - make_interval(days => $2) WHERE id=$1", [id, days]);
    if (reads.length) await target.insertNoteReads(reads.map(name => ({ sessionId: null, clientName: 'test', tool: 'read-note', path: `notes/${name}.md`, requestId: id })));
    return id;
  };
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'shadow-report-'));
    store = new IndexStore({ connectionString: process.env.TEST_DATABASE_URL, collection });
    other = new IndexStore({ connectionString: process.env.TEST_DATABASE_URL, collection: `${collection}-other` });
    await store.ensureSchema('fake', 64);
  });
  afterAll(async () => {
    for (const item of [store, other]) if (item) { await item.truncateCollection(); await item.close(); }
    if (root) await fs.rm(root, { recursive: true, force: true });
  });
  it('uses null rates with no qualifying searches', async () => {
    expect((await buildReport(store, 30, 'test')).trailsShadow).toEqual({ searches: 0, top1Differs: null, mrrLive: null, mrrShadow: null });
  });
  it('computes shares and first-read reciprocal ranks, excluding null, unlinked, old and foreign searches', async () => {
    await add(['x', 'y', 'z'], ['y', 'x', 'z'], ['y', 'x']);
    await add(['z', 'x'], ['z', 'y', 'x'], ['absent', 'z']);
    await add(['x', 'y', 'y'], ['x', 'y'], ['y']);
    await add(['x'], null, ['x']);
    await add(['x'], ['y']);
    await add(['x'], ['y'], ['y'], 31);
    await add(['x'], ['y'], ['y'], 0, other);
    expect((await buildReport(store, 30, 'test')).trailsShadow).toEqual({ searches: 3, top1Differs: 0.3333, mrrLive: 0.3333, mrrShadow: 0.5 });
  });
  it('prints the named section and writes the same metrics through the read-only CLI', async () => {
    const out = path.join(root, 'report.json');
    const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', path.resolve('src/learn-report.ts'), '--out', out],
      { env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL, INDEX_COLLECTION: collection } });
    expect(stdout).toContain('Trails shadow\ntrailsShadow.searches: 3');
    expect(JSON.parse(await fs.readFile(out, 'utf8')).trailsShadow).toEqual({ searches: 3, top1Differs: 0.3333, mrrLive: 0.3333, mrrShadow: 0.5 });
  });
});
