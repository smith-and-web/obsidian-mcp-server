import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import pg from 'pg';
import { createHash } from 'crypto';
import { SearchService } from '../src/index/SearchService.js';
import { scanOnce } from '../src/index/scanner.js';
import {
  addRelated,
  linkFirstMention,
  repairLink,
  addMissingFrontmatter,
  bumpUpdated,
  onlyKeysChanged,
} from '../src/maintain/edits.js';
import { applyFindings, nextMode } from '../src/maintain/apply.js';
import { ApplyStore } from '../src/maintain/applyStore.js';
import { undoChange } from '../src/maintain/undo.js';
import { readMaintainConfig } from '../src/maintain/config.js';
import { runMaintenance } from '../src/maintain/run.js';
import { renderReport } from '../src/maintain/report.js';

const fm = (extra = '') =>
  `---\ntitle: "N"\ntype: reference\nupdated: "2026-10-01T10:00:00-03:00"\nindex: true\naliases: []\n${extra}---\n# N\n\n`;

describe('auto-apply edits', () => {
  it('addRelated appends to a bullet list, an inline list, or a new section', () => {
    expect(addRelated(`${fm()}Body.\n\n## Related\n- [[A]]\n`, 'B')).toBe(
      `${fm()}Body.\n\n## Related\n- [[A]]\n- [[B]]\n`
    );
    expect(addRelated(`${fm()}Body.\n\n## Related\n[[A]], [[C]]\n\n## Next\nx\n`, 'B')).toBe(
      `${fm()}Body.\n\n## Related\n[[A]], [[C]], [[B]]\n\n## Next\nx\n`
    );
    expect(addRelated(`${fm()}Body.\n`, 'B')).toBe(`${fm()}Body.\n\n## Related\n\n- [[B]]\n`);
    expect(addRelated(`${fm()}See [[B|bee]].\n`, 'B')).toBeNull();
    expect(addRelated(`${fm()}## Related\nfree text here\n`, 'B')).toBeNull();
  });
  it('linkFirstMention links prose only, keeps the matched text and skips code and headings', () => {
    const body =
      '## Sprocket notes\n\n`sprocket` and [[Other]].\n\nThe sprocket turns. Sprocket again.\n';
    expect(linkFirstMention(fm() + body, 'Sprocket', 'Sprocket')).toBe(
      fm() +
        '## Sprocket notes\n\n`sprocket` and [[Other]].\n\nThe [[Sprocket|sprocket]] turns. Sprocket again.\n'
    );
    expect(linkFirstMention(`${fm()}lantern-site only\n`, 'lantern', 'lantern')).toBeNull();
    expect(linkFirstMention(`${fm()}| sprocket | x |\n`, 'sprocket', 'Sprocket')).toBeNull();
    expect(linkFirstMention(`${fm()}see https://x.io/sprocket\n`, 'sprocket', 'S')).toBeNull();
  });
  it('repairLink keeps headings and display text, and escapes pipes in tables', () => {
    const c = `${fm()}See [[old-name]] and [[old-name#Part|shown]].\n| a | [[old-name]] |\n`;
    expect(repairLink(c, 'old-name', 'New Name')).toBe(
      `${fm()}See [[New Name|old-name]] and [[New Name#Part|shown]].\n| a | [[New Name\\|old-name]] |\n`
    );
    expect(repairLink(`${fm()}nothing\n`, 'old-name', 'New')).toBeNull();
  });
  it('addMissingFrontmatter adds only the missing fields and nothing else changes', () => {
    const c = `---\ntitle: "N"\ntags: [a, b]\nindex: true\n---\nbody\n`;
    const out = addMissingFrontmatter(c, ['aliases']);
    expect(out).toBe(`---\ntitle: "N"\ntags: [a, b]\nindex: true\naliases: []\n---\nbody\n`);
    expect(addMissingFrontmatter(c, ['index'])).toBeNull();
  });
  it('bumpUpdated keeps the quoting style and leaves notes without the field alone', () => {
    expect(bumpUpdated(`${fm()}x\n`, '2026-11-08T21:00:00-04:00')).toBe(
      `${fm().replace('2026-10-01T10:00:00-03:00', '2026-11-08T21:00:00-04:00')}x\n`
    );
    const plain = '---\ntitle: N\nupdated: 2026-10-01\n---\nx\n';
    expect(bumpUpdated(plain, '2026-11-08T21:00:00-04:00')).toBe(
      '---\ntitle: N\nupdated: 2026-11-08T21:00:00-04:00\n---\nx\n'
    );
    expect(bumpUpdated('---\ntitle: N\n---\nx\n', 'T')).toBe('---\ntitle: N\n---\nx\n');
    expect(onlyKeysChanged('---\na: 1\nb: 2\n---\n', '---\na: 1\nb: 3\n---\n', ['b'])).toBe(true);
    expect(onlyKeysChanged('---\na: 1\nb: 2\n---\n', '---\na: 2\nb: 3\n---\n', ['b'])).toBe(false);
  });
});

describe('graduation and demotion', () => {
  const s = over => ({
    class: 'link-related',
    graduable: true,
    mode: 'report',
    decided: 0,
    accepted: 0,
    applied: 0,
    reverted: 0,
    autoApplied: 0,
    autoReverted: 0,
    demotedAt: null,
    decidedSinceDemotion: 0,
    acceptedSinceDemotion: 0,
    ...over,
  });
  it('graduates at 20 decisions and 90% acceptance, not before', () => {
    expect(nextMode(s({ decided: 19, accepted: 19 }))).toBeNull();
    expect(nextMode(s({ decided: 20, accepted: 17 }))).toBeNull();
    expect(nextMode(s({ decided: 20, accepted: 18 }))).toBe('graduate');
  });
  it('never graduates a report-only class', () => {
    expect(nextMode(s({ class: 'summary-refresh', decided: 30, accepted: 30 }))).toBeNull();
    expect(nextMode(s({ class: 'link-coread', decided: 30, accepted: 30 }))).toBeNull();
    expect(
      nextMode(s({ class: 'merge-duplicate', graduable: false, decided: 30, accepted: 30 }))
    ).toBeNull();
  });
  it('demotes past 10% reverts of auto-applied changes and needs a fresh record after', () => {
    expect(nextMode(s({ mode: 'apply', autoApplied: 10, autoReverted: 1 }))).toBeNull();
    expect(nextMode(s({ mode: 'apply', autoApplied: 10, autoReverted: 2 }))).toBe('demote');
    const demoted = { demotedAt: new Date(), decided: 40, accepted: 40 };
    expect(
      nextMode(s({ ...demoted, decidedSinceDemotion: 5, acceptedSinceDemotion: 5 }))
    ).toBeNull();
    expect(nextMode(s({ ...demoted, decidedSinceDemotion: 20, acceptedSinceDemotion: 20 }))).toBe(
      'graduate'
    );
  });
});

describe('report', () => {
  it('lists applied changes with undo ids and shows modes and revert rates', () => {
    const text = renderReport({
      reportId: '2026-W45',
      now: new Date('2026-11-08T12:00:00Z'),
      timeZone: 'UTC',
      findings: [],
      metrics: {
        documents: 1,
        unresolvedLinks: 0,
        orphans: 0,
        invalidFrontmatter: 0,
        excludedNotes: 0,
        nearDuplicatePairs: 0,
        missingLinkPairs: 0,
        findings: { open: 0 },
        decisionsParsed: 0,
        conflicts: [],
      },
      previousMetrics: null,
      decided: [],
      classes: [
        {
          class: 'link-related',
          decided: 6,
          accepted: 6,
          mode: 'apply-on-accept',
          applied: 4,
          reverted: 1,
        },
      ],
      openClasses: 0,
      apply: {
        enabled: true,
        reason: null,
        changes: [
          { id: 7, findingId: 21, class: 'link-related', path: 'Reference/A.md', reverted: false },
        ],
        skipped: [{ findingId: 22, class: 'link-mention', reason: 'recent' }],
        graduated: [],
        demoted: [],
      },
    });
    expect(text).toContain('## Applied this week');
    expect(text).toContain('- c7 · f21 · link-related · [[A]]');
    expect(text).toContain('- f22 · link-mention · recent');
    expect(text).toContain('| link-related | 6 | 6 | 100% | apply-on-accept | 4 | 1 (25%) |');
    const off = renderReport({
      reportId: '2026-W45',
      now: new Date(),
      timeZone: 'UTC',
      findings: [],
      metrics: { findings: { open: 0 }, decisionsParsed: 0, conflicts: [] },
      previousMetrics: null,
      decided: [],
      classes: [],
      openClasses: 0,
      apply: {
        enabled: false,
        reason: 'MAINTAIN_APPLY is false',
        changes: [],
        skipped: [],
        graduated: [],
        demoted: [],
      },
    });
    expect(off).toContain('Auto-apply is off (MAINTAIN_APPLY is false)');
  });
});

const DB = process.env.TEST_DATABASE_URL;
const run = DB ? describe : describe.skip;
run('auto-apply against pgvector', () => {
  let root, service, pool, store, patternsFile;
  const collection = `test-apply-${process.pid}-${Date.now()}`;
  const old = new Date(Date.now() - 3 * 86400000);
  const notes = {
    'Reference/Alpha.md': `${fm()}Alpha talks about the Sprocket and old-beta.\n\nLinks [[old-beta]].\n`,
    'Reference/Beta.md': `${fm()}Beta body.\n\n## Related\n- [[Sprocket]]\n`,
    'Reference/Gamma.md': `${fm()}Gamma body.\n`,
    'Reference/Sprocket.md': `${fm()}A small toothed wheel.\n`,
    'Reference/Bare.md': `---\ntitle: "Bare"\ntype: reference\nupdated: 2026-10-01\n---\n# Bare\n\nbare\n`,
    'Decisions/Decision - D.md': `${fm().replace('reference', 'decision')}Decided body.\n`,
    'Meetings/Meeting - M.md': `${fm().replace('reference', 'meeting')}Meeting body.\n`,
    'Reference/Graph part.md': `${fm('tags: [code-graph]\n')}Graph body.\n`,
    'Reference/Secretish.md': `${fm()}token: ghp_${'a'.repeat(36)}\n`,
    'Reference/Private.md': `${fm()}About zzprivateterm.\n`,
    'Reference/Fresh.md': `${fm()}Fresh body.\n`,
    'Reference/Edited.md': `${fm()}Edited body.\n`,
    ...Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`Reference/Cap ${i}.md`, `${fm()}cap ${i}\n`])
    ),
  };
  const abs = p => path.join(root, p);
  const text = p => fs.readFile(abs(p), 'utf8');
  const config = (over = {}) => ({
    ...readMaintainConfig({
      DATABASE_URL: DB,
      VAULT_PATH: root,
      MAINTAIN_REPORT_DIR: path.join(root, 'Inbox'),
      INDEX_COLLECTION: collection,
      MAINTAIN_APPLY: 'true',
      MAINTAIN_GUARD_PATTERNS_FILE: patternsFile,
      INDEX_VOLATILE_KEYS: 'heat',
    }).config,
    ...over,
  });
  let n = 0;
  const finding = async (cls, paths, detail, status = 'accepted', via = 'tool') => {
    const key = `${cls}:${paths.join('|')}:${n++}`;
    const r = await pool.query(
      `INSERT INTO maintenance_findings(collection,class,finding_key,paths,detail,status,decided_via,decided_at)
      VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,now()) RETURNING id`,
      [collection, cls, key, paths, JSON.stringify(detail), status, status === 'open' ? null : via]
    );
    return { id: Number(r.rows[0].id), key };
  };
  const apply = async (keys, over = {}, dry = false) =>
    applyFindings({ store, config: over, now: new Date(), dry, validKeys: new Set(keys) });
  const status = async id =>
    (await pool.query('SELECT status FROM maintenance_findings WHERE id=$1', [id])).rows[0].status;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'apply-vault-'));
    for (const [rel, content] of Object.entries(notes)) {
      await fs.mkdir(path.dirname(abs(rel)), { recursive: true });
      await fs.writeFile(abs(rel), content);
    }
    await fs.mkdir(abs('Inbox'), { recursive: true });
    patternsFile = path.join(root, '..', `guard-${process.pid}.txt`);
    await fs.writeFile(patternsFile, '# test\nzzprivateterm\n');
    pool = new pg.Pool({ connectionString: DB });
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
      (await scanOnce({ vaultPath: root, store: service.store, embedder: service.embedder })).errors
    ).toBe(0);
    await service.store.ensureMaintenanceSchema();
    for (const rel of Object.keys(notes)) await fs.utimes(abs(rel), old, old);
    await fs.utimes(abs('Reference/Fresh.md'), new Date(), new Date());
    await fs.writeFile(abs('Reference/Edited.md'), `${fm()}Edited later, not reindexed.\n`);
    await fs.utimes(abs('Reference/Edited.md'), old, old);
    store = new ApplyStore(DB, collection);
  });
  afterAll(async () => {
    await store?.close();
    if (service) {
      for (const t of [
        'brain_changes',
        'maintenance_findings',
        'change_classes',
        'maintenance_runs',
      ])
        await pool.query(`DELETE FROM ${t} WHERE collection=$1`, [collection]);
      await service.store.truncateCollection();
      await service.close();
    }
    await pool?.end();
    if (root) await fs.rm(root, { recursive: true, force: true });
    if (patternsFile) await fs.rm(patternsFile, { force: true });
  });

  it('kill switch: MAINTAIN_APPLY=false applies nothing', async () => {
    const f = await finding('fm-missing', ['Reference/Bare.md'], { fields: ['aliases', 'index'] });
    const r = await apply([f.key], config({ apply: false }));
    expect(r.enabled).toBe(false);
    expect(await status(f.id)).toBe('accepted');
    expect(await text('Reference/Bare.md')).toBe(notes['Reference/Bare.md']);
  });
  it('fails closed without a guard patterns file', async () => {
    const r = await apply([], config({ guardPatternsFile: '/nonexistent/guard.txt' }));
    expect(r.enabled).toBe(false);
    expect(r.reason).toMatch(/cannot read guard patterns file/);
  });
  it('dry run reports what it would apply and writes nothing', async () => {
    const f = await finding('fm-missing', ['Reference/Bare.md'], { fields: ['aliases', 'index'] });
    const r = await apply([f.key], config(), true);
    expect(r.outcomes).toEqual([
      expect.objectContaining({ findingId: f.id, status: 'would-apply' }),
    ]);
    expect(await text('Reference/Bare.md')).toBe(notes['Reference/Bare.md']);
    await pool.query("UPDATE maintenance_findings SET status='rejected' WHERE id=$1", [f.id]);
  });
  it('applies fm-missing, journals it, bumps updated and undo restores it', async () => {
    await pool.query(
      "UPDATE maintenance_findings SET status='rejected' WHERE collection=$1 AND status='accepted'",
      [collection]
    );
    const f = await finding('fm-missing', ['Reference/Bare.md'], { fields: ['aliases', 'index'] });
    const r = await apply([f.key], config());
    expect(r.outcomes[0]).toEqual(expect.objectContaining({ status: 'applied' }));
    const after = await text('Reference/Bare.md');
    expect(after).toMatch(/\naliases: \[\]\n/);
    expect(after).toMatch(/\nindex: true\n/);
    expect(after).toMatch(/updated: \d{4}-\d{2}-\d{2}T/);
    expect(await status(f.id)).toBe('applied');
    const [id] = r.outcomes[0].changeIds;
    const row = (await pool.query('SELECT * FROM brain_changes WHERE id=$1', [id])).rows[0];
    expect(row.before_text).toBe(notes['Reference/Bare.md']);
    expect(row.after_sha).toBe(createHash('sha256').update(after).digest('hex'));
    expect(await undoChange(store, root, id, { dry: false, log: () => {} })).toEqual({ code: 0 });
    expect(await text('Reference/Bare.md')).toBe(notes['Reference/Bare.md']);
    expect(await status(f.id)).toBe('rejected');
    expect((await undoChange(store, root, id, { dry: false, log: () => {} })).code).toBe(1);
  });
  it('link-related edits both notes in their own style; undo reverts both and refuses after an edit', async () => {
    const f = await finding('link-related', ['Reference/Beta.md', 'Reference/Gamma.md'], {
      cosine: 0.9,
    });
    const r = await apply([f.key], config());
    expect(r.outcomes[0].status).toBe('applied');
    expect(await text('Reference/Beta.md')).toContain('## Related\n- [[Sprocket]]\n- [[Gamma]]\n');
    expect(await text('Reference/Gamma.md')).toContain('## Related\n\n- [[Beta]]\n');
    expect(r.outcomes[0].changeIds).toHaveLength(2);
    const gamma = await text('Reference/Gamma.md');
    await fs.writeFile(abs('Reference/Gamma.md'), gamma + 'Josh edit.\n');
    const refused = await undoChange(store, root, r.outcomes[0].changeIds[0], {
      dry: false,
      log: () => {},
    });
    expect(refused.code).toBe(1);
    expect(refused.message).toMatch(/changed after change/);
    await fs.writeFile(abs('Reference/Gamma.md'), gamma);
    expect(
      await undoChange(store, root, r.outcomes[0].changeIds[1], { dry: false, log: () => {} })
    ).toEqual({ code: 0 });
    expect(await text('Reference/Beta.md')).toBe(notes['Reference/Beta.md']);
    expect(await text('Reference/Gamma.md')).toBe(notes['Reference/Gamma.md']);
  });
  it('link-mention and link-repair edit one note in one run', async () => {
    const m = await finding('link-mention', ['Reference/Alpha.md', 'Reference/Sprocket.md'], {
      name: 'Sprocket',
    });
    const p = await finding('link-repair', ['Reference/Alpha.md', 'Reference/Beta.md'], {
      target: 'old-beta',
    });
    const r = await apply([m.key, p.key], config());
    expect(r.outcomes.map(o => o.status)).toEqual(['applied', 'applied']);
    const alpha = await text('Reference/Alpha.md');
    expect(alpha).toContain('about the [[Sprocket]] and old-beta.');
    expect(alpha).toContain('Links [[Beta|old-beta]].');
  });
  it('guards: decision bodies, meetings, excluded tags, sensitive text, recent and changed notes', async () => {
    const cases = [
      [['Decisions/Decision - D.md', 'Reference/Gamma.md'], 'decision-body'],
      [['Meetings/Meeting - M.md', 'Reference/Gamma.md'], 'meeting'],
      [['Reference/Graph part.md', 'Reference/Gamma.md'], 'excluded-tag'],
      [['Reference/Secretish.md', 'Reference/Gamma.md'], 'sensitive'],
      [['Reference/Private.md', 'Reference/Gamma.md'], 'sensitive'],
      [['Reference/Fresh.md', 'Reference/Gamma.md'], 'recent'],
      [['Reference/Edited.md', 'Reference/Gamma.md'], 'changed'],
    ];
    for (const [paths, reason] of cases) {
      const f = await finding('link-related', paths, { cosine: 0.9 });
      const r = await apply([f.key], config());
      expect(r.outcomes[0]).toEqual(expect.objectContaining({ status: 'skipped', reason }));
      expect(await status(f.id)).toBe('accepted');
      await pool.query("UPDATE maintenance_findings SET status='rejected' WHERE id=$1", [f.id]);
    }
    expect(await text('Reference/Gamma.md')).toBe(notes['Reference/Gamma.md']);
    const fmOnly = await finding('fm-missing', ['Decisions/Decision - D.md'], {
      fields: ['index'],
    });
    const r = await apply([fmOnly.key], config());
    expect(r.outcomes[0].reason).toBe('no-exact-change');
  });
  it('skips a finding no longer seen by this run', async () => {
    const f = await finding('link-related', ['Reference/Cap 0.md', 'Reference/Cap 1.md'], {
      cosine: 0.9,
    });
    const r = await apply([], config());
    expect(r.outcomes.find(o => o.findingId === f.id)).toBeUndefined();
    await pool.query("UPDATE maintenance_findings SET status='rejected' WHERE id=$1", [f.id]);
  });
  it('stops at the weekly cap of changes', async () => {
    const keys = [];
    for (let i = 0; i < 12; i += 2)
      keys.push(
        (
          await finding('link-related', [`Reference/Cap ${i}.md`, `Reference/Cap ${i + 1}.md`], {
            cosine: 0.9,
          })
        ).key
      );
    const before = await store.changesSince(new Date(Date.now() - 7 * 86400000));
    const r = await apply(keys, config({ applyWeeklyCap: before + 4 }));
    expect(r.outcomes.filter(o => o.status === 'applied')).toHaveLength(2);
    expect(r.outcomes.filter(o => o.reason === 'weekly-cap')).toHaveLength(4);
  });
  it('graduates a class at 20 decisions and auto-applies its open findings, then demotes on reverts', async () => {
    await pool.query(
      `INSERT INTO change_classes(collection,class,graduable) VALUES($1,'fm-missing',true)
      ON CONFLICT DO NOTHING`,
      [collection]
    );
    await pool.query(
      "UPDATE change_classes SET decided=20,accepted=19,mode='report' WHERE collection=$1 AND class='fm-missing'",
      [collection]
    );
    await fs.writeFile(abs('Reference/Bare.md'), notes['Reference/Bare.md']);
    await fs.utimes(abs('Reference/Bare.md'), old, old);
    const f = await finding(
      'fm-missing',
      ['Reference/Bare.md'],
      { fields: ['aliases', 'index'] },
      'open'
    );
    const r = await apply([f.key], config());
    expect(r.graduated).toEqual(['fm-missing']);
    expect(r.outcomes[0]).toEqual(expect.objectContaining({ auto: true, status: 'applied' }));
    const row = (
      await pool.query('SELECT decided_via FROM maintenance_findings WHERE id=$1', [f.id])
    ).rows[0];
    expect(row.decided_via).toBe('auto');
    expect(
      await undoChange(store, root, r.outcomes[0].changeIds[0], { dry: false, log: () => {} })
    ).toEqual({ code: 0 });
    const again = await apply([], config());
    expect(again.demoted).toEqual(['fm-missing']);
    const mode = (
      await pool.query(
        "SELECT mode,demoted_at FROM change_classes WHERE collection=$1 AND class='fm-missing'",
        [collection]
      )
    ).rows[0];
    expect(mode.mode).toBe('report');
    expect(mode.demoted_at).not.toBeNull();
    expect((await apply([], config())).graduated).toEqual([]);
  });
  it('a full maintenance run writes the Applied section and the mode column', async () => {
    const reportDir = await fs.mkdtemp(path.join(root, 'reports-'));
    const out = await runMaintenance(service.store, config({ reportDir }), {
      dry: false,
      now: new Date(),
      log: () => {},
    });
    expect(out).toEqual({ code: 0 });
    const [name] = await fs.readdir(reportDir);
    const report = await fs.readFile(path.join(reportDir, name), 'utf8');
    expect(report).toContain('## Applied this week');
    expect(report).toMatch(/- c\d+ · f\d+ · link-mention · \[\[Alpha\]\]/);
    expect(report).toMatch(/\| link-related \| \d+ \| \d+ \| \d+% \| apply-on-accept \|/);
  });
});
