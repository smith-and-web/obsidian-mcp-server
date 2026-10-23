import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { validateGolden, loadGolden } from '../src/eval/golden.js';

const valid = () => ({
  version: 1,
  created: '2026-01-01',
  notes: 'synthetic fixture',
  queries: [{ id: 'a', category: 'exact-id', query: 'synthetic token', expected: ['Example.md'] }],
});
describe('golden schema', () => {
  it('accepts a valid document', () => expect(validateGolden(valid())).toEqual([]));
  it.each([
    [g => delete g.notes, 'missing key notes'],
    [g => (g.extra = true), 'unknown key extra'],
    [g => delete g.queries[0].query, 'missing key query'],
    [g => (g.queries[0].extra = true), 'unknown key extra'],
    [g => (g.queries[0].category = 'other'), 'unknown category'],
    [g => g.queries.push({ ...g.queries[0] }), 'duplicate id'],
    [g => (g.queries[0].expected = []), 'non-empty array'],
    [g => g.queries[0].expected.push('Example.md'), 'duplicate expected path'],
    [g => (g.queries[0].expected = ['Example.txt']), 'ending in .md'],
    [g => (g.queries[0].query = ' '), 'non-empty string'],
    [g => (g.created = 'yesterday'), 'YYYY-MM-DD'],
    [g => (g.version = 2), 'expected 1'],
  ])('reports malformed golden data', (mutate, message) => {
    const g = valid();
    mutate(g);
    expect(validateGolden(g).join('\n')).toContain(message);
  });
  it('reports every problem when loading', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-'));
    try {
      const file = path.join(dir, 'fixture.json');
      fs.writeFileSync(file, JSON.stringify({ version: 2, created: 'bad', queries: [] }));
      expect(() => loadGolden(file)).toThrowError(
        /missing key notes[\s\S]*expected 1[\s\S]*YYYY-MM-DD[\s\S]*non-empty array/
      );
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });
});
