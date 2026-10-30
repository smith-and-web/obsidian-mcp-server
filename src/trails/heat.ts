import fs from 'fs/promises';
import path from 'path';
import type { IndexStore } from '../index/store.js';
import { confinedNotePath } from '../vault/confinedPath.js';
import { atomicFrontmatterEdit } from '../vault/atomicEdit.js';
import { parseFrontmatter, setFrontmatterField } from '../vault/frontmatter.js';
import type { TrailsConfig } from './config.js';

export async function writeHeat(
  store: IndexStore,
  config: TrailsConfig,
  opts: { now: Date; clear: boolean; checkOnly?: boolean }
) {
  const metrics = {
    heatWrites: 0,
    heatUnchanged: 0,
    heatSkippedRecent: 0,
    heatSkippedRaced: 0,
    heatSkippedInvalid: 0,
    heatSkippedMissing: 0,
    heatSkippedRoundTrip: 0,
    heatCapped: 0,
  };
  const roundTripFailures: string[] = [];
  const candidates = await store.heatCandidates(config.heatTypes, opts.clear);
  const root = path.resolve(config.vaultPath);
  for (const item of candidates) {
    if (!opts.checkOnly && metrics.heatWrites >= config.heatMaxWrites) {
      metrics.heatCapped++;
      continue;
    }
    const abs = await confinedNotePath(root, item.path);
    let text;
    try {
      text = await fs.readFile(abs, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        metrics.heatSkippedMissing++;
        continue;
      }
      throw err;
    }
    const parsed = parseFrontmatter(text);
    if (parsed.error || !parsed.frontmatter) {
      metrics.heatSkippedInvalid++;
      continue;
    }
    const current = parsed.frontmatter.heat;
    if (
      (opts.clear && current === undefined) ||
      (!opts.clear && ((current === undefined && item.bucket === 0) || current === item.bucket))
    ) {
      metrics.heatUnchanged++;
      continue;
    }
    const result = await atomicFrontmatterEdit(
      abs,
      doc => setFrontmatterField(doc, 'heat', opts.clear ? null : item.bucket),
      {
        now: opts.now,
        minAgeMs: opts.clear || opts.checkOnly ? 0 : config.heatMinAgeMinutes * 60000,
        onlyKey: 'heat',
        vaultPath: root,
        checkOnly: opts.checkOnly,
      }
    );
    switch (result) {
      case 'written':
        metrics.heatWrites++;
        break;
      case 'unchanged':
        metrics.heatUnchanged++;
        break;
      case 'recent':
        metrics.heatSkippedRecent++;
        break;
      case 'raced':
        metrics.heatSkippedRaced++;
        break;
      case 'invalid':
        metrics.heatSkippedInvalid++;
        break;
      case 'missing':
        metrics.heatSkippedMissing++;
        break;
      case 'roundtrip':
        metrics.heatSkippedRoundTrip++;
        roundTripFailures.push(item.path);
        break;
    }
  }
  return { ...metrics, roundTripFailures };
}
