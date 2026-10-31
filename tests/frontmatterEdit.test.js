import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { VaultManager } from '../src/vault/VaultManager.js';

/**
 * Writers must edit frontmatter IN PLACE: fields that are not touched keep their exact text.
 * (The old implementation parsed to an object and dumped it, which turned `title: 2026-10-14`
 * into a UTC timestamp, shifted `created`, restyled lists and dropped empty ones.)
 */
const NOTE = `---
title: 2026-10-14
type: journal
# a comment that must survive
tags: [journal, second-brain]
created: 2026-10-14T09:00:00-03:00
updated: 2026-10-14T09:00:00-03:00
summary: "Finished it: all done"
index: true
aliases: []
---

# 2026-10-14

## Status (2026-10-14)
Old status text.

## Next
Next text.
`;

let root;
let vm;
const write = (rel, content) => fs.writeFile(path.join(root, rel), content);
const read = rel => fs.readFile(path.join(root, rel), 'utf8');
const frontmatterLines = text => text.split('\n---\n')[0].split('\n');

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-fm-edit-'));
  vm = new VaultManager(root);
  await write('note.md', NOTE);
});
afterEach(() => fs.rm(root, { recursive: true, force: true }));

describe('update-frontmatter edits in place', () => {
  it('changes only the touched fields and leaves every other line byte-for-byte', async () => {
    await vm.updateFrontmatter('note.md', {
      updated: '2026-10-14T15:05:00-03:00',
      status: 'active',
    });
    const out = await read('note.md');
    const before = frontmatterLines(NOTE);
    const after = frontmatterLines(out);
    for (const line of before.filter(l => !l.startsWith('updated:'))) expect(after).toContain(line);
    expect(after).toContain('updated: 2026-10-14T15:05:00-03:00');
    expect(after).toContain('status: active');
    // the specific things the old code destroyed:
    expect(out).toContain('title: 2026-10-14\n');
    expect(out).not.toContain('T00:00:00.000Z');
    expect(out).toContain('created: 2026-10-14T09:00:00-03:00\n');
    expect(out).toContain('tags: [journal, second-brain]\n');
    expect(out).toContain('aliases: []\n');
    expect(out).toContain('# a comment that must survive\n');
    expect(out).toContain('summary: "Finished it: all done"\n');
    expect(out.split('\n---\n')[1]).toBe(NOTE.split('\n---\n')[1]); // body untouched
  });

  it('returns the resulting frontmatter object', async () => {
    const r = await vm.updateFrontmatter('note.md', { status: 'done' });
    expect(r.updated).toBe(true);
    expect(r.frontmatter.status).toBe('done');
    expect(r.frontmatter.type).toBe('journal');
  });

  it('deletes a field set to null and appends a new field at the end', async () => {
    await vm.updateFrontmatter('note.md', { index: null, owner: 'owner-a' });
    const lines = frontmatterLines(await read('note.md'));
    expect(lines.some(l => l.startsWith('index:'))).toBe(false);
    expect(lines[lines.length - 1]).toBe('owner: owner-a');
  });

  it('quotes values a YAML 1.1 reader would not read back as strings', async () => {
    await vm.updateFrontmatter('note.md', {
      title: '2026-10-15',
      flag: 'yes',
      version: '1.10',
      note: 'has: a colon',
      tags: ['alpha', '2026'],
    });
    const out = await read('note.md');
    expect(out).toContain('title: "2026-10-15"');
    expect(out).toContain('flag: "yes"');
    expect(out).toContain('version: "1.10"');
    expect(out).toContain('note: "has: a colon"');
    expect(out).toContain('tags: [alpha, "2026"]');
    const back = await vm.getFrontmatter('note.md');
    expect(back.frontmatter.note).toBe('has: a colon');
  });

  it('keeps full timestamps plain, as the vault contract wants', async () => {
    await vm.updateFrontmatter('note.md', { updated: '2026-10-14T16:00:00-03:00' });
    expect(await read('note.md')).toContain('updated: 2026-10-14T16:00:00-03:00\n');
  });

  it('does not fold long strings across lines', async () => {
    const long = 'word '.repeat(60).trim();
    await vm.updateFrontmatter('note.md', { summary: long });
    const lines = frontmatterLines(await read('note.md'));
    expect(lines.filter(l => l.startsWith('summary:'))).toHaveLength(1);
    expect(lines.find(l => l.startsWith('summary:'))).toContain(long);
  });

  it('keeps CRLF line endings', async () => {
    await write('crlf.md', NOTE.replace(/\n/g, '\r\n'));
    await vm.updateFrontmatter('crlf.md', { status: 'active' });
    const out = await read('crlf.md');
    expect(out).toContain('status: active\r\n');
    expect(out.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('refuses to touch frontmatter that is not valid YAML, and leaves the file alone', async () => {
    const bad = `---\ntitle: Broken\nsummary: Finished it: all done\n---\nbody\n`;
    await write('bad.md', bad);
    await expect(vm.updateFrontmatter('bad.md', { status: 'x' })).rejects.toThrow(/not valid YAML/);
    expect(await read('bad.md')).toBe(bad);
  });

  it('creates frontmatter when missing (default) and errors when createIfMissing is false', async () => {
    await write('plain.md', '# Plain\n\ntext\n');
    await expect(
      vm.updateFrontmatter('plain.md', { a: 1 }, { createIfMissing: false })
    ).rejects.toThrow(/No frontmatter found/);
    await vm.updateFrontmatter('plain.md', { type: 'inbox', tags: ['x'] });
    expect(await read('plain.md')).toBe('---\ntype: inbox\ntags: [x]\n---\n# Plain\n\ntext\n');
  });
});

describe('add-tags and remove-tags edit in place', () => {
  it('adds to a flow list without touching other fields', async () => {
    const r = await vm.addTags('note.md', ['new-tag', 'journal']);
    expect(r.added).toEqual(['new-tag']);
    const out = await read('note.md');
    expect(out).toContain('tags: [journal, second-brain, new-tag]\n');
    expect(out).toContain('title: 2026-10-14\n');
    expect(out).toContain('created: 2026-10-14T09:00:00-03:00\n');
    expect(out).toContain('aliases: []\n');
  });

  it('keeps a block list as a block list', async () => {
    await write('block.md', '---\ntitle: B\ntags:\n  - one\n  - two\n---\nbody\n');
    await vm.addTags('block.md', ['three']);
    expect(await read('block.md')).toBe(
      '---\ntitle: B\ntags:\n  - one\n  - two\n  - three\n---\nbody\n'
    );
  });

  it('creates tags when the key is missing', async () => {
    await write('notags.md', '---\ntitle: N\n---\nbody\n');
    await vm.addTags('notags.md', ['a', 'b']);
    expect(await read('notags.md')).toBe('---\ntitle: N\ntags: [a, b]\n---\nbody\n');
  });

  it('removes tags and leaves everything else alone', async () => {
    const r = await vm.removeTags('note.md', ['second-brain'], { location: 'frontmatter' });
    expect(r.removedFrom).toEqual(['frontmatter']);
    const out = await read('note.md');
    expect(out).toContain('tags: [journal]\n');
    expect(out).toContain('title: 2026-10-14\n');
    expect(out).toContain('# a comment that must survive\n');
  });

  it('does not rewrite the file when there is nothing to remove', async () => {
    const before = await read('note.md');
    const r = await vm.removeTags('note.md', ['absent'], { location: 'frontmatter' });
    expect(r.removedFrom).toEqual([]);
    expect(await read('note.md')).toBe(before);
  });

  it('still removes inline tags from a note whose frontmatter is invalid', async () => {
    await write('bad.md', '---\nsummary: Finished it: all done\n---\nbody #old tag\n');
    const r = await vm.removeTags('bad.md', ['old'], { location: 'both' });
    expect(r.removedFrom).toEqual(['inline']);
    expect(await read('bad.md')).toContain('body tag');
  });
});

describe('section tools match headings literally', () => {
  const HEADINGS = [
    '## Status (2026-10-14)',
    '## Alerts (Prometheus, host-a)',
    '## Q&A [draft] + more?',
    '## 100% done | really',
    '## C++ and *stars* $5',
    '## a.b\\c {x}',
  ];
  const doc =
    HEADINGS.map(h => `${h}\nbody of ${h.slice(3)}\n`).join('\n') + '\n## Plain\nplain body\n';

  it('reads, appends to and replaces sections whose headings contain regex characters', async () => {
    await write('h.md', doc);
    for (const h of HEADINGS) {
      const r = await vm.readSection('h.md', h);
      expect(r.content).toContain(`body of ${h.slice(3)}`);
    }
    await vm.appendToSection('h.md', '## Status (2026-10-14)', 'appended line');
    await vm.replaceSection('h.md', '## Alerts (Prometheus, host-a)', 'replaced body');
    const out = await read('h.md');
    expect(out).toContain('body of Status (2026-10-14)\n');
    expect(out).toMatch(/appended line/);
    expect(out).toContain('## Alerts (Prometheus, host-a)\nreplaced body');
    expect(out).not.toContain('body of Alerts (Prometheus, host-a)');
    // neighbouring sections are intact
    expect(out).toContain('body of Q&A [draft] + more?');
    expect(out).toContain('## Plain\nplain body');
  });

  it('does not let a regex-like heading match a different heading', async () => {
    await write('h2.md', '## Cat\ncat body\n\n## C.t\ndot body\n');
    expect((await vm.readSection('h2.md', '## C.t')).content).toContain('dot body');
    expect((await vm.readSection('h2.md', '## C.t')).content).not.toContain('cat body');
  });

  it('still reports a missing heading', async () => {
    await write('h3.md', '## One\nx\n');
    await expect(vm.readSection('h3.md', '## Missing (x)')).rejects.toThrow(/not found/);
  });
});
