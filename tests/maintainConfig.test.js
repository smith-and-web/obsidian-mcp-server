import { describe, it, expect } from 'vitest';
import { readMaintainConfig } from '../src/maintain/config.js';
const env = {
  DATABASE_URL: 'postgres://test',
  VAULT_PATH: '/notes',
  MAINTAIN_REPORT_DIR: '/report',
};
describe('maintenance configuration', () => {
  it('defaults and empty strings use the specified defaults', () => {
    expect(readMaintainConfig(env).config).toEqual({
      databaseUrl: 'postgres://test',
      vaultPath: '/notes',
      reportDir: '/report',
      reportVaultDir: '',
      collection: 'default',
      timeZone: 'UTC',
      linkCosine: 0.85,
      dupCosine: 0.92,
      dupTitleSim: 0.6,
      hubDays: 14,
      summaryDrop: 0.05,
      maxPerClass: 10,
      coreadMinWeight: 1.5,
      coreadMinEvents: 2,
      excludeTags: ['code-graph'],
      apply: false,
      applyWeeklyCap: 20,
      applyMinAgeHours: 24,
      guardPatternsFile: '',
      volatileKeys: ['heat'],
    });
    expect(
      readMaintainConfig({
        ...env,
        MAINTAIN_LINK_COSINE: '',
        MAINTAIN_TZ: '',
        INDEX_COLLECTION: '',
      })
    ).toEqual(readMaintainConfig(env));
  });
  for (const name of ['DATABASE_URL', 'VAULT_PATH', 'MAINTAIN_REPORT_DIR'])
    it(`${name} is required`, () => {
      expect(readMaintainConfig({ ...env, [name]: '' })).toEqual({ error: `${name} is required` });
    });
  it('dry needs no report directory', () =>
    expect(readMaintainConfig({ ...env, MAINTAIN_REPORT_DIR: '' }, true).config.reportDir).toBe(
      ''
    ));
  for (const name of [
    'MAINTAIN_LINK_COSINE',
    'MAINTAIN_DUP_COSINE',
    'MAINTAIN_DUP_TITLE_SIM',
    'MAINTAIN_SUMMARY_DROP',
  ])
    for (const value of ['0', '1', 'NaN', '-1', '2'])
      it(`${name} rejects ${value}`, () =>
        expect(readMaintainConfig({ ...env, [name]: value })).toEqual({
          error: `Invalid ${name}=${value}: expected a number between 0 and 1`,
        }));
  for (const [name, max] of [
    ['MAINTAIN_COREAD_MIN_EVENTS', 1000],
    ['MAINTAIN_HUB_DAYS', 365],
    ['MAINTAIN_MAX_PER_CLASS', 100],
  ])
    for (const value of ['0', '1.5', String(max + 1), 'oops'])
      it(`${name} rejects ${value}`, () =>
        expect(readMaintainConfig({ ...env, [name]: value })).toEqual({
          error: `Invalid ${name}=${value}: expected an integer from 1 to ${max}`,
        }));
  it('MAINTAIN_EXCLUDE_TAGS takes a comma list, and empty means none', () => {
    expect(
      readMaintainConfig({ ...env, MAINTAIN_EXCLUDE_TAGS: 'code-graph, generated' }).config
        .excludeTags
    ).toEqual(['code-graph', 'generated']);
    expect(readMaintainConfig({ ...env, MAINTAIN_EXCLUDE_TAGS: '' }).config.excludeTags).toEqual(
      []
    );
  });
  it('MAINTAIN_EXCLUDE_TAGS rejects a tag that could break SQL', () =>
    expect(readMaintainConfig({ ...env, MAINTAIN_EXCLUDE_TAGS: "x'y" })).toEqual({
      error:
        'Invalid MAINTAIN_EXCLUDE_TAGS tag "x\'y": expected lowercase letters, digits, -, _ or /',
    }));
  it('MAINTAIN_APPLY is a strict boolean and the guard file falls back to the learn-log file', () => {
    expect(readMaintainConfig({ ...env, MAINTAIN_APPLY: 'yes' })).toEqual({
      error: 'Invalid MAINTAIN_APPLY=yes: expected true or false',
    });
    const c = readMaintainConfig({
      ...env,
      MAINTAIN_APPLY: 'true',
      LEARN_REDACT_PATTERNS_FILE: '/config/redact.txt',
      INDEX_VOLATILE_KEYS: 'heat, score',
    }).config;
    expect(c.apply).toBe(true);
    expect(c.guardPatternsFile).toBe('/config/redact.txt');
    expect(c.volatileKeys).toEqual(['heat', 'score']);
    expect(
      readMaintainConfig({
        ...env,
        MAINTAIN_GUARD_PATTERNS_FILE: '/g',
        LEARN_REDACT_PATTERNS_FILE: '/l',
      }).config.guardPatternsFile
    ).toBe('/g');
  });
  it('rejects invalid timezones without throwing', () =>
    expect(readMaintainConfig({ ...env, MAINTAIN_TZ: 'bad/zone' })).toEqual({
      error: 'Invalid MAINTAIN_TZ=bad/zone: expected an IANA time zone',
    }));
});
