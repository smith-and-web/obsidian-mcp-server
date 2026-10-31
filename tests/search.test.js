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
      'notes/host-a.md',
      `---
title: host-a
type: area
status: active
tags: [infra, docker]
summary: Docker on host-a waits for the NFS mount before starting.
---
# host-a

## Docker waits for the mount

RequiresMountsFor=/mnt/data in a systemd drop-in so docker never starts against an empty directory.

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
title: ADR 001 separate archive tenant
type: decision
status: done
tags: [security]
summary: The archive corpus stays on its own encrypted database.
---
# Context

Privileged material must not share a key with the general vault.

# Decision

Keep archive-db separate; federate at the client.
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
    expect(r.results[0].path).toBe('notes/host-a.md');
    expect(r.results[0].headingPath).toBe('host-a › Docker waits for the mount');
    expect(r.results[0].textRank).toBe(1);
  });

  it('ranks the topically related note first on the vector leg', async () => {
    const r = await service.semanticSearch('docker systemd mount drop-in', { mode: 'vector' });
    expect(r.results[0].path).toBe('notes/host-a.md');
    expect(r.results[0].vectorRank).toBe(1);
  });

  it('applies type, status, tags and directory filters', async () => {
    const byType = await service.semanticSearch('separate database', { type: 'decision' });
    expect(byType.results.every(h => h.path === 'Decisions/adr-001.md')).toBe(true);
    expect(byType.results.length).toBeGreaterThan(0);

    const byStatus = await service.semanticSearch('docker', { status: 'active' });
    expect(byStatus.results.every(h => h.path === 'notes/host-a.md')).toBe(true);

    const byTag = await service.semanticSearch('bake bread', { tags: ['cooking'] });
    expect(byTag.results.every(h => h.path === 'Reference/sourdough.md')).toBe(true);

    const byDir = await service.semanticSearch('docker', { directory: 'Reference' });
    expect(byDir.results.every(h => h.path.startsWith('Reference/'))).toBe(true);
  });

  it('returns similar notes by centroid and excludes the note itself', async () => {
    const r = await service.similarNotes('notes/host-a.md', 5);
    expect(r.results.length).toBe(2);
    expect(r.results.every(h => h.path !== 'notes/host-a.md')).toBe(true);
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
    const gone = await service.semanticSearch('archive-db', { mode: 'text' });
    expect(gone.results).toEqual([]);
  });

  it('resolves wikilinks by exact path and by unique basename, leaves ambiguous ones NULL', async () => {
    await write(
      'notes/linker.md',
      '# Linker\n\n[[notes/host-a]] [[sourdough]] [[dup]] [[nowhere]]'
    );
    await write('Projects/dup.md', '# dup one');
    await write('Reference/dup.md', '# dup two');
    await scanOnce({ vaultPath: root, store: service.store, embedder: service.embedder });
    const rows = await service.store['pool'].query(
      `SELECT l.target_path, d.path AS resolved
       FROM links l JOIN documents s ON s.id = l.src_document_id
       LEFT JOIN documents d ON d.id = l.target_document_id
       WHERE s.collection = $1 AND s.path = 'notes/linker.md' ORDER BY l.target_path`,
      [collection]
    );
    const byTarget = Object.fromEntries(rows.rows.map(r => [r.target_path, r.resolved]));
    expect(byTarget['notes/host-a']).toBe('notes/host-a.md');
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
    const ok = await service.reindexNote('notes/host-a.md');
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
      'notes/host-a.md',
      '---\ntitle: host-a\ntype: area\nstatus: active\ntags: [infra, docker]\nsummary: Docker on host-a waits for the NFS mount before starting.\n---\n# host-a\n\n## Docker waits for the mount\n\nRequiresMountsFor=/mnt/data in a systemd drop-in so docker never starts against an empty directory.\n\n## Wake on LAN\n\nErP Ready must be disabled in the BIOS or the NIC has no standby power.\n'
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
    // Use the same iterative HNSW setting as search(), including on a reused database.
    const client = await service.store['pool'].connect();
    let legacy;
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL hnsw.iterative_scan = strict_order');
      legacy = await client.query(LEGACY_SQL, [
        collection,
        pgvector.toSql(vector),
        50,
        query,
        50,
        50,
      ]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
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
    await fs.mkdir(path.join(root, 'notes'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'notes/host-a.md'),
      '# host-a\n\nRequiresMountsFor=/mnt/data in a systemd drop-in.\n'
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

run('learn log end to end', () => {
  let root, service, vault, off, reportStore;
  const collection = `test-learn-${process.pid}-${Date.now()}`;
  const config = {
    databaseUrl: DB,
    collection,
    embedder: { provider: 'fake', dim: 64, model: 'fake' },
    intervalSeconds: 60,
    ranking: DEFAULT_RANKING,
  };
  let call, buildReport;
  const flush = async () => {
    await service.learn.flush();
  };
  const query = async (sql, values = []) => {
    await flush();
    return service.store['pool'].query(sql, values);
  };
  const counts = async () => {
    const r = await query(
      `SELECT
      (SELECT count(*) FROM search_log WHERE collection=$1) AS searches,
      (SELECT count(*) FROM note_reads WHERE collection=$1) AS reads,
      (SELECT count(*) FROM search_feedback f JOIN search_log s ON f.search_id=s.id WHERE s.collection=$1) AS feedback,
      (SELECT count(*) FROM mcp_sessions WHERE collection=$1) AS sessions`,
      [collection]
    );
    return r.rows[0];
  };
  beforeAll(async () => {
    const { BUILTIN_PATTERNS } = await import('../src/learn/redact.js');
    const { VaultManager } = await import('../src/vault/VaultManager.js');
    ({ executeToolCall: call } = await import('../src/tools/handlers.js'));
    ({ buildReport } = await import('../src/learn/report.js'));
    config.learn = {
      enabled: true,
      retentionDays: 30,
      error: null,
      patterns: [...BUILTIN_PATTERNS, /zzredactme/i],
    };
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'learn-vault-'));
    await fs.mkdir(path.join(root, 'notes'));
    await fs.writeFile(
      path.join(root, 'notes/alpha.md'),
      '---\ntitle: Alpha\ntype: reference\n---\n# Alpha\n\n## One\n\nalpha apples\n\n## Two\n\nalpha pears'
    );
    await fs.writeFile(
      path.join(root, 'notes/beta.md'),
      '---\ntitle: Beta\ntype: reference\n---\n# Beta\n\nbeta bananas'
    );
    service = await SearchService.create(config, root);
    vault = new VaultManager(root);
    await scanOnce({ vaultPath: root, store: service.store, embedder: service.embedder });
  });
  afterAll(async () => {
    if (service) {
      await flush();
      await query('DELETE FROM note_reads WHERE collection = ANY($1::text[])', [
        [collection, `${collection}-report`],
      ]);
      await query('DELETE FROM search_log WHERE collection = ANY($1::text[])', [
        [collection, `${collection}-report`],
      ]);
      await query('DELETE FROM mcp_sessions WHERE collection = ANY($1::text[])', [
        [collection, `${collection}-report`],
      ]);
      await service.store.truncateCollection();
    }
    await Promise.all([service?.close(), off?.close(), reportStore?.close()]);
    if (root) await fs.rm(root, { recursive: true, force: true });
  });
  const invoke = (name, args, target = service) =>
    call(name, args, vault, target, { sessionId: null, clientName: 'test' }, target.learn);
  const searchRow = async id => (await query('SELECT * FROM search_log WHERE id=$1', [id])).rows[0];
  it('applies the four learning tables idempotently', async () => {
    await service.store.ensureSchema('fake', 64);
    await service.store.ensureSchema('fake', 64);
    const r = await query(
      "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename IN ('mcp_sessions','search_log','note_reads','search_feedback')"
    );
    expect(Number(r.rows[0].count)).toBe(4);
  });
  it('links search, normalised reads and feedback through tool calls; unknown ids become null', async () => {
    const { randomUUID } = await import('crypto');
    const result = await invoke('semantic-search', { query: 'alpha' });
    expect(result.requestId).toMatch(/^[0-9a-f-]{36}$/);
    const row = await searchRow(result.requestId);
    expect(row.ranker).toBe('rrf-k60-v1-t1-cap0');
    expect(row.params).toEqual({});
    expect(row.results).toContainEqual(
      expect.objectContaining({ path: 'notes/alpha.md', rank: 1 })
    );
    await invoke('read-note', { path: 'notes/alpha.md', requestId: result.requestId });
    await invoke('read-note', { path: '/notes/beta.md', requestId: result.requestId });
    const reads = await query(
      'SELECT path, request_id FROM note_reads WHERE request_id=$1 ORDER BY id',
      [result.requestId]
    );
    expect(reads.rows).toEqual([
      { path: 'notes/alpha.md', request_id: result.requestId },
      { path: 'notes/beta.md', request_id: result.requestId },
    ]);
    expect(
      await invoke('search-feedback', {
        requestId: result.requestId,
        rating: 'positive',
        usedPaths: ['notes/alpha.md'],
      })
    ).toEqual({ recorded: true });
    const feedback = await query('SELECT * FROM search_feedback WHERE search_id=$1', [
      result.requestId,
    ]);
    expect(feedback.rows).toHaveLength(1);
    for (const requestId of [randomUUID(), 'not-a-uuid']) {
      await invoke('read-note', { path: 'notes/beta.md', requestId });
      const last = await query(
        'SELECT request_id FROM note_reads WHERE collection=$1 ORDER BY id DESC LIMIT 1',
        [collection]
      );
      expect(last.rows[0].request_id).toBeNull();
    }
  });
  it('does not log when disabled or return requestId', async () => {
    off = await SearchService.create(
      { ...config, learn: { ...config.learn, enabled: false } },
      root
    );
    const before = await counts();
    expect(await invoke('semantic-search', { query: 'alpha' }, off)).not.toHaveProperty(
      'requestId'
    );
    await invoke('read-note', { path: 'notes/alpha.md' }, off);
    expect(await counts()).toEqual(before);
  });
  it('redacts query text, embedding, tags and directory before storage', async () => {
    const result = await invoke('semantic-search', {
      query: 'alpha zzredactme',
      directory: 'zzredactme',
      tags: ['zzredactme'],
      k: 2,
    });
    expect(await searchRow(result.requestId)).toMatchObject({
      query: null,
      query_embedding: null,
      redacted: true,
      params: { directory: '[redacted]', tags: ['[redacted]'], k: 2 },
    });
  });
  it('logs similar-notes, text searches, section and batch reads without changing their results', async () => {
    const similar = await invoke('similar-notes', { path: 'notes/alpha.md' });
    expect(await searchRow(similar.requestId)).toMatchObject({
      query: 'notes/alpha.md',
      ranker: 'centroid',
      params: {},
    });
    const text = await invoke('search-vault', { query: 'alpha', maxResults: 3 });
    expect(await searchRow(text.requestId)).toMatchObject({
      ranker: 'text-scan',
      params: { maxResults: 3 },
    });
    await invoke('read-section', {
      path: 'notes/alpha.md',
      heading: '## One',
      requestId: text.requestId,
    });
    await invoke('read-multiple-notes', {
      paths: ['notes/alpha.md', 'notes/missing.md'],
      requestId: text.requestId,
    });
    const reads = await query('SELECT tool, path FROM note_reads WHERE request_id=$1 ORDER BY id', [
      text.requestId,
    ]);
    expect(reads.rows).toEqual([
      { tool: 'read-section', path: 'notes/alpha.md' },
      { tool: 'read-multiple-notes', path: 'notes/alpha.md' },
    ]);
    expect(await invoke('semantic-search', { query: ' ' })).not.toHaveProperty('requestId');
  });
  it('clears old query text, embeddings and feedback notes while keeping fresh rows', async () => {
    const old = await invoke('semantic-search', { query: 'alpha' });
    await invoke('search-feedback', {
      requestId: old.requestId,
      rating: 'neutral',
      note: 'old reason',
    });
    await query("UPDATE search_log SET at=now()-interval '200 days' WHERE id=$1", [old.requestId]);
    await query("UPDATE search_feedback SET at=now()-interval '200 days' WHERE search_id=$1", [
      old.requestId,
    ]);
    const fresh = await invoke('semantic-search', { query: 'beta' });
    await flush();
    const retained = await service.store.applyRetention(30);
    expect(retained.queries).toBeGreaterThanOrEqual(1);
    expect(retained.notes).toBeGreaterThanOrEqual(1);
    expect(await searchRow(old.requestId)).toMatchObject({ query: null, query_embedding: null });
    expect(
      (await query('SELECT note FROM search_feedback WHERE search_id=$1', [old.requestId])).rows[0]
        .note
    ).toBeNull();
    expect((await searchRow(fresh.requestId)).query).toBe('beta');
  });
  it('sets session close once and updates client metadata on upsert', async () => {
    const id = `${collection}-session`;
    await service.store.upsertSession({
      sessionId: id,
      transport: 'sse',
      clientName: null,
      clientVersion: null,
    });
    await service.store.upsertSession({
      sessionId: id,
      transport: 'sse',
      clientName: 'test',
      clientVersion: '1',
    });
    await service.store.closeSession(id);
    const row = (await query('SELECT * FROM mcp_sessions WHERE session_id=$1', [id])).rows[0];
    expect(row.closed_at).toBeInstanceOf(Date);
    expect(row.client_name).toBe('test');
    await service.store.closeSession(id);
    expect(
      (await query('SELECT closed_at FROM mcp_sessions WHERE session_id=$1', [id])).rows[0]
        .closed_at
    ).toEqual(row.closed_at);
  });
  it('widens a v1.10.0 transport constraint to allow post, idempotently', async () => {
    await query('ALTER TABLE mcp_sessions DROP CONSTRAINT mcp_sessions_transport_check');
    await query(
      "ALTER TABLE mcp_sessions ADD CONSTRAINT mcp_sessions_transport_check CHECK (transport IN ('sse')) NOT VALID"
    );
    await expect(
      service.store.upsertSession({
        sessionId: `${collection}-old`,
        transport: 'post',
        clientName: null,
        clientVersion: null,
      })
    ).rejects.toThrow(/mcp_sessions_transport_check/);
    await service.store.ensureSchema('fake', 64);
    await service.store.ensureSchema('fake', 64);
    await service.store.upsertSession({
      sessionId: `${collection}-old`,
      transport: 'post',
      clientName: null,
      clientVersion: null,
    });
    await expect(
      query(
        "INSERT INTO mcp_sessions (session_id, collection, transport) VALUES ($1, $2, 'other')",
        [`${collection}-bad`, collection]
      )
    ).rejects.toThrow(/mcp_sessions_transport_check/);
    const r = await query(
      "SELECT count(*) FROM pg_constraint WHERE conrelid = 'mcp_sessions'::regclass AND contype = 'c'"
    );
    expect(Number(r.rows[0].count)).toBe(1);
  });
  it('records a POST /sse session from initialize through tool calls to DELETE', async () => {
    const { createMCPServer } = await import('../src/server/mcp.js');
    const req = (body, headers = {}) => ({
      body,
      query: {},
      get: name => headers[name.toLowerCase()],
    });
    const res = () => {
      const r = { headers: {} };
      r.json = b => ((r.body = b), r);
      r.setHeader = (k, v) => ((r.headers[k.toLowerCase()] = v), r);
      r.status = c => ((r.statusCode = c), r);
      r.end = () => r;
      return r;
    };
    const call = (handlers, headers) =>
      handlers.handlePostRequest(
        req(
          {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: { name: 'semantic-search', arguments: { query: 'alpha' } },
          },
          headers
        ),
        res()
      );
    const first = createMCPServer(vault, service, undefined, service.learn);
    const init = res();
    await first.handlePostRequest(
      req({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { clientInfo: { name: 'post-client', version: '3' } },
      }),
      init
    );
    const sessionId = init.headers['mcp-session-id'];
    expect(
      (
        await query(
          'SELECT transport, client_name, client_version FROM mcp_sessions WHERE session_id=$1',
          [sessionId]
        )
      ).rows[0]
    ).toEqual({ transport: 'post', client_name: 'post-client', client_version: '3' });
    // A second server instance stands in for a restart: it finds the session in the database.
    const restarted = createMCPServer(vault, service, undefined, service.learn);
    for (const handlers of [first, restarted])
      await call(handlers, { 'mcp-session-id': sessionId });
    await call(first, {});
    const rows = (
      await query(
        'SELECT session_id, client_name FROM search_log WHERE collection=$1 ORDER BY at DESC LIMIT 3',
        [collection]
      )
    ).rows;
    expect(rows).toEqual([
      { session_id: null, client_name: 'post' },
      { session_id: sessionId, client_name: 'post-client' },
      { session_id: sessionId, client_name: 'post-client' },
    ]);
    const del = res();
    await restarted.handleSessionDelete(req(undefined, { 'mcp-session-id': sessionId }), del);
    expect(del.statusCode).toBe(204);
    expect(
      (await query('SELECT closed_at FROM mcp_sessions WHERE session_id=$1', [sessionId])).rows[0]
        .closed_at
    ).toBeInstanceOf(Date);
  });
  it('computes report rates from linked reads and feedback in an isolated collection', async () => {
    const { randomUUID } = await import('crypto');
    reportStore = new IndexStore({
      connectionString: DB,
      collection: `${collection}-report`,
      readOnly: false,
    });
    const a = randomUUID(),
      b = randomUUID();
    for (const [id, results] of [
      [
        a,
        [
          { path: 'notes/x.md', ord: 0, rank: 1 },
          { path: 'notes/y.md', ord: 0, rank: 2 },
        ],
      ],
      [b, [{ path: 'notes/x.md', ord: 0, rank: 1 }]],
    ]) {
      await reportStore.insertSearchLog({
        id,
        sessionId: null,
        clientName: 'test',
        tool: 'semantic-search',
        query: 'alpha',
        redacted: false,
        embedding: null,
        params: {},
        ranker: 'test',
        results,
      });
    }
    await reportStore.insertNoteReads(
      ['notes/y.md', 'notes/z.md'].map(path => ({
        sessionId: null,
        clientName: 'test',
        tool: 'read-note',
        path,
        requestId: a,
      }))
    );
    await reportStore.insertFeedback({
      searchId: a,
      source: 'agent',
      rating: 'positive',
      usedPaths: [],
      expectedPaths: [],
      note: null,
      redacted: false,
    });
    await flush();
    const report = await buildReport(reportStore, 30, 'test');
    expect(report.links).toMatchObject({
      usedAt1: 0,
      usedAt3: 0.5,
      usedAt8: 0.5,
      missRate: 0.5,
      linkedSearchRate: 0.5,
    });
    expect(report.feedback.coverage).toBe(0.5);
    expect(report.searches.byTool['semantic-search']).toBe(2);
    expect(report.volumeGate).toBe('fail');
    // Cross-collection read ids do not link, and feedback lookups are collection scoped.
    await service.store.insertNoteReads([
      {
        sessionId: null,
        clientName: 'test',
        tool: 'read-note',
        path: 'notes/alpha.md',
        requestId: a,
      },
    ]);
    expect(await service.store.searchLogExists(a)).toBe(false);
    expect(
      (
        await query(
          'SELECT request_id FROM note_reads WHERE collection=$1 ORDER BY id DESC LIMIT 1',
          [collection]
        )
      ).rows[0].request_id
    ).toBeNull();
  });
  it('drops query_embedding on reset and recreates it with the next dimension', async () => {
    await flush();
    await service.store.resetSchema();
    const missing = await query(
      "SELECT 1 FROM information_schema.columns WHERE table_name='search_log' AND column_name='query_embedding'"
    );
    expect(missing.rows).toHaveLength(0);
    await service.store.ensureSchema('fake', 32);
    const restored = await query(
      "SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute WHERE attrelid='search_log'::regclass AND attname='query_embedding' AND NOT attisdropped"
    );
    expect(restored.rows[0].type).toBe('vector(32)');
    // Restore the shared test schema for subsequent test files.
    await service.store.resetSchema();
    await service.store.ensureSchema('fake', 64);
  });
});

run('trails ranking and shadow logging', () => {
  let root;
  let service;
  let baseline;
  let target;
  let config;
  const collection = `test-shadow-${process.pid}-${Date.now()}`;
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-shadow-'));
    await fs.mkdir(path.join(root, 'notes'));
    for (const name of ['a', 'b', 'c'])
      await fs.writeFile(path.join(root, `notes/${name}.md`), '# Alpha\n\nalpha token');
    config = {
      databaseUrl: DB,
      collection,
      embedder: { provider: 'fake', dim: 64, model: 'fake' },
      intervalSeconds: 60,
      ranking: DEFAULT_RANKING,
      learn: { enabled: true, patterns: [], retentionDays: 30 },
    };
    service = await SearchService.create(config, root);
    await scanOnce({ vaultPath: root, store: service.store, embedder: service.embedder });
    baseline = await service.store.search(null, 'alpha', { mode: 'text', k: 3 });
    expect(baseline).toHaveLength(3);
    target = baseline[2].path;
    await service.store['pool'].query(
      `INSERT INTO trails (collection, path_a, path_b, weight, events, last_at, computed_at)
      VALUES ($1, LEAST($2::text, $3::text), GREATEST($2::text, $3::text), 9, 2, now(), now())`,
      [collection, baseline[0].path, target]
    );
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    if (service) {
      await service.learn.flush();
      await service.store.truncateCollection();
      await service.close();
    }
    if (root) await fs.rm(root, { recursive: true, force: true });
  });
  const searchWith = async trails => {
    const other = await SearchService.create({ ...config, trails }, root);
    try {
      const result = await other.semanticSearch('alpha', { mode: 'text', k: 1 });
      await other.learn.flush();
      const row = (
        await other.store['pool'].query(
          'SELECT ranker, results, shadow FROM search_log WHERE id=$1',
          [result.requestId]
        )
      ).rows[0];
      return { result, row };
    } finally {
      await other.close();
    }
  };
  it('off or absent performs no trailWeights call and keeps results and the ranker id unchanged', async () => {
    const spy = vi.spyOn(service.store, 'trailWeights');
    expect(await service.store.searchRanked(null, 'alpha', { mode: 'text', k: 3 })).toEqual({
      results: baseline,
      shadow: null,
    });
    expect(
      await service.store.searchRanked(null, 'alpha', {
        mode: 'text',
        k: 3,
        trails: { mode: 'off', w: 0.5, anchors: 1 },
      })
    ).toEqual({ results: baseline, shadow: null });
    expect(spy).not.toHaveBeenCalled();
    const { row } = await searchWith({ mode: 'off', w: 0.5, anchors: 1 });
    expect(row.ranker).toBe('rrf-k60-v1-t1-cap0');
    expect(row.shadow).toBeNull();
  });
  it('shadow leaves live order and scores unchanged while fetching the union and logging 1-based shadow ranks', async () => {
    const spy = vi.spyOn(service.store, 'trailWeights');
    const ranked = await service.store.searchRanked(null, 'alpha', {
      mode: 'text',
      k: 1,
      trails: { mode: 'shadow', w: 0.5, anchors: 1 },
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(ranked.results).toEqual(baseline.slice(0, 1));
    expect(ranked.shadow).toEqual({
      ranker: 'rrf-k60-v1-t1-cap0-tr0.5a1',
      results: [{ path: target, ord: baseline[2].ord, rank: 1 }],
    });
    const { result, row } = await searchWith({ mode: 'shadow', w: 0.5, anchors: 1 });
    expect(result.results).toEqual(baseline.slice(0, 1));
    expect(row.ranker).toBe('rrf-k60-v1-t1-cap0');
    expect(row.shadow).toEqual(ranked.shadow);
  });
  it('on returns the reranked order and logs the suffixed ranker', async () => {
    const { result, row } = await searchWith({ mode: 'on', w: 0.5, anchors: 1 });
    expect(result.results[0].path).toBe(target);
    expect(row.ranker).toBe('rrf-k60-v1-t1-cap0-tr0.5a1');
    expect(row.shadow).toBeNull();
  });
  it('stores both edge directions and restricts weights to the supplied documents', async () => {
    const rows = await service.store['pool'].query(
      'SELECT id, path FROM documents WHERE collection=$1',
      [collection]
    );
    const ids = new Map(rows.rows.map(row => [row.path, Number(row.id)]));
    const a = ids.get(baseline[0].path),
      b = ids.get(target);
    expect(await service.store.trailWeights([a, b])).toEqual(
      new Map([
        [`${a}:${b}`, 9],
        [`${b}:${a}`, 9],
      ])
    );
    expect(await service.store.trailWeights([a])).toEqual(new Map());
    expect(await service.store.trailWeights([])).toEqual(new Map());
  });
  it.each(['shadow', 'on'])(
    'a real weights SQL failure cannot abort the search transaction in %s',
    async mode => {
      vi.spyOn(service.store, 'trailWeights').mockImplementation(async () => {
        await service.store['pool'].query('SELECT missing_trails_column_for_test FROM trails');
      });
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const ranked = await service.store.searchRanked(null, 'alpha', {
        mode: 'text',
        k: 3,
        trails: { mode, w: 0.5, anchors: 1 },
      });
      expect(ranked).toEqual({ results: baseline, shadow: null });
      expect(error).toHaveBeenCalledWith(
        'trails-rerank:',
        expect.stringContaining('missing_trails_column_for_test')
      );
      await expect(service.store.search(null, 'alpha', { mode: 'text', k: 3 })).resolves.toEqual(
        baseline
      );
    }
  );
  it.each(['shadow', 'on'])(
    'finishes eight concurrent %s searches without starving the weights pool',
    async mode => {
      const pool = service.store['pool'];
      const previous = pool.options.connectionTimeoutMillis;
      pool.options.connectionTimeoutMillis = 500;
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const searches = await Promise.all(
          Array.from({ length: 8 }, () =>
            service.store.searchRanked(null, 'alpha', {
              mode: 'text',
              k: 1,
              trails: { mode, w: 0.5, anchors: 1 },
            })
          )
        );
        for (const ranked of searches) {
          if (mode === 'shadow') {
            expect(ranked.results).toEqual(baseline.slice(0, 1));
            expect(ranked.shadow.results[0].path).toBe(target);
          } else expect(ranked.results[0].path).toBe(target);
        }
        expect(error).not.toHaveBeenCalled();
      } finally {
        pool.options.connectionTimeoutMillis = previous;
      }
    }
  );
  it('uses 60 for DBSF trail boosts and the configured constant for RRF', async () => {
    for (const [fusion, rrfK, denominator] of [
      ['dbsf', 1, 61],
      ['rrf', 1, 2],
    ]) {
      const options = { mode: 'text', k: 3, ranking: { ...DEFAULT_RANKING, fusion, rrfK } };
      const original = await service.store.search(null, 'alpha', options);
      const result = await service.store.searchRanked(null, 'alpha', {
        ...options,
        trails: { mode: 'on', w: 2, anchors: 1 },
      });
      expect(result.results[0].path).toBe(target);
      expect(result.results[0].score).toBeCloseTo(
        original.find(hit => hit.path === target).score + 2 / denominator,
        4
      );
    }
  });
});
