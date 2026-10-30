import type { IndexStore } from '../index/store.js';
import type { TrailsConfig } from './config.js';
import { writeHeat } from './heat.js';
import { writeTrailsNote } from './note.js';

// D6/D7 event weights are fixed, not environment settings. The SQL in store.ts uses these values.
export const TRAILS_WEIGHTS = { search: 1.0, untied: 0.5, agent: 2.0, user: 3.0 } as const;
export async function runTrails(
  store: IndexStore,
  config: TrailsConfig,
  opts: { dry: boolean; clearHeat: boolean; now: Date; log: (line: string) => void }
): Promise<{ code: 0 | 1; message?: string }> {
  let locked = false,
    runId: number | null = null;
  const metrics: Record<string, unknown> = {};
  try {
    await store.ensureTrailsSchema();
    locked = await store.trailsLock();
    if (!locked) return { code: 1, message: 'brain-trails: another run is in progress' };
    if (opts.clearHeat) {
      const { roundTripFailures: _failures, ...counts } = await writeHeat(store, config, {
        now: opts.now,
        clear: true,
      });
      for (const [key, value] of Object.entries(counts)) opts.log(`${key}: ${value}`);
      return { code: 0 };
    }
    if (!opts.dry) runId = await store.startTrailsRun();
    const { edges, buckets } = await store.rebuildTrailsAndHeat({
      now: opts.now,
      windowDays: config.windowDays,
      halfLifeDays: config.halfLifeDays,
      tz: config.tz,
      thresholds: config.thresholds,
      commit: !opts.dry,
    });
    Object.assign(metrics, {
      edges,
      heat: Object.fromEntries(buckets.map((n, b) => [`bucket${b}`, n])),
      note: 'disabled',
      heatWrites: 0,
      heatUnchanged: 0,
      heatSkippedRecent: 0,
      heatSkippedRaced: 0,
      heatSkippedInvalid: 0,
      heatSkippedMissing: 0,
      heatSkippedRoundTrip: 0,
      heatCapped: 0,
    });
    if (opts.dry) {
      const check = await writeHeat(store, config, {
        now: opts.now,
        clear: false,
        checkOnly: true,
      });
      opts.log(`edges: ${edges}`);
      buckets.forEach((n, b) => opts.log(`heat.bucket${b}: ${n}`));
      opts.log(`heat.roundTripFailures: ${check.roundTripFailures.length}`);
      check.roundTripFailures.forEach(p => opts.log(`  ${p}`));
      opts.log('dry run complete');
      return { code: 0 };
    }
    if (config.notePath)
      metrics.note = await writeTrailsNote(config.vaultPath, {
        notePath: config.notePath,
        now: opts.now,
        tz: config.tz,
        minWeight: config.noteMinWeight,
        maxSources: config.noteMaxSources,
        perNote: config.notePerNote,
        edges: await store.trailEdges(config.noteMinWeight),
        scores: await store.heatScores(),
      });
    if (config.writeHeat && config.heatTypes.length) {
      const { roundTripFailures: _failures, ...counts } = await writeHeat(store, config, {
        now: opts.now,
        clear: false,
      });
      Object.assign(metrics, counts);
    }
    await store.finishTrailsRun(runId!, metrics, null);
    opts.log(
      `brain-trails: ${edges} edges, ${buckets.slice(1).reduce((a, b) => a + b, 0)} notes with heat >= 1, note ${metrics.note}, heat writes ${metrics.heatWrites} (recent ${metrics.heatSkippedRecent}, raced ${metrics.heatSkippedRaced}, invalid ${metrics.heatSkippedInvalid})`
    );
    return { code: 0 };
  } catch (err) {
    const message = (err as Error).message;
    if (runId !== null) await store.finishTrailsRun(runId, metrics, message);
    return { code: 1, message };
  } finally {
    if (locked) await store.trailsUnlock();
  }
}
