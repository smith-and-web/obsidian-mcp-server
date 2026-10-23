import { describe, it, expect } from 'vitest';
import { DEFAULT_RANKING, parseRankingEnv, rankingEnv } from '../src/index/ranking.js';
import { readIndexConfig } from '../src/index/config.js';

describe('ranking environment', () => {
  it('uses defaults for unset and empty variables', () => {
    expect(parseRankingEnv({})).toEqual(DEFAULT_RANKING);
    expect(
      parseRankingEnv(
        Object.fromEntries(Object.keys(rankingEnv(DEFAULT_RANKING)).map(k => [k, '']))
      )
    ).toEqual(DEFAULT_RANKING);
  });
  it.each([
    ['SEARCH_FUSION', 'dbsf', 'fusion', 'dbsf'],
    ['SEARCH_RRF_K', '1', 'rrfK', 1],
    ['SEARCH_RRF_K', '1000', 'rrfK', 1000],
    ['SEARCH_W_VECTOR', '0', 'wVector', 0],
    ['SEARCH_W_VECTOR', '1.5', 'wVector', 1.5],
    ['SEARCH_W_TEXT', '10', 'wText', 10],
    ['SEARCH_W_TEXT', '0', 'wText', 0],
    ['SEARCH_PER_NOTE_CAP', '8', 'perNoteCap', 8],
  ])('accepts %s=%s', (name, value, key, expected) => {
    expect(parseRankingEnv({ [name]: value })[key]).toBe(expected);
  });
  for (const [name, values, allowed] of [
    ['SEARCH_FUSION', ['other', 'RRF', ' '], 'expected rrf or dbsf'],
    ['SEARCH_RRF_K', ['0', '1001', '1.5', 'NaN', 'Infinity'], 'expected an integer from 1 to 1000'],
    ['SEARCH_W_VECTOR', ['-1', '11', 'NaN', 'Infinity'], 'expected a number from 0 to 10'],
    ['SEARCH_W_TEXT', ['-1', '11', 'NaN', 'Infinity'], 'expected a number from 0 to 10'],
    [
      'SEARCH_PER_NOTE_CAP',
      ['-1', '9', '0.5', 'NaN', 'Infinity'],
      'expected an integer from 0 to 8',
    ],
  ]) {
    it.each(values)(`rejects ${name}=%s with the exact error`, value => {
      expect(() => parseRankingEnv({ [name]: value })).toThrowError(
        `Invalid ${name}=${value}: ${allowed}`
      );
    });
  }
  it('rejects both weights zero', () => {
    expect(() => parseRankingEnv({ SEARCH_W_VECTOR: '0', SEARCH_W_TEXT: '0' })).toThrowError(
      'Invalid SEARCH_W_VECTOR/SEARCH_W_TEXT: both are 0'
    );
  });
  it('wires ranking into index configuration and rejects invalid startup values', () => {
    expect(readIndexConfig({ DATABASE_URL: 'unused' }).ranking).toEqual(DEFAULT_RANKING);
    expect(() => readIndexConfig({ DATABASE_URL: 'unused', SEARCH_FUSION: 'bad' })).toThrowError(
      'Invalid SEARCH_FUSION=bad: expected rrf or dbsf'
    );
    expect(readIndexConfig({})).toBeNull();
  });
});
