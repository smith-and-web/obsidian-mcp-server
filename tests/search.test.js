import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { SearchService } from '../src/index/SearchService.js';
import { scanOnce } from '../src/index/scanner.js';
import { IndexStore } from '../src/index/store.js';
import { DEFAULT_RANKING } from '../src/index/ranking.js';
import pgvector from 'pgvector/pg';

/**
 * End-to-end against a real pgvector. Skipped unless TEST_DATABASE_URL is set.
 * Uses the fake embedder (bag-of-words hashing) so no model is needed; the
 * assertions are about plumbing and ranking shape, not embedding quality.
 */
const DB = process.env.TEST_DATABASE_URL;
const run = DB ? describe : describe.skip;

run('semantic index end to end', () => {
  let root;
  let service;
  const collection = `test-${process.pid}-${Date.now()}`;

  const write = async (rel, content) => {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  };

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-search-'));
    await write(
      'Areas/ubuntubox.md',
      `---
title: ubuntubox
type: area
status: active
tags: [infra, docker]
summary: Docker on ubuntubox waits for the NFS mount before starting.
---
# ubuntubox

## Docker waits for the mount

RequiresMountsFor=/dsm in a systemd drop-in so docker never starts against an empty directory.

## Wake on LAN

ErP Ready must be disabled in the BIOS or the NIC has no standby power.
`
    );
    await write(
      'Reference/sourdough.md',
      `---
title: Sourdough
type: reference
tags: [cooking]
summary: A weekend sourdough schedule.
---
# Sourdough

Feed the starter, autolyse, bulk ferment, shape, cold proof overnight, bake at 250C.
`
    );
    await write(
      'Decisions/adr-001.md',
      `---
title: ADR 001 separate family law tenant
type: decision
status: done
tags: [security]
summary: The family law corpus stays on its own encrypted database.
---
# Context

Privileged material must not share a key with the general vault.

# Decision

Keep familylaw-db separate; federate at the client.
`
    );
    await write(
      'Inbox/private.md',
      `---\nindex: false\n---\n# Secret\n\nnever indexed hostname zzqqxx`
    );
    await write('_templates/.noindex', '');
    await write('_templates/project.md', '# Template\n\ntemplate body');

    service = await SearchService.create(
      {
        databaseUrl: DB,
        collection,
        embedder: { provider: 'fake', dim: 64, model: 'fake' },
        intervalSeconds: 60,
      },
      root
    );
    const stats = await scanOnce({
      vaultPath: root,
      store: service.store,
      embedder: service.embedder,
    });
    expect(stats.errors).toBe(0);
    expect(stats.changed).toBe(3);
  });

  afterAll(async () => {
    if (service) {
      await service.store.truncateCollection();
      await service.close();
    }
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it('reports status with counts and a finished run after a pass', async () => {
    const runId = await service.store.startRun();
    await service.store.finishRun(runId, { seen: 3, changed: 0, removed: 0, errors: 0 });
    const status = await service.indexStatus();
    expect(status.embedModel).toBe('fake');
    expect(status.dim).toBe(64);
    expect(status.documents).toBe(3);
    expect(status.chunks).toBeGreaterThan(6);
    expect(status.lastRun.seen).toBe(3);
    expect(status.lagSeconds).toBeGreaterThanOrEqual(0);
  });

  it('never indexes index: false notes or .noindex directories', async () => {
    const r = await service.semanticSearch('zzqqxx', { mode: 'text' });
    expect(r.results).toEqual([]);
    const t = await service.semanticSearch('template body', { mode: 'text' });
    expect(t.results).toEqual([]);
  });

  it('finds an exact token through the full-text leg', async () => {
    const r = await service.semanticSearch('RequiresMountsFor', { mode: 'hybrid' });
    expect(r.results[0].path).toBe('Areas/ubuntubox.md');
    expect(r.results[0].headingPath).toBe('ubuntubox › Docker waits for the mount');
    expect(r.results[0].textRank).toBe(1);
  });

  it('ranks the topically related note first on the vector leg', async () => {
    const r = await service.semanticSearch('docker systemd mount drop-in', { mode: 'vector' });
    expect(r.results[0].path).toBe('Areas/ubuntubox.md');
    expect(r.results[0].vectorRank).toBe(1);
  });

  it('applies type, status, tags and directory filters', async () => {
    const byType = await service.semanticSearch('separate database', { type: 'decision' });
    expect(byType.results.every(h => h.path === 'Decisions/adr-001.md')).toBe(true);
    expect(byType.results.length).toBeGreaterThan(0);

    const byStatus = await service.semanticSearch('docker', { status: 'active' });
    expect(byStatus.results.every(h => h.path === 'Areas/ubuntubox.md')).toBe(true);

    const byTag = await service.semanticSearch('bake bread', { tags: ['cooking'] });
    expect(byTag.results.every(h => h.path === 'Reference/sourdough.md')).toBe(true);

    const byDir = await service.semanticSearch('docker', { directory: 'Reference' });
    expect(byDir.results.every(h => h.path.startsWith('Reference/'))).toBe(true);
  });

  it('returns similar notes by centroid and excludes the note itself', async () => {
    const r = await service.similarNotes('Areas/ubuntubox.md', 5);
    expect(r.results.length).toBe(2);
    expect(r.results.every(h => h.path !== 'Areas/ubuntubox.md')).toBe(true);
  });

  it('re-indexes a changed note and removes a deleted one on the next pass', async () => {
    await write(
      'Reference/sourdough.md',
      '---\ntitle: Sourdough\n---\n# Sourdough\n\nnow about pizza dough qqpizzaqq'
    );
    await fs.rm(path.join(root, 'Decisions/adr-001.md'));
    const stats = await scanOnce({
      vaultPath: root,
      store: service.store,
      embedder: service.embedder,
    });
    expect(stats.changed).toBe(1);
    expect(stats.removed).toBe(1);
    const r = await service.semanticSearch('qqpizzaqq', { mode: 'text' });
    expect(r.results[0].path).toBe('Reference/sourdough.md');
    const gone = await service.semanticSearch('familylaw-db', { mode: 'text' });
    expect(gone.results).toEqual([]);
  });

  it('resolves wikilinks by exact path and by unique basename, leaves ambiguous ones NULL', async () => {
    await write(
      'Areas/linker.md',
      '# Linker\n\n[[Areas/ubuntubox]] [[sourdough]] [[dup]] [[nowhere]]'
    );
    await write('Projects/dup.md', '# dup one');
    await write('Reference/dup.md', '# dup two');
    await scanOnce({ vaultPath: root, store: service.store, embedder: service.embedder });
    const rows = await service.store['pool'].query(
      `SELECT l.target_path, d.path AS resolved
       FROM links l JOIN documents s ON s.id = l.src_document_id
       LEFT JOIN documents d ON d.id = l.target_document_id
       WHERE s.collection = $1 AND s.path = 'Areas/linker.md' ORDER BY l.target_path`,
      [collection]
    );
    const byTarget = Object.fromEntries(rows.rows.map(r => [r.target_path, r.resolved]));
    expect(byTarget['Areas/ubuntubox']).toBe('Areas/ubuntubox.md');
    expect(byTarget['sourdough']).toBe('Reference/sourdough.md');
    expect(byTarget['dup']).toBeNull();
    expect(byTarget['nowhere']).toBeNull();
    // A note created later with that basename resolves the dangling link.
    await write('Inbox/nowhere.md', '# found');
    await scanOnce({ vaultPath: root, store: service.store, embedder: service.embedder });
    const later = await service.store['pool'].query(
      `SELECT d.path FROM links l JOIN documents d ON d.id = l.target_document_id WHERE l.target_path = 'nowhere'`
    );
    expect(later.rows[0].path).toBe('Inbox/nowhere.md');
  });

  it('reindex-note works for a path and refuses escapes and excluded paths', async () => {
    const ok = await service.reindexNote('Areas/ubuntubox.md');
    expect(ok.indexed).toBe(true);
    const excluded = await service.reindexNote('.obsidian/app.json');
    expect(excluded.indexed).toBe(false);
    await expect(service.reindexNote('../../etc/passwd')).rejects.toThrow(/escapes vault/);
    const missing = await service.reindexNote('Inbox/nope.md');
    expect(missing.indexed).toBe(false);
  });

  it('refuses to index with a different model over an existing index', async () => {
    await expect(
      SearchService.create(
        {
          databaseUrl: DB,
          collection,
          embedder: { provider: 'fake', dim: 32, model: 'other-fake' },
          intervalSeconds: 60,
        },
        root
      )
    ).rejects.toThrow(/refusing to index/);
  });
});


run('configurable ranking against pgvector', () => {
  let root;
  let service;
  let forced;
  let readOnly;
  const collection = `test-ranking-${process.pid}-${Date.now()}`;
  const LEGACY_SQL = `
      WITH v AS (
        SELECT c.id, 1 - (c.embedding <=> $2::vector) AS score,
               row_number() OVER (ORDER BY c.embedding <=> $2::vector) AS rn
        FROM chunks c JOIN documents d ON d.id = c.document_id
        WHERE d.collection = $1
        ORDER BY c.embedding <=> $2::vector
        LIMIT $3), t AS (
        SELECT c.id, ts_rank_cd(c.tsv, websearch_to_tsquery('english', $4)) AS score,
               row_number() OVER (ORDER BY ts_rank_cd(c.tsv, websearch_to_tsquery('english', $4)) DESC, c.id) AS rn
        FROM chunks c JOIN documents d ON d.id = c.document_id
        WHERE d.collection = $1 AND c.tsv @@ websearch_to_tsquery('english', $4)
        ORDER BY score DESC, c.id
        LIMIT $5),
      fused AS (
        SELECT COALESCE(v.id, t.id) AS id,
               COALESCE(1.0 / (60 + v.rn), 0) + COALESCE(1.0 / (60 + t.rn), 0) AS rrf,
               v.rn AS vrn, t.rn AS trn
        FROM v FULL OUTER JOIN t ON v.id = t.id
      )
      SELECT d.path, d.title, c.heading_path, c.ord, c.content, f.rrf, f.vrn, f.trn
      FROM fused f JOIN chunks c ON c.id = f.id JOIN documents d ON d.id = c.document_id
      ORDER BY f.rrf DESC, c.ord ASC, c.id ASC
      LIMIT $6`;
  const write = async (rel, content) => {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  };

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-ranking-'));
    for (let n = 0; n < 3; n++) {
      await write(
        `Decisions/choice-${n}.md`,
        `---
title: alpha
type: decision
---
# alpha

${Array.from({ length: 4 }, (_, i) => `## Section ${n} ${i}\n\n${'alpha '.repeat(12 + n * 4 + i)}`).join('\n\n')}`
      );
    }
    for (let n = 0; n < 150; n++) {
      await write(`Filler/item-${n}.md`, `# Filler ${n}\n\nalpha beta gamma filler ${n}`);
    }
    await write(
      'Areas/ubuntubox.md',
      '---\ntitle: ubuntubox\ntype: area\nstatus: active\ntags: [infra, docker]\nsummary: Docker on ubuntubox waits for the NFS mount before starting.\n---\n# ubuntubox\n\n## Docker waits for the mount\n\nRequiresMountsFor=/dsm in a systemd drop-in so docker never starts against an empty directory.\n\n## Wake on LAN\n\nErP Ready must be disabled in the BIOS or the NIC has no standby power.\n'
    );
    service = await SearchService.create(
      {
        databaseUrl: DB,
        collection,
        embedder: { provider: 'fake', dim: 64, model: 'fake' },
        intervalSeconds: 60,
        ranking: DEFAULT_RANKING,
      },
      root
    );
    const stats = await scanOnce({
      vaultPath: root,
      store: service.store,
      embedder: service.embedder,
    });
    expect(stats.errors).toBe(0);
    expect(stats.changed).toBe(154);
    // A selective join can use B-tree/bitmap scans plus a sort even when
    // sequential scans are disabled. Discourage that sort so this test
    // actually exercises HNSW; these options never affect production.
    forced = new IndexStore({
      connectionString: DB,
      collection,
      pgOptions: '-c enable_seqscan=off -c enable_sort=off',
    });
    readOnly = new IndexStore({ connectionString: DB, collection, readOnly: true });
  }, 30000);

  afterAll(async () => {
    try {
      if (service) {
        await service.store['pool'].query("DELETE FROM meta WHERE key = 'ro-probe'");
        await service.store.truncateCollection();
      }
    } finally {
      await Promise.all([service?.close(), forced?.close(), readOnly?.close()]);
      if (root) await fs.rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    'RequiresMountsFor',
    'docker systemd mount drop-in',
    'alpha decision',
    'bake bread',
    'zzzznomatch',
  ])('matches legacy scores and tie-group membership: %s', async query => {
    const [vector] = await service.embedder.embed([query]);
    const hits = await service.store.search(vector, query, { k: 50, ranking: DEFAULT_RANKING });
    const legacy = await service.store['pool'].query(LEGACY_SQL, [
      collection,
      pgvector.toSql(vector),
      50,
      query,
      50,
      50,
    ]);
    const expected = legacy.rows.map(r => ({ ...r, score: Number(Number(r.rrf).toFixed(5)) }));
    expect(hits.map(h => h.score)).toEqual(expected.map(h => h.score));
    for (let start = 0; start < hits.length;) {
      let end = start + 1;
      while (end < hits.length && hits[end].score === hits[start].score) end++;
      expect(new Set(hits.slice(start, end).map(h => `${h.path}#${h.ord}`))).toEqual(
        new Set(expected.slice(start, end).map(h => `${h.path}#${h.ord}`))
      );
      start = end;
    }
  });

  it('uses the HNSW index and fills a filtered vector result', async () => {
    const [vector] = await service.embedder.embed(['alpha beta gamma']);
    const plan = await forced['pool'].query(
      `EXPLAIN
      SELECT c.id, c.document_id, c.ord, 1 - (c.embedding <=> $3::vector) AS score,
             row_number() OVER (ORDER BY c.embedding <=> $3::vector) AS rn
      FROM chunks c JOIN documents d ON d.id = c.document_id
      WHERE d.collection = $1 AND d.path LIKE $2 || '%'
      ORDER BY c.embedding <=> $3::vector
      LIMIT $4`,
      [collection, 'Decisions/', pgvector.toSql(vector), 40]
    );
    expect(plan.rows.map(r => r['QUERY PLAN']).join('\n')).toContain('chunks_embedding_hnsw');
    const hits = await forced.search(vector, 'alpha beta gamma', {
      directory: 'Decisions',
      k: 8,
      mode: 'vector',
    });
    expect(hits).toHaveLength(8);
    expect(hits.every(h => h.path.startsWith('Decisions/'))).toBe(true);
  });

  it('enforces read-only database access', async () => {
    await expect(
      readOnly['pool'].query("INSERT INTO meta (key, value) VALUES ('ro-probe', 'x')")
    ).rejects.toThrow(/read-only/);
  });

  it('caps chunks per note while the baseline permits at least three', async () => {
    const [vector] = await service.embedder.embed(['alpha']);
    const counts = hits =>
      Object.values(hits.reduce((acc, h) => ({ ...acc, [h.path]: (acc[h.path] ?? 0) + 1 }), {}));
    const baseline = await service.store.search(vector, 'alpha', {
      k: 8,
      ranking: DEFAULT_RANKING,
    });
    expect(Math.max(...counts(baseline))).toBeGreaterThanOrEqual(3);
    const capped = await service.store.search(vector, 'alpha', {
      k: 8,
      ranking: { ...DEFAULT_RANKING, perNoteCap: 2 },
    });
    expect(Math.max(...counts(capped))).toBeLessThanOrEqual(2);
  });
});

run('transaction error handling', () => {
  let root;
  let service;
  const collection = `test-tx-${process.pid}-${Date.now()}`;

  /**
   * Hand the next pool.connect() back with `query` stubbed so statements
   * matching `failOn` reject with `original` and ROLLBACK rejects too, as when
   * the connection dies mid-transaction. `release` is spied either way.
   */
  const wrapNextClient = (failOn, original) => {
    const pool = service.store['pool'];
    const connect = pool.connect.bind(pool);
    const holder = {};
    vi.spyOn(pool, 'connect').mockImplementationOnce(async () => {
      const client = await connect();
      if (failOn) {
        const query = client.query.bind(client);
        client.query = (text, ...rest) => {
          if (typeof text === 'string' && failOn(text)) return Promise.reject(original);
          if (text === 'ROLLBACK') return Promise.reject(new Error('rollback failed'));
          return query(text, ...rest);
        };
      }
      holder.release = vi.spyOn(client, 'release');
      return client;
    });
    return holder;
  };

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-tx-'));
    await fs.mkdir(path.join(root, 'Areas'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'Areas/ubuntubox.md'),
      '# ubuntubox\n\nRequiresMountsFor=/dsm in a systemd drop-in.\n'
    );
    service = await SearchService.create(
      {
        databaseUrl: DB,
        collection,
        embedder: { provider: 'fake', dim: 64, model: 'fake' },
        intervalSeconds: 60,
      },
      root
    );
    const stats = await scanOnce({
      vaultPath: root,
      store: service.store,
      embedder: service.embedder,
    });
    expect(stats.changed).toBe(1);
  });

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    if (service) {
      await service.store.truncateCollection();
      await service.close();
    }
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it('search rethrows the original error and destroys the client when ROLLBACK fails', async () => {
    const original = new Error('details query failed');
    const spy = wrapNextClient(text => text.includes('c.heading_path'), original);
    const [vector] = await service.embedder.embed(['RequiresMountsFor']);
    await expect(service.store.search(vector, 'RequiresMountsFor')).rejects.toBe(original);
    expect(spy.release).toHaveBeenCalledTimes(1);
    expect(spy.release.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(spy.release.mock.calls[0][0].message).toBe('rollback failed');
    // The pool still serves searches afterwards.
    expect(await service.store.search(vector, 'RequiresMountsFor')).not.toHaveLength(0);
  });

  it('search releases the client with no argument on success', async () => {
    const spy = wrapNextClient(null);
    const [vector] = await service.embedder.embed(['RequiresMountsFor']);
    expect(await service.store.search(vector, 'RequiresMountsFor')).not.toHaveLength(0);
    expect(spy.release.mock.calls).toEqual([[]]);
  });

  it('upsertDocument rethrows the original error and destroys the client when ROLLBACK fails', async () => {
    const original = new Error('commit failed');
    const spy = wrapNextClient(text => text === 'COMMIT', original);
    const [embedding] = await service.embedder.embed(['tx probe']);
    await expect(
      service.store.upsertDocument({
        path: 'Inbox/tx-probe.md',
        title: 'tx probe',
        frontmatter: null,
        tags: [],
        contentSha256: 'tx-probe',
        mtime: new Date(),
        size: 8,
        chunks: [{ ord: 0, headingPath: '', content: 'tx probe', tokens: 2 }],
        embeddings: [embedding],
        links: [],
      })
    ).rejects.toBe(original);
    expect(spy.release.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});
