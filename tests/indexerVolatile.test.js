import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import pg from 'pg';
import { IndexStore } from '../src/index/store.js';
import { FakeEmbedder } from '../src/index/embedder.js';
import { scanOnce, contentHash, sha256 } from '../src/index/scanner.js';
import { atomicFrontmatterEdit } from '../src/vault/atomicEdit.js';
import { editFrontmatter, setFrontmatterField } from '../src/vault/frontmatter.js';
const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
run('indexerVolatile', () => {
  let root, store, pool, opts, original, initial;
  const collection = `volatile-${process.pid}-${Date.now()}`;
  const note = () => path.join(root, 'notes/x.md');
  const snapshot = async () =>
    (
      await pool.query(
        'SELECT d.content_sha256, array_agg(c.id ORDER BY c.id) AS chunks, (SELECT count(*)::int FROM doc_history h WHERE h.document_id=d.id) AS history FROM documents d JOIN chunks c ON c.document_id=d.id WHERE d.collection=$1 GROUP BY d.id',
        [collection]
      )
    ).rows[0];
  let editMtime = new Date('2027-01-01T00:00:00Z').getTime();
  const edit = async (key, value) => {
    expect(
      await atomicFrontmatterEdit(note(), d => setFrontmatterField(d, key, value), {
        minAgeMs: 0,
        now: new Date('2028-01-01T00:00:00Z'),
        onlyKey: key,
      })
    ).toBe('written');
    const date = new Date((editMtime += 5000));
    await fs.utimes(note(), date, date);
  };
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'volatile-'));
    await fs.mkdir(path.join(root, 'notes'));
    original = '---\ntitle: X\nsummary: Example\naliases: []\n---\n# X\nBody\n';
    await fs.writeFile(note(), original);
    store = new IndexStore({ connectionString: process.env.TEST_DATABASE_URL, collection });
    await store.ensureSchema('fake', 64);
    pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
    opts = {
      vaultPath: root,
      store,
      embedder: new FakeEmbedder(64),
      frontmatterLinkKeys: [],
      volatileKeys: ['heat'],
    };
  });
  afterAll(async () => {
    await store?.truncateCollection();
    await store?.close();
    await pool?.end();
    if (root) await fs.rm(root, { recursive: true, force: true });
  });
  it('indexes the original note', async () => {
    expect((await scanOnce(opts)).changed).toBe(1);
    initial = await snapshot();
    expect(initial.content_sha256).toBe(sha256(original));
  });
  it('adding heat preserves hash, chunks, and history', async () => {
    await edit('heat', 3);
    expect((await scanOnce(opts)).changed).toBe(0);
    expect(await snapshot()).toEqual(initial);
  });
  it('deleting heat round-trips three byte-exact fixtures', () => {
    for (const text of [
      '---\ntitle: X\nsummary: Example\n---\n# X\n',
      '---\r\ntitle: X\r\nsummary: Example\r\n---\r\n# X\r\n',
      '---\ntitle: X\naliases: []\n---\n# X\n',
    ]) {
      const withHeat = editFrontmatter(text, d => setFrontmatterField(d, 'heat', 3)).content;
      expect(contentHash(withHeat, ['heat'])).toBe(sha256(text));
    }
  });
  it('changing heat still preserves chunks and history', async () => {
    await edit('heat', 4);
    const update = vi.spyOn(store, 'upsertDocumentStat');
    expect((await scanOnce(opts)).changed).toBe(0);
    expect(update).toHaveBeenCalledTimes(1);
    update.mockRestore();
    expect(await snapshot()).toEqual(initial);
  });
  it('changing summary re-embeds and records history', async () => {
    await edit('summary', 'Different summary');
    expect((await scanOnce(opts)).changed).toBe(1);
    const next = await snapshot();
    expect(next.chunks).not.toEqual(initial.chunks);
    expect(next.history).toBe(initial.history + 1);
  });
});
