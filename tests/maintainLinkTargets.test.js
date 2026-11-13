import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { SearchService } from '../src/index/SearchService.js';
import { scanOnce } from '../src/index/scanner.js';
import { linkTargetMatcher, vaultLinkTargets } from '../src/maintain/vaultTargets.js';

describe('linkTargetMatcher', () => {
  const exists = linkTargetMatcher([
    'Reference/Brain trails.md',
    'Clippings/Archive/Auto-capture 2026-11-12 Kindling d150c6bb.md',
    'Reference/Dup.md',
    'Areas/Dup.md',
    '_attachments/diagram.png',
  ]);
  it('matches a basename with or without .md, ignoring case', () => {
    expect(exists('Brain trails')).toBe(true);
    expect(exists('brain TRAILS.md')).toBe(true);
    expect(exists('Auto-capture 2026-11-12 Kindling d150c6bb')).toBe(true);
  });
  it('matches exact and path-suffix targets', () => {
    expect(exists('Reference/Brain trails')).toBe(true);
    expect(exists('Archive/Auto-capture 2026-11-12 Kindling d150c6bb')).toBe(true);
    expect(exists('Areas/Brain trails')).toBe(false);
  });
  it('counts an ambiguous basename and attachments as existing', () => {
    expect(exists('Dup')).toBe(true);
    expect(exists('diagram.png')).toBe(true);
  });
  it('rejects targets with no file', () => {
    expect(exists('Missing note')).toBe(false);
    expect(exists('')).toBe(false);
    expect(exists('trails')).toBe(false);
  });
});

describe('vaultLinkTargets', () => {
  let root;
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'maint-targets-'));
    for (const rel of [
      'notes/Kept.md',
      'Clippings/Archive/Old clip.md',
      'Clippings/Archive/.noindex',
      '.obsidian/workspace.md',
      '.trash/Deleted.md',
      'notes/@eaDir/Kept.md@SynoEAStream',
    ]) {
      await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
      await fs.writeFile(path.join(root, rel), 'x');
    }
  });
  afterAll(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });
  it('includes .noindex folders but not editor, trash or NAS sidecar folders', async () => {
    const exists = await vaultLinkTargets(root);
    expect(exists('Kept')).toBe(true);
    expect(exists('Old clip')).toBe(true);
    expect(exists('workspace')).toBe(false);
    expect(exists('Deleted')).toBe(false);
  });
});

// Regression for the 2026-W45 report: f54 and f55 proposed "repairing" [[Brain trails]]
// to a plan whose alias is "brain trails", although Reference/Brain trails.md exists
// (generated, index: false). Links into Clippings/Archive (.noindex) looked broken too.
const DB = process.env.TEST_DATABASE_URL;
const run = DB ? describe : describe.skip;
run('maintenance and unindexed link targets', () => {
  let root, service;
  const collection = `test-maint-targets-${process.pid}-${Date.now()}`;
  const write = async (rel, content) => {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), content);
  };
  const note = (title, body, extra = 'index: true\naliases: []') =>
    `---\ntitle: "${title}"\ntype: reference\nsummary: "${title} notes"\nupdated: 2026-10-01\n${extra}\n---\n# ${title}\n\n${body}\n`;
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'maint-targets-db-'));
    await write(
      'Plans/Plan - lantern trails.md',
      note(
        'Plan - lantern trails',
        'Usage trails for lantern.',
        'index: true\naliases: [lantern trails]'
      )
    );
    await write(
      'Reference/Lantern trails.md',
      note('Lantern trails', 'Generated.', 'index: false\naliases: []')
    );
    await write('Clippings/Archive/.noindex', '');
    await write('Clippings/Archive/Lantern clip.md', note('Lantern clip', 'Raw capture.'));
    await write(
      'Reference/Old plan alias.md',
      note('Old plan alias', 'Aliased.', 'index: true\naliases: [Ghost link]')
    );
    await write(
      'Areas/Lantern hub.md',
      note(
        'Lantern hub',
        'See [[Lantern trails]], [[Lantern clip]] and [[Ghost link page]] and [[Ghost link]].'
      )
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
    expect(
      (await scanOnce({ vaultPath: root, store: service.store, embedder: service.embedder })).errors
    ).toBe(0);
  });
  afterAll(async () => {
    if (service) {
      await service.store.truncateCollection();
      await service.close();
    }
    if (root) await fs.rm(root, { recursive: true, force: true });
  });
  it('proposes no repair for a link to an index: false note', async () => {
    const exists = await vaultLinkTargets(root);
    const without = await service.store.findLinkRepairs();
    expect(without.some(c => c.detail.target === 'Lantern trails')).toBe(true);
    const repairs = await service.store.findLinkRepairs(exists);
    expect(repairs.some(c => c.detail.target === 'Lantern trails')).toBe(false);
  });
  it('does not count links to unindexed files as unresolved', async () => {
    const exists = await vaultLinkTargets(root);
    const before = (await service.store.hygieneMetrics()).unresolvedLinks;
    const after = (await service.store.hygieneMetrics(exists)).unresolvedLinks;
    expect(before - after).toBe(2);
    expect(after).toBeGreaterThanOrEqual(1);
  });
});
