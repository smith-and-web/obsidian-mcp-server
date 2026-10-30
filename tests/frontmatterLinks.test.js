import { describe, it, expect } from 'vitest';
import { extractFrontmatterLinks, chunkNote } from '../src/index/chunker.js';
import { readIndexConfig } from '../src/index/config.js';
describe('frontmatter links', () => {
  it('extracts configured string and array keys in order', () => {
    expect(extractFrontmatterLinks({ up: ['[[A]]', '[[B|alias]]', 9], same: '[[C#h]]', other: '[[D]]' }, ['up', 'same'])).toEqual(['A', 'B', 'C']);
  });
  it('deduplicates body first and preserves default behavior', () => {
    const text = '---\nup: ["[[A]]", "[[B]]"]\n---\n[[B]] [[C]]';
    expect(chunkNote(text, 'notes/x.md', { frontmatterLinkKeys: ['up'] }).links).toEqual(['B', 'C', 'A']);
    expect(chunkNote(text, 'notes/x.md').links).toEqual(['B', 'C']);
  });
  it('validates and trims key configuration', () => {
    const env = { DATABASE_URL: 'test', INDEX_FRONTMATTER_LINK_KEYS: ' up, ,same ', INDEX_VOLATILE_KEYS: 'heat' };
    expect(readIndexConfig(env).frontmatterLinkKeys).toEqual(['up', 'same']);
    expect(readIndexConfig({ DATABASE_URL: 'test' }).volatileKeys).toEqual([]);
    for (const key of ['INDEX_FRONTMATTER_LINK_KEYS', 'INDEX_VOLATILE_KEYS'])
      expect(() => readIndexConfig({ DATABASE_URL: 'test', [key]: 'a.b' })).toThrow(`Invalid ${key}=a.b: expected comma-separated keys of letters, digits, _ or -`);
  });
});
