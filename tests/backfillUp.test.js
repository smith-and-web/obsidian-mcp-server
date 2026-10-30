import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import pg from 'pg';
import { SearchService } from '../src/index/SearchService.js';
import { scanOnce } from '../src/index/scanner.js';
import { runBackfillUp, readBackfillOptions, main } from '../src/backfill-up.js';
const DB = process.env.TEST_DATABASE_URL;
const run = DB ? describe : describe.skip;
run('backfill-up against pgvector', () => {
  let root, service, pool, planFile;
  const collection = `backfill-${process.pid}-${Date.now()}`;
  const now = new Date('2026-11-01T12:00:00Z');
  const note = (title, type, body, extra = '') =>
    `---\ntitle: ${title}\ntype: ${type}\nupdated: "2026-10-01"\naliases: []\n${extra}---\n${body}\n`;
  const file = n => path.join(root, `notes/${n}.md`);
  const opts = overrides => ({
    plan: planFile,
    apply: false,
    revert: false,
    field: 'up',
    hubTypes: ['project', 'area'],
    childTypes: ['reference', 'decision', 'plan'],
    max: 3,
    ...overrides,
  });
  const perform = async (overrides = {}) => {
    const lines = [];
    await runBackfillUp(service.store, { vaultPath: root }, opts(overrides), {
      now,
      log: l => lines.push(l),
    });
    return lines;
  };
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'backfill-'));
    await fs.mkdir(path.join(root, 'notes'));
    planFile = path.join(root, 'plan.json');
    for (const n of ['alpha', 'changed', 'restyle', 'set', 'orphan'])
      await fs.writeFile(
        file(n),
        note(
          n,
          'reference',
          'Body',
          n === 'restyle' ? 'tags:\n    - one\n' : n === 'set' ? 'up: ["[[existing]]"]\n' : ''
        )
      );
    for (const [n, type] of [
      ['Hub', 'project'],
      ['Hub2', 'area'],
      ['Hub3', 'project'],
      ['Hub4', 'area'],
    ])
      await fs.writeFile(file(n), note(n, type, '[[alpha]] [[changed]] [[restyle]] [[set]]'));
    await fs.mkdir(path.join(root, 'notes/other'));
    await fs.writeFile(
      path.join(root, 'notes/other/Hub.md'),
      note('Hub', 'reference', 'private', 'index: false\n')
    );
    service = await SearchService.create(
      {
        databaseUrl: DB,
        collection,
        embedder: { provider: 'fake', dim: 64, model: 'fake' },
        intervalSeconds: 60,
      },
      root
    );
    expect(
      (
        await scanOnce({
          vaultPath: root,
          store: service.store,
          embedder: service.embedder,
          frontmatterLinkKeys: [],
          volatileKeys: [],
        })
      ).errors
    ).toBe(0);
    pool = new pg.Pool({ connectionString: DB });
    const vec = (a, b) => JSON.stringify([a, b, ...Array(62).fill(0)]);
    await pool.query('UPDATE documents SET centroid=$2::vector WHERE collection=$1', [
      collection,
      vec(1, 0),
    ]);
    for (const [n, a, b] of [
      ['Hub', 1, 0],
      ['Hub2', 0.8, 0.6],
      ['Hub3', 0.6, 0.8],
      ['Hub4', 0, 1],
    ])
      await pool.query('UPDATE documents SET centroid=$3::vector WHERE collection=$1 AND path=$2', [
        collection,
        `notes/${n}.md`,
        vec(a, b),
      ]);
  });
  afterAll(async () => {
    await service?.store.truncateCollection();
    await service?.close();
    await pool?.end();
    if (root) await fs.rm(root, { recursive: true, force: true });
  });
  it('plans in path order, caps by cosine, checks vault-wide basename ambiguity and skips restyling', async () => {
    const lines = await perform();
    const plan = JSON.parse(await fs.readFile(planFile, 'utf8'));
    expect(plan).toMatchObject({
      version: 1,
      createdAt: now.toISOString(),
      field: 'up',
      noHub: ['notes/orphan.md'],
      reformat: ['notes/restyle.md'],
      alreadySet: 1,
    });
    expect(plan.entries.map(e => e.path)).toEqual(['notes/alpha.md', 'notes/changed.md']);
    expect(plan.entries[0].value).toEqual(['[[notes/Hub]]', '[[Hub2]]', '[[Hub3]]']);
    expect(plan.entries[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(lines.at(-1)).toBe('entries: 2, no hub: 1, reformat: 1, already set: 1');
    await perform({ max: 1 });
    expect(JSON.parse(await fs.readFile(planFile, 'utf8')).entries[0].value).toEqual([
      '[[notes/Hub]]',
    ]);
    await perform();
  });
  it('applies flow lists without changing updated and skips changed files', async () => {
    const original = await fs.readFile(file('alpha'), 'utf8');
    await fs.appendFile(file('changed'), 'edited');
    const lines = await perform({ apply: true });
    expect(lines[0]).toBe(
      'written: 1, changed: 1, unchanged: 0, invalid: 0, roundtrip: 0, raced: 0, missing: 0'
    );
    expect(lines[1]).toBe('changed: notes/changed.md');
    const after = await fs.readFile(file('alpha'), 'utf8');
    expect(after).toContain('up: ["[[notes/Hub]]", "[[Hub2]]", "[[Hub3]]"]');
    expect(after.replace(/^up:.*\n/m, '')).toBe(original);
    expect(await fs.readFile(file('changed'), 'utf8')).not.toContain('up:');
  });
  it('reverts a block-list representation and preserves a differing value', async () => {
    const text = await fs.readFile(file('alpha'), 'utf8');
    await fs.writeFile(
      file('alpha'),
      text.replace(/^up:.*$/m, 'up:\n  - "[[notes/Hub]]"\n  - "[[Hub2]]"\n  - "[[Hub3]]"')
    );
    const changed = await fs.readFile(file('changed'), 'utf8');
    await fs.writeFile(file('changed'), changed.replace('---\n', '---\nup: ["[[Different]]"]\n'));
    const lines = await perform({ revert: true });
    expect(lines[0]).toBe(
      'written: 1, changed: 1, unchanged: 0, invalid: 0, roundtrip: 0, raced: 0, missing: 0'
    );
    expect(await fs.readFile(file('alpha'), 'utf8')).not.toContain('up:');
    expect(await fs.readFile(file('alpha'), 'utf8')).toContain('updated: "2026-10-01"');
    expect(await fs.readFile(file('changed'), 'utf8')).toContain('up: ["[[Different]]"]');
  });
});
describe('backfill argument and config errors', () => {
  it('requires plan, exclusive modes and valid field/max', async () => {
    for (const args of [
      [],
      ['--plan', 'x', '--apply', '--revert'],
      ['--plan', 'x', '--max', '0'],
      ['--plan', 'x', '--field', 'bad.key'],
      ['--unknown'],
    ])
      expect(readBackfillOptions(args)).toHaveProperty('error');
    expect(await main(['--plan', 'x'], {})).toBe(2);
  });
});

import { vi } from 'vitest';
import { sha256 } from '../src/index/scanner.js';
describe('backfill write guards', () => {
  it('checks the SHA of the exact content edited, after the caller read', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'backfill-race-'));
    let spy;
    try {
      await fs.mkdir(path.join(root, 'notes'));
      const file = path.join(root, 'notes/child.md'),
        plan = path.join(root, 'plan.json');
      const original = '---\ntitle: Child\n---\nBody\n',
        competing = '---\ntitle: Child\nup: ["[[Different]]"]\n---\nBody\n';
      await fs.writeFile(file, original);
      await fs.writeFile(
        plan,
        JSON.stringify({
          version: 1,
          field: 'up',
          entries: [{ path: 'notes/child.md', sha256: sha256(original), value: ['[[Hub]]'] }],
        })
      );
      const stat = fs.stat.bind(fs);
      let injected = false;
      spy = vi.spyOn(fs, 'stat').mockImplementation(async (p, ...args) => {
        if (p === file && !injected) {
          injected = true;
          await fs.writeFile(file, competing);
        }
        return stat(p, ...args);
      });
      const lines = [];
      await runBackfillUp(
        {},
        { vaultPath: root },
        { plan, apply: true, revert: false },
        { now: new Date('2027-01-01'), log: l => lines.push(l) }
      );
      expect(injected).toBe(true);
      expect(lines[0]).toBe(
        'written: 0, changed: 1, unchanged: 0, invalid: 0, roundtrip: 0, raced: 0, missing: 0'
      );
      expect(await fs.readFile(file, 'utf8')).toBe(competing);
    } finally {
      spy?.mockRestore();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it('refuses preexisting plan staging symlinks', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'backfill-temp-'));
    try {
      await fs.mkdir(path.join(root, 'notes'));
      const victim = path.join(root, 'notes/victim.md');
      await fs.writeFile(victim, 'keep');
      const plan = path.join(root, 'plan.json');
      await fs.symlink(victim, path.join(root, '.plan.json.tmp'));
      await expect(
        runBackfillUp(
          { backfillUpCandidates: async () => [] },
          { vaultPath: root },
          { plan, apply: false, revert: false, field: 'up', hubTypes: [], childTypes: [], max: 3 },
          { now: new Date('2027-01-01'), log: () => {} }
        )
      ).rejects.toThrow();
      expect(await fs.readFile(victim, 'utf8')).toBe('keep');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it('rejects plan paths whose parent is an external symlink', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'backfill-confine-'));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'backfill-outside-'));
    try {
      await fs.mkdir(path.join(root, 'notes'));
      await fs.mkdir(path.join(outside, 'notes'));
      const text = '---\ntitle: Child\n---\nBody\n';
      await fs.writeFile(path.join(outside, 'notes/child.md'), text);
      await fs.symlink(path.join(outside, 'notes'), path.join(root, 'notes/link'));
      const plan = path.join(root, 'plan.json');
      await fs.writeFile(
        plan,
        JSON.stringify({
          version: 1,
          field: 'up',
          entries: [{ path: 'notes/link/child.md', sha256: sha256(text), value: ['[[Hub]]'] }],
        })
      );
      await expect(
        runBackfillUp(
          {},
          { vaultPath: root },
          { plan, apply: true, revert: false },
          { now: new Date('2027-01-01'), log: () => {} }
        )
      ).rejects.toThrow('escapes vault');
      expect(await fs.readFile(path.join(outside, 'notes/child.md'), 'utf8')).toBe(text);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});
