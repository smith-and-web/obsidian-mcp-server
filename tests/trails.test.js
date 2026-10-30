import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import pg from 'pg';
import { randomUUID } from 'crypto';
import { IndexStore } from '../src/index/store.js';
import { readTrailsConfig } from '../src/trails/config.js';
import { runTrails } from '../src/trails/run.js';
const DB = process.env.TEST_DATABASE_URL;
const run = DB ? describe : describe.skip;
run('trails against pgvector', () => {
  let root, store, pool, config;
  const collection = `trails-${process.pid}-${Date.now()}`;
  const now = new Date('2026-11-01T12:00:00Z');
  const before = days => new Date(now.getTime() - days * 86400000);
  const rebuild = () =>
    store.rebuildTrailsAndHeat({
      now,
      windowDays: 180,
      halfLifeDays: 30,
      tz: 'America/Halifax',
      thresholds: [1, 3, 6, 12, 24],
      commit: true,
    });
  const read = async (p, session, at = now, request = null) =>
    pool.query(
      "INSERT INTO note_reads(collection,path,session_id,at,request_id,tool) VALUES($1,$2,$3,$4,$5,'read-note')",
      [collection, p, session, at, request]
    );
  const search = async session => {
    const id = randomUUID();
    await pool.query(
      "INSERT INTO search_log(id,collection,at,session_id,tool,params,ranker,results) VALUES($1,$2,$3,$4,'search-vault','{}','test','[]')",
      [id, collection, now, session]
    );
    return id;
  };
  const feedback = async (id, source, rating, paths) =>
    pool.query(
      'INSERT INTO search_feedback(search_id,at,source,rating,used_paths) VALUES($1,$2,$3,$4,$5)',
      [id, now, source, rating, paths]
    );
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'trails-'));
    await fs.mkdir(path.join(root, 'notes'));
    store = new IndexStore({ connectionString: DB, collection });
    await store.ensureSchema('fake', 64);
    pool = new pg.Pool({ connectionString: DB });
    config = readTrailsConfig({
      DATABASE_URL: DB,
      VAULT_PATH: root,
      INDEX_COLLECTION: collection,
      TRAILS_TZ: 'America/Halifax',
    }).config;
    for (const name of ['a', 'b', 'c', 'd', 'e'])
      await pool.query(
        'INSERT INTO documents(collection,path,title,content_sha256,mtime,size,frontmatter) VALUES($1,$2,$2,\'test\',$3,1,\'{"type":"reference"}\')',
        [collection, `notes/${name}.md`, now]
      );
  });
  beforeEach(async () => {
    for (const table of ['trails', 'note_heat', 'trails_runs', 'note_reads', 'search_log'])
      await pool.query(`DELETE FROM ${table} WHERE collection=$1`, [collection]);
  });
  afterAll(async () => {
    if (pool)
      for (const table of ['trails', 'note_heat', 'trails_runs', 'note_reads', 'search_log'])
        await pool.query(`DELETE FROM ${table} WHERE collection=$1`, [collection]);
    await store?.truncateCollection();
    await store?.close();
    await pool?.end();
    if (root) await fs.rm(root, { recursive: true, force: true });
  });
  it('deduplicates session-days, counts different days, untied reads and feedback', async () => {
    const id = await search('s');
    for (const day of [1, 1, 0])
      for (const p of ['a', 'b']) await read(`notes/${p}.md`, 's', before(day), id);
    for (const p of ['a', 'c']) await read(`notes/${p}.md`, 'untied');
    await feedback(await search('f'), 'agent', 'positive', ['/notes/b', 'notes/c.md']);
    await feedback(await search('negative'), 'user', 'negative', ['notes/a.md', 'notes/c.md']);
    const result = await rebuild();
    expect(result.edges).toBe(3);
    const rows = (
      await pool.query(
        'SELECT path_a,path_b,weight,events FROM trails WHERE collection=$1 ORDER BY path_a,path_b',
        [collection]
      )
    ).rows;
    expect(rows[0].events).toBe(2);
    expect(rows[0].weight).toBeCloseTo(1 + Math.pow(0.5, 1 / 30), 3);
    expect(rows[1]).toMatchObject({
      path_a: 'notes/a.md',
      path_b: 'notes/c.md',
      weight: 0.5,
      events: 1,
    });
    expect(rows[2]).toMatchObject({
      path_a: 'notes/b.md',
      path_b: 'notes/c.md',
      weight: 2,
      events: 1,
    });
    // A user feedback in the same session-day takes precedence over repeated reads.
    await feedback(id, 'user', 'neutral', ['notes/a.md', 'notes/b.md']);
    await rebuild();
    expect(
      (
        await pool.query(
          'SELECT weight,events FROM trails WHERE collection=$1 AND path_a=$2 AND path_b=$3',
          [collection, 'notes/a.md', 'notes/b.md']
        )
      ).rows[0]
    ).toMatchObject({ events: 2 });
    expect(
      (
        await pool.query(
          'SELECT weight FROM trails WHERE collection=$1 AND path_a=$2 AND path_b=$3',
          [collection, 'notes/a.md', 'notes/b.md']
        )
      ).rows[0].weight
    ).toBeCloseTo(3 + Math.pow(0.5, 1 / 30), 3);
  });
  it('decays to half weight after one half-life', async () => {
    const id = await search('decay');
    for (const p of ['a', 'b']) await read(`notes/${p}.md`, 'decay', before(30), id);
    await rebuild();
    expect((await store.trailEdges(0))[0].weight).toBeCloseTo(0.5, 3);
  });
  it('ignores old rows and paths absent from documents', async () => {
    const id = await search('old');
    for (const p of ['a', 'b']) await read(`notes/${p}.md`, 'old', before(181), id);
    await read('notes/a.md', 'unknown');
    await read('notes/unknown.md', 'unknown');
    expect((await rebuild()).edges).toBe(0);
    expect((await store.heatScores()).map(r => r.path)).toEqual(['notes/a.md']);
  });
  it('maps scores at and around all requested thresholds', async () => {
    const scores = [0.9, 1, 2.99, 3, 24];
    for (const [i, score] of scores.entries()) {
      const p = `notes/${'abcde'[i]}.md`;
      for (let n = 0; n < Math.floor(score); n++) await read(p, `${i}-${n}`);
      const fraction = score - Math.floor(score);
      if (fraction) await read(p, `${i}-fraction`, before(30 * Math.log2(1 / fraction)));
    }
    const r = await rebuild();
    expect(r.buckets).toEqual([1, 2, 1, 0, 0, 1]);
    const rows = (
      await pool.query('SELECT bucket,score FROM note_heat WHERE collection=$1 ORDER BY path', [
        collection,
      ])
    ).rows;
    expect(rows.map(r => r.bucket)).toEqual([0, 1, 1, 2, 5]);
    rows.forEach((r, i) => expect(r.score).toBeCloseTo(scores[i], 3));
  });
  it('dry rebuild rolls back tables and creates no run row or files', async () => {
    for (const p of ['a', 'b']) await read(`notes/${p}.md`, 'dry');
    await pool.query("INSERT INTO note_heat VALUES($1,'notes/a.md',42,5,$2)", [collection, now]);
    const beforeRows = (
      await pool.query('SELECT * FROM note_heat WHERE collection=$1', [collection])
    ).rows;
    const fixture = '---\ntitle: A\ntags:\n    - one\n---\nBody\n';
    await fs.writeFile(path.join(root, 'notes/a.md'), fixture);
    const lines = [];
    expect(
      await runTrails(
        store,
        { ...config, heatTypes: ['reference'] },
        { dry: true, clearHeat: false, now, log: l => lines.push(l) }
      )
    ).toEqual({ code: 0 });
    expect(
      (await pool.query('SELECT * FROM note_heat WHERE collection=$1', [collection])).rows
    ).toEqual(beforeRows);
    expect(await store.trailEdges(0)).toEqual([]);
    expect(
      (await pool.query('SELECT * FROM trails_runs WHERE collection=$1', [collection])).rowCount
    ).toBe(0);
    expect(await fs.readdir(root)).toEqual(['notes']);
    expect(lines).toContain('dry run complete');
    expect(lines).toContain('heat.roundTripFailures: 1');
    expect(lines).toContain('  notes/a.md');
    expect(await fs.readFile(path.join(root, 'notes/a.md'), 'utf8')).toBe(fixture);
  });
  it('refuses a concurrent run and releases its lock', async () => {
    const other = new IndexStore({ connectionString: DB, collection });
    try {
      expect(await other.trailsLock()).toBe(true);
      expect(
        await runTrails(store, config, { dry: true, clearHeat: false, now, log: () => {} })
      ).toEqual({ code: 1, message: 'brain-trails: another run is in progress' });
    } finally {
      await other.trailsUnlock();
      await other.close();
    }
    expect(await store.trailsLock()).toBe(true);
    await store.trailsUnlock();
  });
  it('records successful metrics and failures, and clear mode bypasses rebuild', async () => {
    const lines = [];
    const opts = { dry: false, clearHeat: false, now, log: l => lines.push(l) };
    expect(await runTrails(store, config, opts)).toEqual({ code: 0 });
    let rows = (await pool.query('SELECT * FROM trails_runs WHERE collection=$1', [collection]))
      .rows;
    expect(rows[0].metrics).toMatchObject({ edges: 0, note: 'disabled', heatWrites: 0 });
    expect(rows[0].finished_at).toBeTruthy();
    await fs.writeFile(path.join(root, 'notes/owned.md'), 'user content');
    expect((await runTrails(store, { ...config, notePath: 'notes/owned.md' }, opts)).code).toBe(1);
    rows = (
      await pool.query('SELECT * FROM trails_runs WHERE collection=$1 ORDER BY id', [collection])
    ).rows;
    expect(rows[1].error_text).toContain('is not a trails note');
    expect(await runTrails(store, config, { ...opts, clearHeat: true })).toEqual({ code: 0 });
    expect(
      (await pool.query('SELECT * FROM trails_runs WHERE collection=$1', [collection])).rowCount
    ).toBe(2);
  });
});
describe('trails config', () => {
  it('validates bounds, switches, thresholds, paths and zones without throwing', () => {
    const base = { DATABASE_URL: 'test', VAULT_PATH: '/tmp/test' };
    expect(readTrailsConfig(base).config).toMatchObject({
      windowDays: 180,
      halfLifeDays: 30,
      writeHeat: false,
      thresholds: [1, 3, 6, 12, 24],
      heatTypes: [],
      notePath: '',
    });
    for (const [key, value] of Object.entries({
      TRAILS_TZ: 'invalid/zone',
      TRAILS_WINDOW_DAYS: '6',
      TRAILS_HALF_LIFE_DAYS: '366',
      TRAILS_HEAT_THRESHOLDS: '1,2,2,4,5',
      TRAILS_WRITE_HEAT: 'yes',
      TRAILS_NOTE_PATH: '../x.md',
      TRAILS_NOTE_PER_NOTE: '0',
      TRAILS_HEAT_MIN_AGE_MINUTES: '1441',
      TRAILS_HEAT_MAX_WRITES: '0',
      TRAILS_NOTE_MAX_SOURCES: '501',
      TRAILS_NOTE_MIN_WEIGHT: 'NaN',
    }))
      expect(readTrailsConfig({ ...base, [key]: value })).toHaveProperty('error');
  });
});
