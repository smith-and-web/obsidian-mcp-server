import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readLearnConfig } from '../src/learn/config.js';
import { BUILTIN_PATTERNS } from '../src/learn/redact.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-config-'));
const file = path.join(root, 'patterns.txt');
afterEach(() => vi.restoreAllMocks());
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
describe('learn config', () => {
  it.each([{}, { LEARN_LOG: '', LEARN_RETENTION_DAYS: '' }])(
    'defaults off with 30 days: %j',
    env => {
      expect(readLearnConfig(env)).toEqual({
        enabled: false,
        patterns: [],
        retentionDays: 30,
        error: null,
      });
    }
  );
  it.each(['yes', 'TRUE', '1', ' '])('rejects LEARN_LOG=%s', value => {
    expect(readLearnConfig({ LEARN_LOG: value })).toEqual({
      enabled: false,
      patterns: [],
      retentionDays: 30,
      error: `Invalid LEARN_LOG=${value}: expected true or false`,
    });
  });
  it.each(['0', '-1', '3651', '1.5', 'NaN', 'Infinity', ' '])('rejects retention=%s', value => {
    expect(() => readLearnConfig({ LEARN_RETENTION_DAYS: value })).not.toThrow();
    expect(readLearnConfig({ LEARN_RETENTION_DAYS: value })).toEqual({
      enabled: false,
      patterns: [],
      retentionDays: 30,
      error: `Invalid LEARN_RETENTION_DAYS=${value}: expected an integer from 1 to 3650`,
    });
  });
  it('requires a patterns file when enabled', () => {
    expect(readLearnConfig({ LEARN_LOG: 'true' }).error).toBe(
      'LEARN_REDACT_PATTERNS_FILE is required when LEARN_LOG=true'
    );
  });
  it('does not read a file when disabled', () => {
    const spy = vi.spyOn(fs, 'readFileSync');
    expect(
      readLearnConfig({ LEARN_LOG: 'false', LEARN_REDACT_PATTERNS_FILE: file }).error
    ).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
  it('fails closed with the exact file error', () => {
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('unreadable');
    });
    expect(readLearnConfig({ LEARN_LOG: 'true', LEARN_REDACT_PATTERNS_FILE: file })).toEqual({
      enabled: false,
      patterns: [],
      retentionDays: 30,
      error: `Cannot read LEARN_REDACT_PATTERNS_FILE ${file}: unreadable`,
    });
  });
  it('skips comments and blanks, trims and appends case-insensitive patterns', () => {
    fs.writeFileSync(file, '# comment\n\n  # indented\n  example-term  \nsecond\n');
    const cfg = readLearnConfig({
      LEARN_LOG: 'true',
      LEARN_REDACT_PATTERNS_FILE: file,
      LEARN_RETENTION_DAYS: '3650',
    });
    expect(cfg).toEqual({
      enabled: true,
      patterns: [...BUILTIN_PATTERNS, /example-term/i, /second/i],
      retentionDays: 3650,
      error: null,
    });
  });
  it('reports a bad regex with its original line number and never throws', () => {
    fs.writeFileSync(file, '# comment\n\n[\n');
    let message;
    try {
      new RegExp('[', 'i');
    } catch (err) {
      message = err.message;
    }
    expect(readLearnConfig({ LEARN_LOG: 'true', LEARN_REDACT_PATTERNS_FILE: file })).toEqual({
      enabled: false,
      patterns: [],
      retentionDays: 30,
      error: `Invalid pattern on line 3 of ${file}: ${message}`,
    });
  });
});
