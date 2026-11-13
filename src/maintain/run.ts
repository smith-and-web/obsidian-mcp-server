import fs from 'fs/promises';
import path from 'path';
import type { IndexStore } from '../index/store.js';
import type { MaintainConfig } from './config.js';
import { CLASSES } from './classes.js';
import { readReportDecisions } from './decisions.js';
import { vaultMentionVerifier } from './mentions.js';
import { vaultLinkTargets, type LinkTargetExists } from './vaultTargets.js';
import { isoWeek, renderReport, type ApplyReport, type MaintenanceMetrics } from './report.js';
import { ApplyStore } from './applyStore.js';
import { applyFindings, DETERMINISTIC } from './apply.js';

/**
 * Runs the eight checks in their report order. No ranking settings are read; the
 * vault is read only to confirm that a mention is in a note's prose.
 */
async function checks(store: IndexStore, c: MaintainConfig, exists: LinkTargetExists) {
  return [
    await store.findMissingLinks(c.linkCosine),
    await store.findUnlinkedMentions(vaultMentionVerifier(c.vaultPath)),
    await store.findLinkRepairs(exists),
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
  const applyStore = new ApplyStore(config.databaseUrl, config.collection);
  try {
    await store.ensureMaintenanceSchema();
    locked = await store.maintenanceLock();
    if (!locked) return { code: 1, message: 'another run is in progress' };
    const exists = await vaultLinkTargets(config.vaultPath);
    if (opts.dry) {
      const candidates = await checks(store, config, exists);
      for (const [i, c] of CLASSES.entries())
        opts.log(`${c.class}: ${candidates[i].length} candidates`);
      for (const [key, value] of Object.entries(await store.hygieneMetrics(exists)))
        opts.log(`hygiene.${key}: ${value}`);
      const dryApply = await applyFindings({
        store: applyStore,
        config,
        now: opts.now,
        dry: true,
        validKeys: new Set(candidates.flat().map(c => c.key)),
      });
      if (!dryApply.enabled) opts.log(`apply: off (${dryApply.reason})`);
      for (const o of dryApply.outcomes)
        opts.log(
          `apply: f${o.findingId} ${o.class} ${o.status === 'would-apply' ? 'would apply' : `skip (${o.reason})`}`
        );
      for (const c of dryApply.graduated) opts.log(`apply: ${c} would graduate`);
      for (const c of dryApply.demoted) opts.log(`apply: ${c} would be demoted`);
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
    const candidates = await checks(store, config, exists);
    for (const [i, c] of CLASSES.entries())
      await store.upsertFindings(runId, reportId, c.class, candidates[i], config.maxPerClass);
    await store.resolveUnseenFindings(
      runId,
      CLASSES.map(c => c.class)
    );
    await store.refreshClassCounts();
    const applied = await applyFindings({
      store: applyStore,
      config,
      now: opts.now,
      dry: false,
      validKeys: new Set(candidates.flat().map(c => c.key)),
    });
    await store.refreshClassCounts();
    const { findings, openClasses } = await store.maintenanceFindingCounts();
    const reportMetrics: MaintenanceMetrics = {
      ...(await store.hygieneMetrics(exists)),
      findings,
      decisionsParsed,
      conflicts: ticks.conflicts,
    };
    metrics = { ...reportMetrics };
    const previous = await store.previousRun(runId);
    const since = previous?.startedAt ?? new Date(opts.now.getTime() - 7 * 86400000);
    const states = new Map((await applyStore.classStates()).map(c => [c.class, c]));
    const applyReport: ApplyReport = {
      enabled: applied.enabled,
      reason: applied.reason,
      changes: (await applyStore.changesBetween(since, new Date(opts.now.getTime() + 1000))).map(
        c => ({
          id: c.id,
          findingId: c.findingId,
          class: c.class,
          path: c.path,
          reverted: c.revertedAt !== null,
        })
      ),
      skipped: applied.outcomes
        .filter(o => o.status === 'skipped')
        .map(o => ({ findingId: o.findingId, class: o.class, reason: o.reason ?? 'skipped' })),
      graduated: applied.graduated,
      demoted: applied.demoted,
    };
    const modeOf = (cls: string) => {
      if (!applied.enabled || !DETERMINISTIC.includes(cls)) return 'report-only';
      return states.get(cls)?.mode === 'apply' ? 'auto' : 'apply-on-accept';
    };
    const report = renderReport({
      reportId,
      now: opts.now,
      timeZone: config.timeZone,
      metrics: reportMetrics,
      previousMetrics: previous?.metrics ?? null,
      findings: await store.openFindings(50),
      openClasses,
      decided: await store.findingsDecidedSince(previous?.startedAt ?? new Date(0)),
      classes: (await store.maintenanceClassCounts()).map(c => ({
        ...c,
        mode: modeOf(c.class),
        applied: states.get(c.class)?.applied ?? 0,
        reverted: states.get(c.class)?.reverted ?? 0,
      })),
      apply: applyReport,
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
      `brain-maintain: ${reportId} written, ${findings.open} open findings, ${decisionsParsed} decisions recorded, ${applied.outcomes.filter(o => o.status === 'applied').length} findings applied`
    );
    return { code: 0 };
  } catch (err) {
    const message = (err as Error).message;
    if (runId !== null)
      await store.finishMaintenanceRun(runId, { reportId, reportPath, metrics, error: message });
    return { code: 1, message };
  } finally {
    if (locked) await store.maintenanceUnlock();
    await applyStore.close();
  }
}
