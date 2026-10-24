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
    ['MAINTAIN_HUB_DAYS', 365],
    ['MAINTAIN_MAX_PER_CLASS', 100],
  ])
    for (const value of ['0', '1.5', String(max + 1), 'oops'])
      it(`${name} rejects ${value}`, () =>
        expect(readMaintainConfig({ ...env, [name]: value })).toEqual({
          error: `Invalid ${name}=${value}: expected an integer from 1 to ${max}`,
        }));
  it('rejects invalid timezones without throwing', () =>
    expect(readMaintainConfig({ ...env, MAINTAIN_TZ: 'bad/zone' })).toEqual({
      error: 'Invalid MAINTAIN_TZ=bad/zone: expected an IANA time zone',
    }));
});
