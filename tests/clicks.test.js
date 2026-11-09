import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { DEFAULT_CLICKS, parseClicksEnv, clicksRerank, clickTotals } from '../src/search/clicks.js';
import { DEFAULT_RANKING, rankingId } from '../src/index/ranking.js';
import { readIndexConfig } from '../src/index/config.js';
import { SearchService } from '../src/index/SearchService.js';
import { scanOnce } from '../src/index/scanner.js';
import { buildReport } from '../src/learn/report.js';

describe('clicks environment', () => {
  it('defaults off and reads into the index config', () => {
    expect(parseClicksEnv({})).toEqual({ mode: 'off', tau: 0.8, w: 0.5, c: 1, windowDays: 30 });
    expect(
      parseClicksEnv({
        SEARCH_CLICKS: '',
        SEARCH_CLICKS_TAU: '',
        SEARCH_CLICKS_W: '',
        SEARCH_CLICKS_C: '',
        SEARCH_CLICKS_WINDOW_DAYS: '',
      })
    ).toEqual(DEFAULT_CLICKS);
    expect(readIndexConfig({ DATABASE_URL: 'unused', SEARCH_CLICKS: 'shadow' }).clicks).toEqual({
      ...DEFAULT_CLICKS,
      mode: 'shadow',
    });
  });
  it.each([
    ['SEARCH_CLICKS', 'on', 'mode', 'on'],
    ['SEARCH_CLICKS_TAU', '0.9', 'tau', 0.9],
    ['SEARCH_CLICKS_W', '10', 'w', 10],
    ['SEARCH_CLICKS_C', '0.5', 'c', 0.5],
    ['SEARCH_CLICKS_WINDOW_DAYS', '365', 'windowDays', 365],
  ])('accepts %s=%s', (name, raw, key, value) => {
    expect(parseClicksEnv({ [name]: raw })[key]).toBe(value);
  });
  it.each([
    ['SEARCH_CLICKS', 'maybe'],
    ['SEARCH_CLICKS_TAU', '0'],
    ['SEARCH_CLICKS_TAU', '1'],
    ['SEARCH_CLICKS_W', '0'],
    ['SEARCH_CLICKS_W', '11'],
    ['SEARCH_CLICKS_C', '-1'],
    ['SEARCH_CLICKS_C', 'x'],
    ['SEARCH_CLICKS_WINDOW_DAYS', '1.5'],
    ['SEARCH_CLICKS_WINDOW_DAYS', '0'],
  ])('rejects %s=%s', (name, raw) => {
    expect(() => parseClicksEnv({ [name]: raw })).toThrow(`Invalid ${name}=${raw}`);
  });
  it('suffixes only an enabled ranker id', () => {
    expect(rankingId(DEFAULT_RANKING, undefined, { ...DEFAULT_CLICKS, mode: 'shadow' })).toBe(
      rankingId(DEFAULT_RANKING)
    );
    expect(rankingId(DEFAULT_RANKING, undefined, { ...DEFAULT_CLICKS, mode: 'on' })).toBe(
      'rrf-k60-v1-t1-cap0-ck0.8w0.5c1'
    );
  });
});

describe('clicks rerank math', () => {
  const opts = { w: 0.5, c: 1, rrfK: 60 };
  const hits = () => [
    { id: 1, documentId: 10, fused: 0.03 },
    { id: 2, documentId: 20, fused: 0.028 },
    { id: 3, documentId: 30, fused: 0.025 },
    { id: 4, documentId: 30, fused: 0.024 },
  ];
  it('keeps order and scores with no evidence, without mutating input', () => {
    const rows = hits();
    expect(clicksRerank(rows, new Map(), opts)).toEqual(rows);
    expect(clicksRerank([], new Map(), opts)).toEqual([]);
  });
  it('adds w*t/(t+c)/(rrfK+1) to every chunk of a note, by hand', () => {
    const rows = hits().map(Object.freeze);
    // t = 1.8: 0.5 * 1.8 / 2.8 / 61 = 0.005269...
    const result = clicksRerank(rows, new Map([[30, 1.8]]), opts);
    const boost = (0.5 * 1.8) / 2.8 / 61;
    expect(boost).toBeCloseTo(0.0052693, 6);
    expect(result.map(h => h.id)).toEqual([3, 1, 4, 2]);
    expect(result[0].fused).toBeCloseTo(0.025 + boost, 10);
    expect(result[2].fused).toBeCloseTo(0.024 + boost, 10);
    expect(rows[2].fused).toBe(0.025);
  });
  it('saturates in t and keeps input order on ties', () => {
    const small = clicksRerank(hits(), new Map([[20, 1]]), opts)[0];
    const large = clicksRerank(hits(), new Map([[20, 1000]]), opts)[0];
    expect(large.fused - 0.028).toBeLessThan(0.5 / 61);
    expect(large.fused).toBeGreaterThan(small.fused);
    const tie = [
      { id: 1, documentId: 1, fused: 0.01 },
      { id: 2, documentId: 2, fused: 0.01 },
    ];
    expect(clicksRerank(tie, new Map(), opts).map(h => h.id)).toEqual([1, 2]);
  });
});

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
run('clicks against pgvector', () => {
  let root, service, shadowService;
  const collection = `test-clicks-${process.pid}-${Date.now()}`;
  const learn = { enabled: true, patterns: [], retentionDays: 30, error: null };
  const config = {
    databaseUrl: process.env.TEST_DATABASE_URL,
    collection,
    embedder: { provider: 'fake', dim: 64, model: 'fake' },
    intervalSeconds: 60,
    learn,
  };
  const vec = async text => (await service.embedder.embed([text]))[0];
  const cosine = (a, b) => {
    let s = 0,
      na = 0,
      nb = 0;
    for (let i = 0; i < a.length; i++) {
      s += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    return s / Math.sqrt(na * nb);
  };
  const past = async (
    query,
    reads,
    { days = 0, store = service.store, tool = 'semantic-search' } = {}
  ) => {
    const id = randomUUID();
    await store.insertSearchLog({
      id,
      sessionId: null,
      clientName: 'test',
      tool,
      query,
      redacted: false,
      embedding: query === null ? null : await vec(query),
      params: {},
      ranker: 'live',
      results: [],
    });
    if (days)
      await store['pool'].query(
        'UPDATE search_log SET at = now() - make_interval(days => $2) WHERE id=$1',
        [id, days]
      );
    if (reads.length)
      await store.insertNoteReads(
        reads.map(p => ({
          sessionId: null,
          clientName: 'test',
          tool: 'read-note',
          path: p,
          requestId: id,
        }))
      );
    return id;
  };
  const docId = async p =>
    Number(
      (
        await service.store['pool'].query(
          'SELECT id FROM documents WHERE collection=$1 AND path=$2',
          [collection, p]
        )
      ).rows[0].id
    );
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'clicks-'));
    await fs.mkdir(path.join(root, 'notes'));
    await fs.writeFile(path.join(root, 'notes/alpha.md'), '# Alpha\n\nalpha token alpha');
    await fs.writeFile(path.join(root, 'notes/beta.md'), '# Beta\n\nalpha beta token');
    await fs.writeFile(path.join(root, 'notes/gamma.md'), '# Gamma\n\ngamma words only');
    service = await SearchService.create(config, root);
    await scanOnce({ vaultPath: root, store: service.store, embedder: service.embedder });
    shadowService = await SearchService.create(
      { ...config, clicks: { ...DEFAULT_CLICKS, mode: 'shadow' } },
      root
    );
    // Evidence: two matching past searches read beta; one read gamma under a dissimilar query;
    // an old one and a foreign-collection one read alpha and must not count.
    await past('alpha', ['notes/beta.md']);
    await past('alpha token', ['notes/beta.md', 'notes/beta.md']);
    await past('gamma words', ['notes/alpha.md']);
    await past('alpha', ['notes/alpha.md'], { days: 40 });
    await past(null, ['notes/alpha.md'], { tool: 'search-vault' });
  });
  afterAll(async () => {
    for (const s of [shadowService, service]) if (s) await s.close();
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it('sums the cosine of matching past searches per note, once per search, in the window', async () => {
    const q = await vec('alpha');
    const ids = await Promise.all(['notes/alpha.md', 'notes/beta.md', 'notes/gamma.md'].map(docId));
    const at = tau =>
      clickTotals(service.store['pool'], collection, `[${q.join(',')}]`, ids, {
        tau,
        windowDays: 30,
      });
    const c1 = cosine(q, await vec('alpha'));
    const c2 = cosine(q, await vec('alpha token'));
    expect(c2).toBeGreaterThan(0.75);
    expect(c2).toBeLessThan(0.8);
    expect(cosine(q, await vec('gamma words'))).toBeLessThan(0.75);
    const loose = await at(0.75);
    expect(loose.get(ids[1])).toBeCloseTo(c1 + c2, 5);
    expect(loose.has(ids[0])).toBe(false);
    expect(loose.has(ids[2])).toBe(false);
    const strict = await at(0.8);
    expect(strict.get(ids[1])).toBeCloseTo(c1, 5);
  });

  it('shadow leaves live results identical and logs the reordered top k', async () => {
    const off = await service.store.searchRanked(await vec('alpha'), 'alpha', {
      k: 3,
      ranking: DEFAULT_RANKING,
    });
    const shadow = await service.store.searchRanked(await vec('alpha'), 'alpha', {
      k: 3,
      ranking: DEFAULT_RANKING,
      clicks: { ...DEFAULT_CLICKS, mode: 'shadow' },
    });
    expect(shadow.results).toEqual(off.results);
    expect(off.results[0].path).toBe('notes/alpha.md');
    expect(shadow.shadowClicks.ranker).toBe('rrf-k60-v1-t1-cap0-ck0.8w0.5c1');
    expect(shadow.shadowClicks.results[0]).toMatchObject({ path: 'notes/beta.md', rank: 1 });
    expect(shadow.shadow).toBeNull();
  });

  it('on returns the boosted order; off and text mode run no lookup', async () => {
    const on = await service.store.searchRanked(await vec('alpha'), 'alpha', {
      k: 3,
      ranking: DEFAULT_RANKING,
      clicks: { ...DEFAULT_CLICKS, mode: 'on' },
    });
    expect(on.results[0].path).toBe('notes/beta.md');
    const text = await service.store.searchRanked(null, 'alpha', {
      k: 3,
      mode: 'text',
      clicks: { ...DEFAULT_CLICKS, mode: 'shadow' },
    });
    expect(text).not.toHaveProperty('shadowClicks');
  });

  it('writes shadow_clicks through the learn log and reports it', async () => {
    const result = await shadowService.semanticSearch('alpha', { k: 3 });
    await shadowService.learn.flush();
    const row = (
      await service.store['pool'].query(
        'SELECT ranker, shadow, shadow_clicks FROM search_log WHERE id=$1',
        [result.requestId]
      )
    ).rows[0];
    expect(row.ranker).toBe('rrf-k60-v1-t1-cap0');
    expect(row.shadow).toBeNull();
    expect(row.shadow_clicks.results[0].path).toBe('notes/beta.md');
    await service.store.insertNoteReads([
      {
        sessionId: null,
        clientName: 'test',
        tool: 'read-note',
        path: 'notes/beta.md',
        requestId: result.requestId,
      },
    ]);
    const report = (await buildReport(service.store, 30, 'test')).clicksShadow;
    expect(report).toMatchObject({ searches: 1, top1Differs: 1, mrrShadow: 1 });
    expect(report.mrrLive).toBeLessThan(1);
  });
});

describe('brain-eval clicks argument validation', async () => {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const invoke = config =>
    promisify(execFile)(process.execPath, [
      '--import',
      'tsx',
      path.resolve('src/eval.ts'),
      '--golden',
      '/missing-fixture.json',
      '--out',
      '/unused-report.json',
      '--config',
      JSON.stringify(config),
    ]);
  it.each([
    null,
    [],
    {},
    { tau: 0.8, w: 0.5 },
    { tau: '0.8', w: 0.5, c: 1 },
    { tau: 1, w: 0.5, c: 1 },
    { tau: 0.8, w: 0.5, c: 1, mode: 'on' },
  ])('rejects malformed clicks %j with exit 2', async clicks => {
    await expect(invoke({ clicks })).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining('Invalid --config clicks:'),
    });
  });
});
