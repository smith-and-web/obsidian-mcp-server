import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  isExcludedDirectoryName,
  isExcludedFileName,
  isExcludedByFrontmatter,
  isExcludedPath,
  hasNoindexMarker,
} from '../src/index/exclusions.js';
import { walkVault } from '../src/index/scanner.js';

describe('exclusion rules', () => {
  it('skips editor, trash, VCS and Synology directories', () => {
    for (const d of ['.obsidian', '.trash', '.git', '#recycle', '@eaDir', '@tmp', '.smart-env']) {
      expect(isExcludedDirectoryName(d)).toBe(true);
    }
    expect(isExcludedDirectoryName('Projects')).toBe(false);
  });

  it('skips AppleDouble sidecars, dotfiles, OS litter and non-markdown', () => {
    for (const f of [
      '._note.md',
      '.DS_Store',
      'Thumbs.db',
      '.hidden.md',
      'board.canvas',
      'img.png',
      'x.base',
    ]) {
      expect(isExcludedFileName(f)).toBe(true);
    }
    expect(isExcludedFileName('note.md')).toBe(false);
    expect(isExcludedFileName('NOTE.MD')).toBe(false);
  });

  it('honours index: false in frontmatter', () => {
    expect(isExcludedByFrontmatter({ index: false })).toBe(true);
    expect(isExcludedByFrontmatter({ index: 'false' })).toBe(true);
    expect(isExcludedByFrontmatter({ index: true })).toBe(false);
    expect(isExcludedByFrontmatter(null)).toBe(false);
  });

  it('rejects paths by any component', () => {
    expect(isExcludedPath('.obsidian/app.json')).toBe(true);
    expect(isExcludedPath('Projects/.trash/x.md')).toBe(true);
    expect(isExcludedPath('Projects/._x.md')).toBe(true);
    expect(isExcludedPath('Projects/x.md')).toBe(false);
    expect(isExcludedPath('')).toBe(true);
  });
});

describe('walkVault', () => {
  let root;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-walk-'));
    const mk = async (rel, content = '# x') => {
      const abs = path.join(root, rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content);
    };
    await mk('Inbox/a.md');
    await mk('Projects/b.md');
    await mk('Projects/._b.md');
    await mk('Projects/diagram.canvas', '{}');
    await mk('.obsidian/app.json', '{}');
    await mk('.trash/old.md');
    await mk('@eaDir/a.md/SYNO.jpg');
    await mk('_templates/.noindex', '');
    await mk('_templates/project.md');
    await mk('_attachments/.noindex', '');
    await mk('_attachments/pic.png', '');
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('lists only indexable markdown and honours .noindex', async () => {
    const files = await walkVault(root);
    expect(files.map(f => f.relPath).sort()).toEqual(['Inbox/a.md', 'Projects/b.md']);
    expect(await hasNoindexMarker(path.join(root, '_templates'))).toBe(true);
    expect(await hasNoindexMarker(path.join(root, 'Projects'))).toBe(false);
  });
});
