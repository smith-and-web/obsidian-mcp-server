import { describe, it, expect } from 'vitest';
import { BUILTIN_PATTERNS, isSensitive } from '../src/learn/redact.js';
import { normalisePath } from '../src/learn/log.js';

describe('learn redaction', () => {
  const samples = [
    '-----BEGIN ' + 'RSA PRIVATE KEY-----',
    'AK' + 'IA' + 'A'.repeat(16),
    'ey' + 'J' + 'a'.repeat(15) + '.' + 'b'.repeat(15) + '.' + 'c'.repeat(10),
    'gh' + 'p_' + 'a'.repeat(36),
    'pass' + 'word=' + 'a'.repeat(16),
    'Bear' + 'er ' + 'a'.repeat(24),
    '?api' + '_key=' + 'a'.repeat(12),
    'a'.repeat(64),
  ];
  it('has exactly eight built-in patterns in the specified order', () => {
    expect(BUILTIN_PATTERNS).toHaveLength(8);
    samples.forEach((sample, i) => expect(BUILTIN_PATTERNS[i].test(sample)).toBe(true));
  });
  it.each(samples.map((sample, i) => [i, sample]))('matches built-in sample %i', (_, sample) => {
    expect(isSensitive(sample, BUILTIN_PATTERNS)).toBe(true);
  });
  it('does not redact ordinary search words', () => {
    expect(isSensitive('ordinary search words', BUILTIN_PATTERNS)).toBe(false);
  });
  it.each([
    ['/a/b', 'a/b.md'],
    ['a/b.md', 'a/b.md'],
    ['\\a', 'a.md'],
  ])('normalises %s', (input, output) => {
    expect(normalisePath(input)).toBe(output);
  });
});
