import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { VaultManager } from '../src/vault/VaultManager.js';
import { applySearchBudget, outlineOf, readBudget } from '../src/vault/budget.js';

const VAULT = './tests/fixtures/vault-budget';

// About 3,000 characters per section, so the note is roughly 2,250 tokens.
const big = [
  '---',
  'title: "Big"',
  'summary: "A big note"',
  '---',
  '# Big',
  '## Status',
  'current '.repeat(375),
  '## Log',
  '### 2026-11-01',
  'old '.repeat(750),
  '```',
  '## not a heading inside a fence',
  '```',
  '### 2026-11-02',
  'older '.repeat(500),
].join('\n');

describe('read outline limit', () => {
  beforeEach(async () => {
    await fs.mkdir(VAULT, { recursive: true });
    await fs.writeFile(path.join(VAULT, 'big.md'), big);
    await fs.writeFile(path.join(VAULT, 'small.md'), '# Small\n\nShort.');
  });
  afterEach(() => fs.rm(VAULT, { recursive: true, force: true }));

  it('is off by default', async () => {
    const r = await new VaultManager(VAULT).readNote('big.md');
    expect(r.content).toBe(big);
    expect(r.outline).toBeUndefined();
  });

  it('returns an outline above the limit, with frontmatter and section sizes', async () => {
    const r = await new VaultManager(VAULT, { readOutlineTokens: 1000 }).readNote('big.md');
    expect(r.outline).toBe(true);
    expect(r.content).toBeUndefined();
    expect(r.frontmatter.summary).toBe('A big note');
    expect(r.tokens).toBeGreaterThan(1000);
    expect(r.sections.map(s => s.heading)).toEqual([
      '# Big',
      '## Status',
      '## Log',
      '### 2026-11-01',
      '### 2026-11-02',
    ]);
    const log = r.sections.find(s => s.heading === '## Log');
    const day1 = r.sections.find(s => s.heading === '### 2026-11-01');
    const day2 = r.sections.find(s => s.heading === '### 2026-11-02');
    expect(log.tokens).toBeGreaterThanOrEqual(day1.tokens + day2.tokens);
    expect(r.hint).toMatch(/read-section/);
    expect(JSON.stringify(r).length).toBeLessThan(big.length / 4);
  });

  it('lists headings that read-section accepts', async () => {
    const vm = new VaultManager(VAULT, { readOutlineTokens: 1000 });
    const { sections } = await vm.readNote('big.md');
    for (const s of sections) {
      const section = await vm.readSection('big.md', s.heading);
      expect(section.content.length).toBeGreaterThan(0);
    }
  });

  it('returns the whole note with full: true, and leaves small notes alone', async () => {
    const vm = new VaultManager(VAULT, { readOutlineTokens: 1000 });
    expect((await vm.readNote('big.md', { full: true })).content).toBe(big);
    expect((await vm.readNote('small.md')).content).toBe('# Small\n\nShort.');
  });

  it('does not change frontmatterOnly reads', async () => {
    const r = await new VaultManager(VAULT, { readOutlineTokens: 1000 }).readNote('big.md', {
      frontmatterOnly: true,
    });
    expect(r.frontmatter.title).toBe('Big');
    expect(r.outline).toBeUndefined();
  });

  it('applies per note in read-multiple-notes and honours full', async () => {
    const vm = new VaultManager(VAULT, { readOutlineTokens: 1000 });
    const r = await vm.readMultipleNotes(['big.md', 'small.md']);
    expect(r.results[0].outline).toBe(true);
    expect(r.results[1].content).toContain('Short.');
    const all = await vm.readMultipleNotes(['big.md'], { full: true });
    expect(all.results[0].content).toBe(big);
  });
});

describe('outlineOf', () => {
  it('skips frontmatter and fenced code', () => {
    const heads = outlineOf('---\ntitle: x\n---\n# A\n```\n# no\n```\n## B\ntext').map(
      s => s.heading
    );
    expect(heads).toEqual(['# A', '## B']);
  });
});

describe('search-vault budget', () => {
  const file = (n, matches, len = 40) => ({
    path: `n${n}.md`,
    matches: Array.from({ length: matches }, (_, i) => ({ line: i + 1, content: 'x'.repeat(len) })),
  });
  const result = files => ({
    query: 'x',
    options: {},
    totalMatches: files.reduce((s, f) => s + f.matches.length, 0),
    filesMatched: files.length,
    results: files,
  });

  it('is off at 0 and leaves small results untouched', () => {
    const r = result([file(1, 2)]);
    expect(applySearchBudget(r, 0)).toBe(r);
    expect(applySearchBudget(r, 4000)).toBe(r);
  });

  it('stops adding files at the budget and keeps the totals', () => {
    const r = applySearchBudget(result(Array.from({ length: 200 }, (_, i) => file(i, 3))), 1000);
    expect(r.truncated).toBe(true);
    expect(r.omittedFiles).toBeGreaterThan(0);
    expect(r.results.length + r.omittedFiles).toBe(200);
    expect(r.filesMatched).toBe(200);
    expect(JSON.stringify(r).length / 4).toBeLessThan(1300);
    expect(r.hint).toMatch(/directory/);
  });

  it('clips long lines and caps matches per file', () => {
    const r = applySearchBudget(result([file(1, 12, 2000)]), 4000);
    expect(r.truncated).toBe(true);
    expect(r.results[0].matches).toHaveLength(5);
    expect(r.results[0].moreMatches).toBe(7);
    expect(r.results[0].matches[0].content.length).toBeLessThanOrEqual(301);
  });

  it('always returns at least one file', () => {
    const r = applySearchBudget(result([file(1, 5, 300), file(2, 5, 300)]), 10);
    expect(r.results).toHaveLength(1);
  });

  it('defaults contextLines to 1 when the budget is on', async () => {
    await fs.mkdir(VAULT, { recursive: true });
    await fs.writeFile(path.join(VAULT, 'c.md'), 'a\nb\nneedle\nd\ne');
    try {
      const on = await new VaultManager(VAULT, { searchBudgetTokens: 4000 }).searchVault('needle');
      expect(on.results[0].matches[0].context.before).toHaveLength(1);
      const off = await new VaultManager(VAULT).searchVault('needle');
      expect(off.results[0].matches[0].context.before).toHaveLength(2);
    } finally {
      await fs.rm(VAULT, { recursive: true, force: true });
    }
  });
});

describe('readBudget', () => {
  it('parses non-negative integers and treats anything else as off', () => {
    expect(readBudget({ X: '6000' }, 'X')).toBe(6000);
    expect(readBudget({}, 'X')).toBe(0);
    expect(readBudget({ X: '' }, 'X')).toBe(0);
    expect(readBudget({ X: '-1' }, 'X')).toBe(0);
    expect(readBudget({ X: 'abc' }, 'X')).toBe(0);
  });
});
