import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { parseFrontmatter } from '../src/vault/frontmatter.js';
import { chunkNote } from '../src/index/chunker.js';
import { SearchService } from '../src/index/SearchService.js';
import { scanOnce } from '../src/index/scanner.js';

// The classic mistake: an unquoted value that contains ": " is not valid YAML.
const BAD = `---
title: Broken
summary: Finished the garden plan: fixed the settings
tags: [a]
---
# Broken

Body text that is still worth indexing.
`;
const GOOD = BAD.replace(
  'summary: Finished the garden plan: fixed the settings',
  'summary: "Finished the garden plan: fixed the settings"'
);

describe('parseFrontmatter error reporting', () => {
  it('reports why invalid YAML frontmatter failed to parse', () => {
    const r = parseFrontmatter(BAD);
    expect(r.frontmatter).toBeNull();
    expect(r.body).toContain('Body text');
    expect(r.error).toMatch(/\S/);
    expect(r.error).not.toContain('\n');
  });

  it('reports the error every time, not just on the first parse of the same content', () => {
    const first = parseFrontmatter(BAD);
    const second = parseFrontmatter(BAD);
    expect(first.error).toMatch(/\S/);
    expect(second.error).toBe(first.error);
    expect(second.frontmatter).toBeNull();
  });

  it('has no error for valid, absent or empty frontmatter', () => {
    expect(parseFrontmatter(GOOD).error).toBeUndefined();
    expect(parseFrontmatter(GOOD).frontmatter.summary).toContain('fixed the settings');
    expect(parseFrontmatter('# Just a heading\n\nNo frontmatter here.').error).toBeUndefined();
    expect(parseFrontmatter('---\n---\n# Empty block').error).toBeUndefined();
  });

  it('does not flag a note that merely mentions --- later on', () => {
    expect(
      parseFrontmatter('# Title\n\nSome text\n\n---\n\nmore: stuff: here\n').error
    ).toBeUndefined();
  });
});

describe('chunkNote and invalid frontmatter', () => {
  it('surfaces the error but still chunks the note', () => {
    const note = chunkNote(BAD, 'Reference/Broken.md');
    expect(note.frontmatterError).toMatch(/\S/);
    expect(note.chunks.length).toBeGreaterThan(0);
    expect(
      note.chunks.some(c => c.content.includes('Body text that is still worth indexing'))
    ).toBe(true);
  });

  it('has no frontmatterError for a valid note', () => {
    expect(chunkNote(GOOD, 'Reference/Fine.md').frontmatterError).toBeUndefined();
  });
});

const DB = process.env.TEST_DATABASE_URL;
const run = DB ? describe : describe.skip;

run('invalid frontmatter end to end', () => {
  let root;
  let service;
  const collection = `test-fm-${process.pid}-${Date.now()}`;
  const warnings = [];

  const scan = () =>
    scanOnce({
      vaultPath: root,
      store: service.store,
      embedder: service.embedder,
      warn: m => warnings.push(m),
    });

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-fm-'));
    await fs.mkdir(path.join(root, 'Reference'), { recursive: true });
    await fs.writeFile(path.join(root, 'Reference/Broken.md'), BAD);
    await fs.writeFile(path.join(root, 'Reference/Fine.md'), GOOD.replace('Broken', 'Fine'));
    service = await SearchService.create(
      {
        databaseUrl: DB,
        collection,
        embedder: { provider: 'fake', dim: 64, model: 'fake' },
        intervalSeconds: 60,
      },
      root
    );
  });

  afterAll(async () => {
    if (service) {
      await service.store.truncateCollection();
      await service.close();
    }
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it('warns, indexes the body anyway, and lists the note in index-status', async () => {
    const stats = await scan();
    expect(stats.errors).toBe(0);
    expect(stats.changed).toBe(2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('WARN invalid frontmatter in Reference/Broken.md');
    expect(warnings[0]).toContain('quote values');

    const status = await service.indexStatus();
    expect(status.documents).toBe(2);
    expect(status.invalidFrontmatter.count).toBe(1);
    expect(status.invalidFrontmatter.notes).toHaveLength(1);
    expect(status.invalidFrontmatter.notes[0].path).toBe('Reference/Broken.md');
    expect(status.invalidFrontmatter.notes[0].error).toMatch(/\S/);

    const hits = await service.semanticSearch('still worth indexing', { mode: 'text' });
    expect(hits.results.some(h => h.path === 'Reference/Broken.md')).toBe(true);
  });

  it('does not warn again while the note is unchanged', async () => {
    warnings.length = 0;
    await scan();
    expect(warnings).toHaveLength(0);
    expect((await service.indexStatus()).invalidFrontmatter.count).toBe(1);
  });

  it('reindex-note reports the warning', async () => {
    const r = await service.reindexNote('Reference/Broken.md');
    expect(r.indexed).toBe(true);
    expect(r.warning).toContain('invalid frontmatter in Reference/Broken.md');
  });

  it('clears the flag once the note is fixed', async () => {
    await fs.writeFile(path.join(root, 'Reference/Broken.md'), GOOD);
    warnings.length = 0;
    await scan();
    expect(warnings).toHaveLength(0);
    const status = await service.indexStatus();
    expect(status.invalidFrontmatter.count).toBe(0);
    expect(status.invalidFrontmatter.notes).toEqual([]);
  });
});
