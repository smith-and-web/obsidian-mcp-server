import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { renderTrailsNote, writeTrailsNote } from '../src/trails/note.js';
const input = {
  notePath: 'notes/Brain trails.md',
  now: new Date('2026-10-31T06:30:05Z'),
  tz: 'America/Halifax',
  minWeight: 1,
  maxSources: 2,
  perNote: 2,
  edges: [
    { pathA: 'notes/alpha.md', pathB: 'notes/beta.md', weight: 2 },
    { pathA: 'notes/alpha.md', pathB: 'notes/gamma.md', weight: 1 },
  ],
  scores: [
    { path: 'notes/alpha.md', score: 3 },
    { path: 'notes/beta.md', score: 2 },
  ],
};
let root;
afterEach(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
});
describe('trails note', () => {
  it('renders the exact Breadcrumbs list note fixture with no intro links', () => {
    expect(renderTrailsNote(input)).toBe(`---
title: "Brain trails"
type: reference
status: active
tags: [generated, trails]
created: "2026-10-31T03:30:05-03:00"
updated: "2026-10-31T03:30:05-03:00"
summary: "Generated nightly: notes most often read together, from the brain's learn log. Do not edit."
index: false
aliases: []
BC-list-note-field: trail
BC-list-note-exclude-index: true
---
# Brain trails

Rebuilt every night by the trails job from which notes are read together. Edits are overwritten. 2 edges at or above weight 1.0, 2 source notes.

- [[notes/alpha]]
  - [[notes/beta]]
  - [[notes/gamma]]
- [[notes/beta]]
  - [[notes/alpha]]
`);
    expect(
      renderTrailsNote(input)
        .split('\n')
        .find(l => l.startsWith('Rebuilt'))
    ).not.toContain('[[');
  });
  it('preserves created and leaves bytes/mtime unchanged when only now differs', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'trails-note-'));
    expect(await writeTrailsNote(root, input)).toBe('written');
    const abs = path.join(root, input.notePath),
      old = await fs.readFile(abs, 'utf8'),
      stat = await fs.stat(abs);
    const later = { ...input, now: new Date('2026-11-02T12:00:00Z') };
    expect(await writeTrailsNote(root, later)).toBe('unchanged');
    expect((await fs.stat(abs)).mtimeMs).toBe(stat.mtimeMs);
    expect(await fs.readFile(abs, 'utf8')).toBe(old);
    expect(await writeTrailsNote(root, { ...later, edges: [] })).toBe('written');
    const next = await fs.readFile(abs, 'utf8');
    expect(next).toContain('created: "2026-10-31T03:30:05-03:00"');
    expect(next).toContain('updated: "2026-11-02T08:00:00-04:00"');
  });
  it('refuses existing user files including empty files', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'trails-note-'));
    await fs.mkdir(path.join(root, 'notes'));
    for (const text of ['user text', '']) {
      await fs.writeFile(path.join(root, input.notePath), text);
      await expect(writeTrailsNote(root, input)).rejects.toThrow('is not a trails note');
      expect(await fs.readFile(path.join(root, input.notePath), 'utf8')).toBe(text);
    }
  });
});

import { vi } from 'vitest';
describe('trails note write guards', () => {
  it('preserves a user replacement created during staging and cleans its own temporary file', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'trails-note-race-'));
    await fs.mkdir(path.join(root, 'notes'));
    const abs = path.join(root, input.notePath),
      temp = path.join(path.dirname(abs), `.${path.basename(abs)}.tmp`);
    const write = fs.writeFile.bind(fs);
    const spy = vi.spyOn(fs, 'writeFile').mockImplementation(async (p, ...args) => {
      const r = await write(p, ...args);
      if (p === temp) await write(abs, 'concurrent user file');
      return r;
    });
    try {
      await expect(writeTrailsNote(root, input)).rejects.toThrow('changed during write');
      expect(await fs.readFile(abs, 'utf8')).toBe('concurrent user file');
      expect(await fs.readdir(path.dirname(abs))).toEqual(['Brain trails.md']);
    } finally {
      spy.mockRestore();
    }
  });
  it('refuses a preexisting staging symlink without truncating another note', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'trails-note-temp-'));
    await fs.mkdir(path.join(root, 'notes'));
    const victim = path.join(root, 'notes/victim.md');
    await fs.writeFile(victim, 'keep');
    await fs.symlink(victim, path.join(root, 'notes/.Brain trails.md.tmp'));
    await expect(writeTrailsNote(root, input)).rejects.toThrow();
    expect(await fs.readFile(victim, 'utf8')).toBe('keep');
    expect((await fs.lstat(path.join(root, 'notes/.Brain trails.md.tmp'))).isSymbolicLink()).toBe(
      true
    );
  });
});
