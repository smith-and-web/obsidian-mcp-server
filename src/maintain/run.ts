import fs from 'fs/promises';
import path from 'path';
import type { IndexStore } from '../index/store.js';
import type { MaintainConfig } from './config.js';
import { CLASSES } from './classes.js';
import { readReportDecisions } from './decisions.js';
import { vaultMentionVerifier } from './mentions.js';
import { isoWeek, renderReport, type MaintenanceMetrics } from './report.js';

/**
 * Runs the eight checks in their report order. No ranking settings are read; the
 * vault is read only to confirm that a mention is in a note's prose.
 */
async function checks(store: IndexStore, c: MaintainConfig) {
  return [
    await store.findMissingLinks(c.linkCosine),
    await store.findUnlinkedMentions(vaultMentionVerifier(c.vaultPath)),
    await store.findLinkRepairs(),
    await store.findMissingFrontmatter(),
    await store.findStaleSummaries(c.summaryDrop),
    await store.findNearDuplicates(c.dupCosine, c.dupTitleSim),
    await store.findStaleHubs(c.hubDays),
    await store.findCoReadPairs(c.coreadMinWeight, c.coreadMinEvents),
  ];
}

export async function runMaintenance(
  store: IndexStore,
  config: MaintainConfig,
  opts: { dry: boolean; now: Date; log: (line: string) => void }
): Promise<{ code: 0 | 1; message?: string }> {
  let locked = false;
  let runId: number | null = null;
  let reportId: string | null = null;
  let reportPath: string | null = null;
  let metrics: Record<string, unknown> = {};
  try {
    await store.ensureMaintenanceSchema();
    locked = await store.maintenanceLock();
    if (!locked) return { code: 1, message: 'another run is in progress' };
    if (opts.dry) {
      const candidates = await checks(store, config);
      for (const [i, c] of CLASSES.entries())
        opts.log(`${c.class}: ${candidates[i].length} candidates`);
      for (const [key, value] of Object.entries(await store.hygieneMetrics()))
        opts.log(`hygiene.${key}: ${value}`);
      opts.log('dry run complete');
      return { code: 0 };
    }
    runId = await store.startMaintenanceRun();
    reportId = isoWeek(opts.now, config.timeZone);
    await store.backfillDocHistory();
    await store.upsertChangeClasses(CLASSES);
    const ticks = await readReportDecisions(config.vaultPath);
    let decisionsParsed = 0;
    for (const tick of ticks.decisions)
      if (await store.decideFinding(tick.id, tick.decision, 'checkbox', null, true))
        decisionsParsed++;
    const candidates = await checks(store, config);
    for (const [i, c] of CLASSES.entries())
      await store.upsertFindings(runId, reportId, c.class, candidates[i], config.maxPerClass);
    await store.resolveUnseenFindings(
      runId,
      CLASSES.map(c => c.class)
    );
    await store.refreshClassCounts();
    const { findings, openClasses } = await store.maintenanceFindingCounts();
    const reportMetrics: MaintenanceMetrics = {
      ...(await store.hygieneMetrics()),
      findings,
      decisionsParsed,
      conflicts: ticks.conflicts,
    };
    metrics = { ...reportMetrics };
    const previous = await store.previousRun(runId);
    const report = renderReport({
      reportId,
      now: opts.now,
      timeZone: config.timeZone,
      metrics: reportMetrics,
      previousMetrics: previous?.metrics ?? null,
      findings: await store.openFindings(50),
      openClasses,
      decided: await store.findingsDecidedSince(previous?.startedAt ?? new Date(0)),
      classes: await store.maintenanceClassCounts(),
    });
    const name = `Brain maintenance ${reportId}.md`;
    const temp = path.join(config.reportDir, `.${name}.tmp`);
    await fs.writeFile(temp, report, 'utf8');
    await fs.rename(temp, path.join(config.reportDir, name));
    reportPath = config.reportVaultDir
      ? `${config.reportVaultDir.replace(/\/$/, '')}/${name}`
      : name;
    await store.finishMaintenanceRun(runId, { reportId, reportPath, metrics, error: null });
    opts.log(
      `brain-maintain: ${reportId} written, ${findings.open} open findings, ${decisionsParsed} decisions recorded`
    );
    return { code: 0 };
  } catch (err) {
    const message = (err as Error).message;
    if (runId !== null)
      await store.finishMaintenanceRun(runId, { reportId, reportPath, metrics, error: message });
    return { code: 1, message };
  } finally {
    if (locked) await store.maintenanceUnlock();
  }
}
