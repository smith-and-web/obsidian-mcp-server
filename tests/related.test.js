import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import pg from 'pg';
import { IndexStore } from '../src/index/store.js';
import { createRelatedHandler } from '../src/server/related.js';

function response() {
  const res = { statusCode: 200 };
  res.status = vi.fn(code => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn(body => {
    res.body = body;
    return res;
  });
  return res;
}
async function call(search, query) {
  const res = response();
  await createRelatedHandler(search)({ query }, res);
  return res;
}

describe('related validation and failures', () => {
  it('returns 503 when semantic search is disabled', async () => {
    const res = await call(null, { path: 'notes/a' });
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: 'semantic search disabled' });
  });
  it.each(['0', '21', '-1', '1.2', '', 'NaN', ['8'], {}, 'Infinity'])(
    'rejects invalid k %j',
    async k => {
      expect((await call({}, { path: 'notes/a', k })).statusCode).toBe(400);
    }
  );
  it.each([
    undefined,
    '',
    ['a'],
    {},
    'a'.repeat(1025),
    '../a',
    '/../../a',
    '//a',
    'notes/../a',
    'notes\\a',
    '.obsidian/a',
    'notes/\u0000a',
  ])('rejects invalid path %j', async p => {
    expect((await call({}, { path: p })).statusCode).toBe(400);
  });
  it('returns a generic store error and logs the failure', async () => {
    const error = new Error('database failure');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await call(
        { store: { relatedDocument: vi.fn().mockRejectedValue(error) } },
        { path: 'notes/a' }
      );
      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: 'internal error' });
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});

const DB = process.env.TEST_DATABASE_URL;
const run = DB ? describe : describe.skip;
run('related against pgvector', () => {
  let store, pool, root, search;
  const collection = `related-${process.pid}-${Date.now()}`;
  const otherCollection = `${collection}-other`;
  const at = '2026-10-29T14:00:00.000Z';
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'related-'));
    store = new IndexStore({ connectionString: DB, collection });
    await store.ensureSchema('fake', 64);
    pool = new pg.Pool({ connectionString: DB });
    search = { store, learn: { logSearch: vi.fn(), logRead: vi.fn() } };
    const vector = `[${[1, ...Array(63).fill(0)].join(',')}]`;
    for (const name of ['a', 'b', 'c', 'd']) {
      await pool.query(
        "INSERT INTO documents(collection,path,title,content_sha256,mtime,size,centroid) VALUES($1,$2,$3,'test',now(),1,$4::vector)",
        [collection, `notes/${name}.md`, name.toUpperCase(), vector]
      );
    }
    await pool.query(
      "INSERT INTO documents(collection,path,title,content_sha256,mtime,size,centroid) VALUES($1,'notes/foreign.md','Foreign','test',now(),1,$2::vector)",
      [otherCollection, vector]
    );
    await pool.query(
      "INSERT INTO note_heat(collection,path,score,bucket,computed_at) VALUES($1,'notes/a.md',3.234,2,now())",
      [collection]
    );
    for (const [a, b, w] of [
      ['a', 'b', 4.14],
      ['a', 'c', 4.14],
      ['a', 'd', 1.23],
      ['b', 'c', 8],
      ['a', 'missing', 99],
    ]) {
      await pool.query(
        'INSERT INTO trails(collection,path_a,path_b,weight,events,last_at,computed_at) VALUES($1,$2,$3,$4,3,$5,now())',
        [collection, `notes/${a}.md`, `notes/${b}.md`, w, at]
      );
    }
    for (const [a, b] of [
      ['a', 'b'],
      ['c', 'a'],
    ]) {
      await pool.query(
        'INSERT INTO links(src_document_id,target_path,target_document_id) SELECT a.id,b.path,b.id FROM documents a,documents b WHERE a.collection=$1 AND b.collection=$1 AND a.path=$2 AND b.path=$3',
        [collection, `notes/${a}.md`, `notes/${b}.md`]
      );
    }
  });
  afterAll(async () => {
    if (pool) {
      for (const table of ['trails', 'note_heat', 'note_reads', 'search_log'])
        await pool.query(`DELETE FROM ${table} WHERE collection=$1`, [collection]);
      await pool.query('DELETE FROM documents WHERE collection=$1', [otherCollection]);
    }
    await store?.truncateCollection();
    await store?.close();
    await pool?.end();
    if (root) await fs.rm(root, { recursive: true, force: true });
  });
  it('returns the complete shape, normalizes path, rounds values and marks both link directions', async () => {
    const res = await call(search, { path: '/notes/a', k: '3' });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['heat', 'path', 'similar', 'title', 'trails']);
    expect(res.body).toMatchObject({
      path: 'notes/a.md',
      title: 'A',
      heat: { score: 3.23, bucket: 2 },
    });
    expect(res.body.trails).toEqual([
      { path: 'notes/b.md', title: 'B', weight: 4.1, events: 3, lastAt: at, linked: true },
      { path: 'notes/c.md', title: 'C', weight: 4.1, events: 3, lastAt: at, linked: true },
      { path: 'notes/d.md', title: 'D', weight: 1.2, events: 3, lastAt: at, linked: false },
    ]);
    expect(res.body.similar).toHaveLength(3);
    expect(res.body.similar).toEqual(
      expect.arrayContaining([
        { path: 'notes/b.md', title: 'B', score: 1, linked: true },
        { path: 'notes/c.md', title: 'C', score: 1, linked: true },
        { path: 'notes/d.md', title: 'D', score: 1, linked: false },
      ])
    );
  });
  it('limits results, reads either end of a trail and excludes self and other collections', async () => {
    const { body } = await call(search, { path: 'notes/c.md', k: '1' });
    expect(body.trails).toEqual([
      { path: 'notes/b.md', title: 'B', weight: 8, events: 3, lastAt: at, linked: false },
    ]);
    expect(body.similar).toHaveLength(1);
    expect(body.similar[0].path).not.toBe('notes/c.md');
    expect(body.similar[0].path).not.toBe('notes/foreign.md');
  });
  it('returns null heat when absent and defaults k to eight', async () => {
    const { body } = await call(search, { path: 'notes/b.md' });
    expect(body.heat).toBeNull();
    expect(body.similar).toHaveLength(3);
  });
  it('returns 404 for an unindexed note', async () => {
    const res = await call(search, { path: 'notes/absent' });
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'not indexed' });
  });
  it('does not add learn-log rows', async () => {
    const counts = async () =>
      (
        await pool.query(
          'SELECT (SELECT count(*) FROM search_log WHERE collection=$1)::int searches,(SELECT count(*) FROM note_reads WHERE collection=$1)::int reads',
          [collection]
        )
      ).rows[0];
    const before = await counts();
    await call(search, { path: 'notes/a' });
    await call(search, { path: 'notes/absent' });
    expect(await counts()).toEqual(before);
    expect(search.learn.logSearch).not.toHaveBeenCalled();
    expect(search.learn.logRead).not.toHaveBeenCalled();
  });
});
