import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { SearchService } from '../src/index/SearchService.js';
import { scanOnce } from '../src/index/scanner.js';

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
