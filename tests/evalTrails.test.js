import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { SearchService } from '../src/index/SearchService.js';
import { scanOnce } from '../src/index/scanner.js';

const exec = promisify(execFile);
const cli = path.resolve('src/eval.ts');
const invoke = (config, golden = '/missing-fixture.json', out = '/unused-report.json', env = {}) =>
  exec(process.execPath, ['--import', 'tsx', cli, '--golden', golden, '--out', out, '--config', JSON.stringify(config)],
    { env: { ...process.env, ...env } });

describe('brain-eval trails argument validation', () => {
  it.each([null, [], 'on', {}, { w: 0.5 }, { anchors: 3 }, { w: '0.5', anchors: 3 },
    { w: 0, anchors: 3 }, { w: 11, anchors: 3 }, { w: 0.5, anchors: 0 },
    { w: 0.5, anchors: 9 }, { w: 0.5, anchors: 1.5 }, { w: 0.5, anchors: 3, mode: 'on' }])
  ('rejects malformed trails %j with exit 2 before accessing the database', async trails => {
    await expect(invoke({ trails })).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining('Invalid --config trails:') });
  });
  it('retains the existing validator for other fields', async () => {
    await expect(invoke({ trails: { w: 0.5, anchors: 3 }, extra: 1 })).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining('Invalid --config field: extra') });
  });
});

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
run('brain-eval trails against pgvector', () => {
  let root, service, golden;
  const collection = `test-eval-trails-${process.pid}-${Date.now()}`;
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'eval-trails-'));
    await fs.mkdir(path.join(root, 'notes'));
    await fs.writeFile(path.join(root, 'notes/alpha.md'), '# Alpha\n\nalpha token');
    service = await SearchService.create({ databaseUrl: process.env.TEST_DATABASE_URL, collection,
      embedder: { provider: 'fake', model: 'fake', dim: 64 }, intervalSeconds: 60 }, root);
    await scanOnce({ vaultPath: root, store: service.store, embedder: service.embedder });
    golden = path.join(root, 'golden.json');
    await fs.writeFile(golden, JSON.stringify({ version: 1, created: '2026-01-01', notes: 'synthetic',
      queries: [{ id: 'a', category: 'exact-id', query: 'alpha', expected: ['notes/alpha.md'] }] }));
  });
  afterAll(async () => {
    if (service) { await service.store.truncateCollection(); await service.close(); }
    if (root) await fs.rm(root, { recursive: true, force: true });
  });
  const evaluate = async config => {
    const out = path.join(root, 'report.json');
    const env = { DATABASE_URL: process.env.TEST_DATABASE_URL, INDEX_COLLECTION: collection,
      EMBED_PROVIDER: 'fake', EMBED_MODEL: 'fake', EMBED_DIM: '64',
      SEARCH_TRAILS: 'invalid-ambient', SEARCH_TRAILS_W: '-1', SEARCH_TRAILS_ANCHORS: '99' };
    await invoke(config, golden, out, env);
    return JSON.parse(await fs.readFile(out, 'utf8'));
  };
  it('accepts trails and produces a distinct suffixed run even with baseline ranking settings', async () => {
    const report = await evaluate({ trails: { w: 0.5, anchors: 3 } });
    expect(report.baseline).toBe('rrf-k60-v1-t1-cap0');
    expect(report.configs.map(c => c.id)).toEqual(['rrf-k60-v1-t1-cap0', 'rrf-k60-v1-t1-cap0-tr0.5a3']);
    expect(report.configs[1].perQuery[0].notes).toEqual(['notes/alpha.md']);
  });
  it('merges ranking options and keeps the default baseline untouched', async () => {
    const report = await evaluate({ perNoteCap: 2, trails: { w: 10, anchors: 8 } });
    expect(report.configs.map(c => c.id)).toEqual(['rrf-k60-v1-t1-cap0', 'rrf-k60-v1-t1-cap2-tr10a8']);
  });
  it('keeps config-without-trails behavior and ids unchanged, ignoring ambient trails settings', async () => {
    expect((await evaluate({})).configs.map(c => c.id)).toEqual(['rrf-k60-v1-t1-cap0']);
    expect((await evaluate({ perNoteCap: 2 })).configs.map(c => c.id)).toEqual(['rrf-k60-v1-t1-cap0', 'rrf-k60-v1-t1-cap2']);
  });
});
