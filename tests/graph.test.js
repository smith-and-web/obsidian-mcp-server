import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import pg from 'pg';
import { IndexStore } from '../src/index/store.js';
import { createGraphHandler } from '../src/server/graph.js';

async function call(search, query = {}) {
  const res = { statusCode: 200 };
  res.status = vi.fn(code => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn(body => {
    res.body = body;
    return res;
  });
  await createGraphHandler(search)({ query }, res);
  return res;
}

describe('graph handler', () => {
  it('returns 503 when semantic search is disabled', async () => {
    const res = await call(null);
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: 'semantic search disabled' });
  });
  it('ignores query parameters and returns the store response', async () => {
    const data = { nodes: [], links: [], trails: [] };
    const graph = vi.fn().mockResolvedValue(data);
    const res = await call({ store: { graph } }, { path: '../invalid', k: ['bad'], anything: {} });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(data);
    expect(graph).toHaveBeenCalledExactlyOnceWith();
  });
  it('logs store failures and returns a generic 500', async () => {
    const error = new Error('database failure');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await call({ store: { graph: vi.fn().mockRejectedValue(error) } });
      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({ error: 'internal error' });
      expect(log).toHaveBeenCalledWith('Graph store error', error);
    } finally {
      log.mockRestore();
    }
  });
});

const DB = process.env.TEST_DATABASE_URL;
const run = DB ? describe : describe.skip;
run('graph against pgvector', () => {
  let store, pool, root, search;
  const collection = `graph-${process.pid}-${Date.now()}`;
  const otherCollection = `${collection}-other`;
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-'));
    store = new IndexStore({ connectionString: DB, collection });
    await store.ensureSchema('fake', 64);
    pool = new pg.Pool({ connectionString: DB });
    search = { store, learn: { logSearch: vi.fn(), logRead: vi.fn() } };
    // Insert out of order: response indexes must follow document path order.
    for (const [name, frontmatter] of [
      ['d', { up: { invalid: true } }],
      ['b', { up: '[[A]]' }],
      ['a', { type: 'project', up: ['[[B]]', 1, null, 'notes/c'] }],
      ['c', {}],
    ]) {
      await pool.query(
        "INSERT INTO documents(collection,path,title,frontmatter,content_sha256,mtime,size) VALUES($1,$2,$3,$4::jsonb,'test',now(),1)",
        [collection, `notes/${name}.md`, name.toUpperCase(), JSON.stringify(frontmatter)]
      );
    }
    await pool.query(
      "INSERT INTO documents(collection,path,title,content_sha256,mtime,size) VALUES($1,'notes/foreign.md','Foreign','test',now(),1)",
      [otherCollection]
    );
    await pool.query(
      "INSERT INTO note_heat(collection,path,score,bucket,computed_at) VALUES($1,'notes/a.md',5.434,2,now()),($2,'notes/b.md',99,5,now())",
      [collection, otherCollection]
    );
    for (const [a, b, weight] of [
      ['a', 'c', 2.84],
      ['a', 'b', 0.49],
      ['b', 'c', 0.5],
      ['a', 'missing', 9],
      ['missing', 'z', 9],
    ]) {
      await pool.query(
        'INSERT INTO trails(collection,path_a,path_b,weight,events,last_at,computed_at) VALUES($1,$2,$3,$4,1,now(),now())',
        [collection, `notes/${a}.md`, `notes/${b}.md`, weight]
      );
    }
    await pool.query(
      "INSERT INTO trails(collection,path_a,path_b,weight,events,last_at,computed_at) VALUES($1,'notes/a.md','notes/b.md',99,1,now(),now())",
      [otherCollection]
    );
    for (const [a, b] of [
      ['a', 'b'],
      ['b', 'a'],
      ['a', 'a'],
      ['c', 'b'],
    ]) {
      await pool.query(
        'INSERT INTO links(src_document_id,target_path,target_document_id) SELECT s.id,t.path,t.id FROM documents s,documents t WHERE s.collection=$1 AND t.collection=$1 AND s.path=$2 AND t.path=$3',
        [collection, `notes/${a}.md`, `notes/${b}.md`]
      );
    }
    // A second target spelling resolves to the same node; deduplicate it too.
    await pool.query(
      "INSERT INTO links(src_document_id,target_path,target_document_id) SELECT s.id,'B',t.id FROM documents s,documents t WHERE s.collection=$1 AND t.collection=$1 AND s.path='notes/a.md' AND t.path='notes/b.md'",
      [collection]
    );
    await pool.query(
      "INSERT INTO links(src_document_id,target_path,target_document_id) SELECT s.id,t.path,t.id FROM documents s,documents t WHERE s.collection=$1 AND s.path='notes/a.md' AND t.collection=$2",
      [collection, otherCollection]
    );
    await pool.query(
      "INSERT INTO links(src_document_id,target_path,target_document_id) SELECT s.id,t.path,t.id FROM documents s,documents t WHERE s.collection=$1 AND t.collection=$2 AND t.path='notes/c.md'",
      [otherCollection, collection]
    );
    await pool.query(
      "INSERT INTO links(src_document_id,target_path) SELECT id,'notes/unresolved.md' FROM documents WHERE collection=$1 AND path='notes/a.md'",
      [collection]
    );
  });
  afterAll(async () => {
    if (pool) {
      for (const scoped of [collection, otherCollection]) {
        for (const table of ['trails', 'note_heat', 'note_reads', 'search_log'])
          await pool.query(`DELETE FROM ${table} WHERE collection=$1`, [scoped]);
      }
      await pool.query('DELETE FROM documents WHERE collection=$1', [otherCollection]);
    }
    await store?.truncateCollection();
    await store?.close();
    await pool?.end();
    if (root) await fs.rm(root, { recursive: true, force: true });
  });
  it('returns the full shape, ordered indexes, rounded scores and normalized metadata', async () => {
    const res = await call(search);
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['links', 'nodes', 'trails']);
    expect(res.body.nodes).toEqual([
      {
        path: 'notes/a.md',
        title: 'A',
        type: 'project',
        up: ['[[B]]', 'notes/c'],
        heat: 2,
        score: 5.43,
      },
      { path: 'notes/b.md', title: 'B', type: '', up: [], heat: 0, score: 0 },
      { path: 'notes/c.md', title: 'C', type: '', up: [], heat: 0, score: 0 },
      { path: 'notes/d.md', title: 'D', type: '', up: [], heat: 0, score: 0 },
    ]);
  });
  it('deduplicates unordered resolved pairs and excludes self, unresolved and foreign links', async () => {
    const { body } = await call(search);
    expect(body.links).toHaveLength(2);
    expect(body.links).toEqual(
      expect.arrayContaining([
        [0, 1],
        [1, 2],
      ])
    );
  });
  it('filters trails below 0.5 or missing nodes and rounds weights to one decimal', async () => {
    const { body } = await call(search);
    expect(body.trails).toHaveLength(2);
    expect(body.trails).toEqual(
      expect.arrayContaining([
        [0, 2, 2.8],
        [1, 2, 0.5],
      ])
    );
  });
  it('never exposes another collection or maps an edge outside its nodes', async () => {
    const { body } = await call(search);
    expect(body.nodes.map(n => n.path)).not.toContain('notes/foreign.md');
    for (const edge of [...body.links, ...body.trails]) {
      for (const index of edge.slice(0, 2)) {
        expect(Number.isInteger(index)).toBe(true);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(body.nodes.length);
      }
    }
  });
  it('returns empty arrays for an empty collection', async () => {
    const empty = new IndexStore({ connectionString: DB, collection: `${collection}-empty` });
    try {
      expect(await empty.graph()).toEqual({ nodes: [], links: [], trails: [] });
    } finally {
      await empty.close();
    }
  });
  it('does not add any learn-log rows', async () => {
    const counts = async () =>
      (
        await pool.query(
          'SELECT (SELECT count(*) FROM search_log WHERE collection=$1)::int searches,(SELECT count(*) FROM note_reads WHERE collection=$1)::int reads',
          [collection]
        )
      ).rows[0];
    const before = await counts();
    await call(search);
    await call(search, { unknown: 'ignored' });
    expect(await counts()).toEqual(before);
    expect(search.learn.logSearch).not.toHaveBeenCalled();
    expect(search.learn.logRead).not.toHaveBeenCalled();
  });
});
