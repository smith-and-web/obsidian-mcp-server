import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import pg from 'pg';
import { SearchService } from '../src/index/SearchService.js';
import matter from 'gray-matter';
import { executeToolCall } from '../src/tools/handlers.js';
import { runMaintenance } from '../src/maintain/run.js';
import { readMaintainConfig } from '../src/maintain/config.js';
import { IndexStore } from '../src/index/store.js';
import { scanOnce } from '../src/index/scanner.js';

const DB = process.env.TEST_DATABASE_URL;
const run = DB ? describe : describe.skip;
run('maintenance against pgvector', () => {
  let root, reports, service, pool;
  const collection = `test-maint-${process.pid}-${Date.now()}`;
  const now = new Date('2026-11-01T10:00:00Z');
  const note = (title, type, body, extra = '') =>
    `---\ntitle: ${title}\ntype: ${type}\nsummary: apple pie baking\nupdated: 2026-10-01\nindex: true\n${extra || 'aliases: []'}\n---\n# ${title}\n\n${body}\n`;
  const write = async (name, content) =>
    fs.writeFile(path.join(root, 'notes', name + '.md'), content);
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'maint-vault-'));
    reports = await fs.mkdtemp(path.join(root, 'reports-'));
    await fs.mkdir(path.join(root, 'notes'));
    const baking = 'apple pie baking apples pastry sweet apple pie baking apples pastry';
    await write('apple pie', note('apple pie', 'reference', baking, 'aliases: [apple-pie-old]'));
    await write('apple pies', note('apple pies', 'reference', baking));
    await write(
      'pear tart',
      note(
        'pear tart',
        'reference',
        'apple pie baking pear tart',
        'aliases: []\nupdated: 2026-03-01'
      ).replace('updated: 2026-10-01\n', '')
    );
    await write(
      'hub',
      note('hub', 'project', '[[pear tart]]', 'aliases: []\nupdated: 2026-01-01').replace(
        'updated: 2026-10-01\n',
        ''
      )
    );
    await write(
      'bare',
      note('bare', 'reference', 'bread baking', 'index: true').replace(
        'index: true\nindex: true',
        'index: true'
      )
    );
    await write('broken', note('broken', 'reference', '[[apple-pie-old]]'));
    await write('day', note('day', 'journal', 'pear tart'));
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
  });
  afterAll(async () => {
    if (service) {
      await service.store.truncateCollection();
      for (const table of [
        'maintenance_findings',
        'change_classes',
        'brain_changes',
        'maintenance_runs',
      ])
        await pool.query(`DELETE FROM ${table} WHERE collection = $1`, [collection]);
      await service.close();
    }
    await pool?.end();
    if (root) await fs.rm(root, { recursive: true, force: true });
    if (reports) await fs.rm(reports, { recursive: true, force: true });
  });
  it('applies the schema idempotently with all five tables and pg_trgm', async () => {
    await service.store.ensureSchema('fake', 64);
    await service.store.ensureSchema('fake', 64);
    const tables = await pool.query('SELECT tablename FROM pg_tables WHERE tablename = ANY($1)', [
      [
        'doc_history',
        'maintenance_runs',
        'maintenance_findings',
        'change_classes',
        'brain_changes',
      ],
    ]);
    expect(tables.rowCount).toBe(5);
    expect(
      (await pool.query("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'")).rowCount
    ).toBe(1);
  });
  it('records changed content transactionally and backfills only missing history', async () => {
    const count = async () =>
      Number(
        (
          await pool.query(
            'SELECT count(*) FROM doc_history h JOIN documents d ON d.id=h.document_id WHERE d.collection=$1',
            [collection]
          )
        ).rows[0].count
      );
    expect(await count()).toBe(7);
    await write(
      'bare',
      note('bare', 'reference', 'changed bread baking', 'index: true').replace(
        'index: true\nindex: true',
        'index: true'
      )
    );
    expect(
      (await scanOnce({ vaultPath: root, store: service.store, embedder: service.embedder }))
        .changed
    ).toBe(1);
    expect(await count()).toBe(8);
    await pool.query(
      'DELETE FROM doc_history WHERE document_id IN (SELECT id FROM documents WHERE collection=$1)',
      [collection]
    );
    expect(await service.store.backfillDocHistory()).toBe(7);
    expect(await count()).toBe(7);
    expect(await service.store.backfillDocHistory()).toBe(0);
  });
  it('detects the six fixture classes and excludes journal targets', async () => {
    const store = service.store;
    const checks = [
      await store.findMissingLinks(0.5),
      await store.findUnlinkedMentions(),
      await store.findLinkRepairs(),
      await store.findMissingFrontmatter(),
      await store.findNearDuplicates(0.5, 0.6),
      await store.findStaleHubs(14),
    ];
    const pair = ['notes/apple pie.md', 'notes/apple pies.md'];
    expect(checks[0].some(c => JSON.stringify(c.paths) === JSON.stringify(pair))).toBe(true);
    expect(checks[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ paths: ['notes/pear tart.md', 'notes/apple pie.md'] }),
      ])
    );
    expect(checks[2]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ paths: ['notes/broken.md', 'notes/apple pie.md'] }),
      ])
    );
    expect(checks[3]).toEqual([
      expect.objectContaining({ paths: ['notes/bare.md'], detail: { fields: ['aliases'] } }),
    ]);
    expect(checks[4].some(c => JSON.stringify(c.paths) === JSON.stringify(pair))).toBe(true);
    expect(checks[5]).toEqual([
      expect.objectContaining({
        paths: ['notes/hub.md'],
        detail: expect.objectContaining({ newestLinked: 'notes/pear tart.md', days: 59 }),
      }),
    ]);
    for (const candidates of checks)
      for (const c of candidates) expect(c.paths.at(-1)).not.toBe('notes/day.md');
    expect(await store.hygieneMetrics()).toEqual(
      expect.objectContaining({ documents: 7, invalidFrontmatter: 0, unresolvedLinks: 1 })
    );
    expect(checks[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ paths: ['notes/day.md', 'notes/pear tart.md'] }),
      ])
    );
  });
  it('uses the oldest row of the current summary run, stopping at a changed summary', async () => {
    const id = (
      await pool.query('SELECT id FROM documents WHERE collection=$1 AND path=$2', [
        collection,
        'notes/hub.md',
      ])
    ).rows[0].id;
    await pool.query(
      `INSERT INTO doc_history(document_id,content_sha256,summary,summary_body_cosine,at)
      VALUES ($1,'test','test summary',0.9,now()+interval '1 second'),($1,'test2','test summary',0.7,now()+interval '2 seconds')`,
      [id]
    );
    const candidates = await service.store.findStaleSummaries(0.05);
    expect(candidates).toEqual([
      expect.objectContaining({
        paths: ['notes/hub.md'],
        detail: expect.objectContaining({ baseCosine: 0.9, currentCosine: 0.7 }),
      }),
    ]);
    await pool.query(
      `INSERT INTO doc_history(document_id,content_sha256,summary,summary_body_cosine,at)
      VALUES ($1,'test3','new summary',0.2,now()+interval '3 seconds')`,
      [id]
    );
    expect(await service.store.findStaleSummaries(0.05)).toEqual([]);
  });
  it('handles scalar aliases and malformed dates without failing checks', async () => {
    await pool.query(
      `UPDATE documents SET frontmatter=frontmatter || '{"aliases":"scalar","updated":"bad-date"}'::jsonb WHERE collection=$1 AND path=$2`,
      [collection, 'notes/bare.md']
    );
    await expect(service.store.findUnlinkedMentions()).resolves.toBeInstanceOf(Array);
    await expect(service.store.findLinkRepairs()).resolves.toBeInstanceOf(Array);
    await expect(service.store.findStaleHubs(14)).resolves.toBeInstanceOf(Array);
    await pool.query(
      `UPDATE documents SET frontmatter=frontmatter - 'aliases' WHERE collection=$1 AND path=$2`,
      [collection, 'notes/bare.md']
    );
  });

  const configuration = () =>
    readMaintainConfig({
      DATABASE_URL: DB,
      VAULT_PATH: root,
      MAINTAIN_REPORT_DIR: reports,
      INDEX_COLLECTION: collection,
      MAINTAIN_LINK_COSINE: '0.5',
      MAINTAIN_DUP_COSINE: '0.5',
    }).config;
  const perform = (config = configuration(), dry = false) =>
    runMaintenance(service.store, config, { dry, now, log: () => {} });
  const reportFile = () => path.join(reports, 'Brain maintenance 2026-W44.md');
  const finding = async cls =>
    (
      await pool.query(
        'SELECT * FROM maintenance_findings WHERE collection=$1 AND class=$2 ORDER BY id',
        [collection, cls]
      )
    ).rows[0];
  it('runs all checks, records a successful run and writes only its report', async () => {
    expect(await perform()).toEqual({ code: 0 });
    const report = await fs.readFile(reportFile(), 'utf8');
    expect(matter(report).data).toEqual(
      expect.objectContaining({ maintenance_report: '2026-W44', index: false })
    );
    for (const cls of [
      'merge-duplicate',
      'link-related',
      'link-mention',
      'link-repair',
      'fm-missing',
      'hub-review',
    ])
      expect(await finding(cls)).toBeDefined();
    const all = (
      await pool.query('SELECT * FROM maintenance_findings WHERE collection=$1', [collection])
    ).rows;
    for (const f of all) {
      expect(f.paths.at(-1)).not.toBe('notes/day.md');
      expect(report).toContain(`- [ ] accept f${f.id}`);
      expect(report).toContain(`- [ ] reject f${f.id}`);
    }
    const run = (
      await pool.query(
        'SELECT * FROM maintenance_runs WHERE collection=$1 ORDER BY id DESC LIMIT 1',
        [collection]
      )
    ).rows[0];
    expect(run.finished_at).toBeInstanceOf(Date);
    expect(run.report_id).toBe('2026-W44');
    expect(run.error_text).toBeNull();
    expect(
      (await pool.query('SELECT * FROM change_classes WHERE collection=$1', [collection])).rowCount
    ).toBe(7);
  });
  it('parses checkboxes before replacing the report and counts acceptance', async () => {
    const related = await finding('link-related'),
      duplicate = await finding('merge-duplicate');
    let report = await fs.readFile(reportFile(), 'utf8');
    report = report
      .replace(`- [ ] accept f${related.id}`, `- [x] accept f${related.id}`)
      .replace(`- [ ] reject f${duplicate.id}`, `- [x] reject f${duplicate.id}`);
    await fs.writeFile(reportFile(), report);
    expect(await perform()).toEqual({ code: 0 });
    expect((await finding('link-related')).status).toBe('accepted');
    expect((await finding('link-related')).decided_via).toBe('checkbox');
    expect((await finding('merge-duplicate')).status).toBe('rejected');
    const classes = await service.store.maintenanceClassCounts();
    expect(classes).toEqual(
      expect.arrayContaining([
        { class: 'link-related', decided: 1, accepted: 1 },
        { class: 'merge-duplicate', decided: 1, accepted: 0 },
      ])
    );
    report = await fs.readFile(reportFile(), 'utf8');
    expect(report).toContain(`- f${related.id} · link-related · accepted (checkbox)`);
    expect(report).not.toContain(`#### f${related.id} ·`);
  });
  it('does not propose rejected findings on later runs', async () => {
    expect(await perform()).toEqual({ code: 0 });
    const duplicate = await finding('merge-duplicate');
    expect(duplicate.status).toBe('rejected');
    expect(await fs.readFile(reportFile(), 'utf8')).not.toContain(`#### f${duplicate.id} ·`);
  });
  it('resolves repaired findings without counting them as decisions', async () => {
    await write('bare', note('bare', 'reference', 'changed bread baking'));
    await scanOnce({ vaultPath: root, store: service.store, embedder: service.embedder });
    expect(await perform()).toEqual({ code: 0 });
    expect((await finding('fm-missing')).status).toBe('resolved');
    expect(await service.store.maintenanceClassCounts()).toEqual(
      expect.arrayContaining([{ class: 'fm-missing', decided: 0, accepted: 0 }])
    );
  });
  it('records conflicts from moved reports without applying either tick', async () => {
    const f = await finding('link-repair');
    await fs.writeFile(
      path.join(root, 'moved-report.md'),
      `---\nmaintenance_report: "2026-W43"\nindex: false\n---\n- [x] accept f${f.id}\n- [x] reject f${f.id}\n`
    );
    expect(await perform()).toEqual({ code: 0 });
    expect((await finding('link-repair')).status).toBe('open');
    const latest = (
      await pool.query(
        'SELECT metrics FROM maintenance_runs WHERE collection=$1 ORDER BY id DESC LIMIT 1',
        [collection]
      )
    ).rows[0];
    expect(latest.metrics.conflicts).toContain(Number(f.id));
  });
  it('caps only new findings, preserving existing open ones and collection isolation', async () => {
    const other = collection + '-cap';
    const store = new IndexStore({ connectionString: DB, collection: other });
    try {
      await scanOnce({ vaultPath: root, store, embedder: service.embedder });
      const cfg = {
        ...configuration(),
        collection: other,
        maxPerClass: 1,
        reportDir: await fs.mkdtemp(path.join(root, 'cap-reports-')),
      };
      expect(await runMaintenance(store, cfg, { dry: false, now, log: () => {} })).toEqual({
        code: 0,
      });
      const groups = (
        await pool.query(
          'SELECT class,count(*)::int AS n FROM maintenance_findings WHERE collection=$1 GROUP BY class',
          [other]
        )
      ).rows;
      expect(groups.length).toBeGreaterThan(0);
      for (const g of groups) expect(g.n).toBe(1);
      expect(
        await store.decideFinding(
          Number((await finding('link-repair')).id),
          'accepted',
          'tool',
          null,
          false
        )
      ).toBeNull();
      expect((await store.maintenanceFindingCounts()).findings.accepted).toBe(0);
    } finally {
      await store.truncateCollection();
      for (const table of ['maintenance_findings', 'change_classes', 'maintenance_runs'])
        await pool.query(`DELETE FROM ${table} WHERE collection=$1`, [other]);
      await store.close();
    }
  });
  it('fails cleanly when another client holds the collection lock', async () => {
    const other = new IndexStore({ connectionString: DB, collection });
    try {
      expect(await other.maintenanceLock()).toBe(true);
      expect(await perform()).toEqual({ code: 1, message: 'another run is in progress' });
    } finally {
      await other.maintenanceUnlock();
      await other.close();
    }
    expect(await service.store.maintenanceLock()).toBe(true);
    await service.store.maintenanceUnlock();
  });
  it('dry prints all checks and metrics without changing rows or files', async () => {
    const before = (
      await pool.query(
        'SELECT (SELECT count(*) FROM maintenance_runs) AS runs,(SELECT count(*) FROM maintenance_findings) AS findings,(SELECT count(*) FROM doc_history) AS history'
      )
    ).rows[0];
    const content = await fs.readFile(reportFile(), 'utf8');
    const lines = [];
    expect(
      await runMaintenance(service.store, configuration(), {
        dry: true,
        now,
        log: l => lines.push(l),
      })
    ).toEqual({ code: 0 });
    expect(lines.filter(l => l.endsWith(' candidates'))).toHaveLength(7);
    expect(lines.filter(l => l.startsWith('hygiene.'))).toHaveLength(6);
    expect(lines.at(-1)).toBe('dry run complete');
    expect(
      (
        await pool.query(
          'SELECT (SELECT count(*) FROM maintenance_runs) AS runs,(SELECT count(*) FROM maintenance_findings) AS findings,(SELECT count(*) FROM doc_history) AS history'
        )
      ).rows[0]
    ).toEqual(before);
    expect(await fs.readFile(reportFile(), 'utf8')).toBe(content);
  });
  it('records failed runs, releases the lock and keeps them out of previousRun', async () => {
    const result = await perform({ ...configuration(), reportDir: path.join(root, 'absent') });
    expect(result.code).toBe(1);
    expect(result.message).toContain('ENOENT');
    const failed = (
      await pool.query(
        'SELECT * FROM maintenance_runs WHERE collection=$1 ORDER BY id DESC LIMIT 1',
        [collection]
      )
    ).rows[0];
    expect(failed.error_text).toContain('ENOENT');
    expect(failed.finished_at).toBeInstanceOf(Date);
    expect((await service.store.previousRun(Number(failed.id) + 1)).startedAt).not.toEqual(
      failed.started_at
    );
    expect(await service.store.maintenanceLock()).toBe(true);
    await service.store.maintenanceUnlock();
  });

  it('recommends by both strategies, normalizes paths, filters and excludes examples', async () => {
    const call = args => executeToolCall('recommend-notes', args, {}, service);
    const result = await call({ positive: ['/notes/apple pie'] });
    expect(result.strategy).toBe('best_score');
    expect(result.positive).toEqual(['notes/apple pie.md']);
    expect(result.results[0].path).toBe('notes/apple pies.md');
    expect(result.results.some(r => r.path === 'notes/apple pie.md')).toBe(false);
    expect(
      (await call({ positive: ['notes/apple pie.md'], strategy: 'average_vector' })).results.length
    ).toBeGreaterThan(0);
    const negative = await call({
      positive: ['notes/apple pie.md'],
      negative: ['notes/apple pies.md'],
      strategy: 'average_vector',
      type: 'reference',
      directory: '/notes/',
    });
    expect(
      negative.results.every(
        r =>
          !['notes/apple pie.md', 'notes/apple pies.md', 'notes/hub.md', 'notes/day.md'].includes(
            r.path
          )
      )
    ).toBe(true);
    expect(
      (await call({ positive: ['notes/apple pie.md'], directory: 'missing' })).results
    ).toEqual([]);
    await expect(call({ positive: ['notes/unknown.md'] })).rejects.toThrow(
      'Unknown notes: notes/unknown.md'
    );
  });
  it('tool decisions override earlier decisions and resist later checkbox ticks', async () => {
    const f = await finding('link-mention');
    const result = await executeToolCall(
      'maintenance-decision',
      { finding: `f${f.id}`, decision: 'reject' },
      {},
      service
    );
    expect(result).toEqual({
      recorded: true,
      finding: { id: `f${f.id}`, class: 'link-mention', paths: f.paths, status: 'rejected' },
    });
    await fs.writeFile(
      path.join(root, 'old-report.md'),
      `---\nmaintenance_report: "old"\nindex: false\n---\n- [x] accept f${f.id}\n`
    );
    expect(await perform()).toEqual({ code: 0 });
    expect((await finding('link-mention')).status).toBe('rejected');
    expect(
      await executeToolCall(
        'maintenance-decision',
        { finding: `${f.id}`, decision: 'accept' },
        {},
        service
      )
    ).toEqual(expect.objectContaining({ recorded: true }));
    expect((await finding('link-mention')).status).toBe('accepted');
    expect(
      await executeToolCall(
        'maintenance-decision',
        { finding: '999999999', decision: 'reject' },
        {},
        service
      )
    ).toEqual({ recorded: false, reason: 'unknown finding' });
  });
});
