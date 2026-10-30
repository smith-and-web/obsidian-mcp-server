import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import pg from 'pg';
import { IndexStore } from '../src/index/store.js';
import { FakeEmbedder } from '../src/index/embedder.js';
import { scanOnce, sha256 } from '../src/index/scanner.js';
const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
// A write that lands while the indexer reads a note can leave a stale hash whose
// size and mtime still match the file. The scanner must re-check such a note
// instead of trusting its stat forever.
run('indexerRace', () => {
  let root, store, pool, opts;
  const collection = `race-${process.pid}-${Date.now()}`;
  const file = name => path.join(root, 'notes', name);
  const storedHash = async rel =>
    (
      await pool.query('SELECT content_sha256 FROM documents WHERE collection=$1 AND path=$2', [
        collection,
        rel,
      ])
    ).rows[0]?.content_sha256;
  // Same byte length as each other, so only the content differs.
  const before = '---\ntitle: A\n---\n# A\nfirst version\n';
  const after = '---\ntitle: A\n---\n# A\nnewer version\n';
  beforeAll(async () => {
    expect(before.length).toBe(after.length);
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'race-'));
    await fs.mkdir(path.join(root, 'notes'));
    store = new IndexStore({ connectionString: process.env.TEST_DATABASE_URL, collection });
    await store.ensureSchema('fake', 64);
    pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
    opts = {
      vaultPath: root,
      store,
      embedder: new FakeEmbedder(64),
      frontmatterLinkKeys: [],
      volatileKeys: [],
    };
  });
  afterAll(async () => {
    await store?.truncateCollection();
    await store?.close();
    await pool?.end();
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it('re-reads a note indexed in the same moment it was written', async () => {
    // Indexed just after a write (mtime = now), as the production race was.
    await fs.writeFile(file('fresh.md'), before);
    const mtime = (await fs.stat(file('fresh.md'))).mtime;
    await scanOnce(opts);
    expect(await storedHash('notes/fresh.md')).toBe(sha256(before));
    // The writer's final bytes land with the same size and the same mtime.
    await fs.writeFile(file('fresh.md'), after);
    await fs.utimes(file('fresh.md'), mtime, mtime);
    const stats = await scanOnce(opts);
    expect(stats.changed).toBe(1);
    expect(await storedHash('notes/fresh.md')).toBe(sha256(after));
  });

  it('settles: an unchanged note re-checked once is not re-indexed', async () => {
    const stats = await scanOnce(opts);
    expect(stats.changed).toBe(0);
    expect(await storedHash('notes/fresh.md')).toBe(sha256(after));
  });

  it('still trusts the stat of a note indexed well after its last write', async () => {
    const old = new Date(Date.now() - 3600_000);
    await fs.writeFile(file('old.md'), before);
    await fs.utimes(file('old.md'), old, old);
    expect((await scanOnce(opts)).changed).toBe(1);
    // Same size, same (old) mtime, different bytes: the cheap path is kept for
    // settled notes, so this is not detected. That is the documented trade-off.
    await fs.writeFile(file('old.md'), after);
    await fs.utimes(file('old.md'), old, old);
    expect((await scanOnce(opts)).changed).toBe(0);
    expect(await storedHash('notes/old.md')).toBe(sha256(before));
  });

  it('notices a same-size rewrite whose mtime moved by less than a second', async () => {
    const old = new Date(Date.now() - 3600_000);
    await fs.writeFile(file('jitter.md'), before);
    await fs.utimes(file('jitter.md'), old, old);
    await scanOnce(opts);
    const moved = new Date(old.getTime() + 400);
    await fs.writeFile(file('jitter.md'), after);
    await fs.utimes(file('jitter.md'), moved, moved);
    expect((await scanOnce(opts)).changed).toBe(1);
    expect(await storedHash('notes/jitter.md')).toBe(sha256(after));
  });
});
