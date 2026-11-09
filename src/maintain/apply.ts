import fs from 'fs/promises';
import { contentHash } from '../index/scanner.js';
import { confinedNotePath } from '../vault/confinedPath.js';
import type { MaintainConfig } from './config.js';
import {
  ApplyStore,
  DEMOTE_REVERT_RATE,
  GRADUATE_DECISIONS,
  GRADUATE_RATE,
  type ApplyFinding,
  type ClassState,
  type DocInfo,
} from './applyStore.js';
import {
  addMissingFrontmatter,
  addRelated,
  bumpUpdated,
  linkFirstMention,
  repairLink,
} from './edits.js';
import { loadGuardPatterns, staticGuard, type EditKind } from './guard.js';
import { zonedTimestamp } from './report.js';
import { replaceIfUnchanged, sha } from './write.js';

/** Classes whose change is mechanical. summary-refresh needs a model; link-coread stays report-only. */
export const DETERMINISTIC = ['link-related', 'link-mention', 'link-repair', 'fm-missing'];

export interface ApplyOutcome {
  findingId: number;
  class: string;
  paths: string[];
  auto: boolean;
  status: 'applied' | 'skipped' | 'would-apply';
  reason?: string;
  changeIds?: number[];
}
export interface ApplySummary {
  enabled: boolean;
  reason: string | null;
  outcomes: ApplyOutcome[];
  graduated: string[];
  demoted: string[];
}

interface Planned {
  path: string;
  before: string;
  after: string;
}

/** Mode changes: graduate on Josh's record, demote on reverts of auto-applied changes. */
export function nextMode(s: ClassState): 'graduate' | 'demote' | null {
  if (!s.graduable || !DETERMINISTIC.includes(s.class)) return s.mode === 'apply' ? 'demote' : null;
  if (s.mode === 'apply')
    return s.autoApplied > 0 && s.autoReverted / s.autoApplied > DEMOTE_REVERT_RATE
      ? 'demote'
      : null;
  const [decided, accepted] = s.demotedAt
    ? [s.decidedSinceDemotion, s.acceptedSinceDemotion]
    : [s.decided, s.accepted];
  return decided >= GRADUATE_DECISIONS && accepted / decided >= GRADUATE_RATE ? 'graduate' : null;
}

export async function applyFindings(ctx: {
  store: ApplyStore;
  config: MaintainConfig;
  now: Date;
  dry: boolean;
  validKeys: Set<string>;
}): Promise<ApplySummary> {
  const { store, config, now, dry } = ctx;
  const summary: ApplySummary = {
    enabled: false,
    reason: null,
    outcomes: [],
    graduated: [],
    demoted: [],
  };
  if (!config.apply) {
    summary.reason = 'MAINTAIN_APPLY is false';
    return summary;
  }
  const loaded = await loadGuardPatterns(config.guardPatternsFile);
  if ('error' in loaded) {
    summary.reason = loaded.error;
    return summary;
  }
  summary.enabled = true;
  const patterns = loaded.patterns;

  const states = await store.classStates();
  const auto = new Set<string>();
  for (const s of states) {
    const change = nextMode(s);
    if (change === 'graduate') {
      summary.graduated.push(s.class);
      if (!dry) await store.setMode(s.class, 'apply', false);
      auto.add(s.class);
    } else if (change === 'demote') {
      summary.demoted.push(s.class);
      if (!dry) await store.setMode(s.class, 'report', true);
    } else if (s.mode === 'apply') auto.add(s.class);
  }

  const accepted = await store.findings(`status='accepted' AND class=ANY($2::text[])`, [
    DETERMINISTIC,
  ]);
  const open = auto.size
    ? await store.findings(`status='open' AND class=ANY($2::text[])`, [[...auto]])
    : [];
  const queue = [
    ...accepted.map(f => ({ f, auto: false })),
    ...open.map(f => ({ f, auto: true })),
  ].filter(q => ctx.validKeys.has(q.f.key));

  let remaining =
    config.applyWeeklyCap - (await store.changesSince(new Date(now.getTime() - 7 * 86400000)));
  const written = new Map<string, string>(); // path -> sha of the text this run wrote
  const stamp = zonedTimestamp(now, config.timeZone);
  const minAgeMs = config.applyMinAgeHours * 3600000;

  const read = async (path: string) => {
    const abs = await confinedNotePath(config.vaultPath, path);
    const [content, stat] = await Promise.all([fs.readFile(abs, 'utf8'), fs.stat(abs)]);
    return { content, mtimeMs: stat.mtimeMs };
  };
  const guard = async (doc: DocInfo | undefined, path: string, kind: EditKind) => {
    let note;
    try {
      note = await read(path);
    } catch {
      return { reason: 'unreadable' };
    }
    const why = staticGuard(doc, note.content, kind, config.excludeTags, patterns);
    if (why) return { reason: why };
    const ours = written.get(path) === sha(note.content);
    if (!ours && now.getTime() - note.mtimeMs < minAgeMs) return { reason: 'recent' };
    if (!ours && contentHash(note.content, config.volatileKeys) !== doc!.sha)
      return { reason: 'changed' };
    return { content: note.content };
  };

  for (const { f, auto: isAuto } of queue) {
    const outcome: ApplyOutcome = {
      findingId: f.id,
      class: f.class,
      paths: f.paths,
      auto: isAuto,
      status: 'skipped',
    };
    summary.outcomes.push(outcome);
    const docs = await store.docs(f.paths);
    const plan = await planFinding(f, docs, store, guard, stamp);
    if ('reason' in plan) {
      outcome.reason = plan.reason;
      continue;
    }
    if (plan.changes.length > remaining) {
      outcome.reason = 'weekly-cap';
      continue;
    }
    if (dry) {
      outcome.status = 'would-apply';
      remaining -= plan.changes.length;
      continue;
    }
    const done: Planned[] = [];
    let failed: string | null = null;
    for (const c of plan.changes) {
      const r = await replaceIfUnchanged(config.vaultPath, c.path, c.before, c.after);
      if (r !== 'written') {
        failed = r;
        break;
      }
      done.push(c);
    }
    if (failed) {
      for (const c of done.reverse())
        await replaceIfUnchanged(config.vaultPath, c.path, c.after, c.before);
      outcome.reason = failed;
      continue;
    }
    for (const c of plan.changes) written.set(c.path, sha(c.after));
    outcome.changeIds = await store.recordApplied(
      f,
      plan.changes.map(c => ({
        path: c.path,
        beforeText: c.before,
        beforeSha: sha(c.before),
        afterSha: sha(c.after),
      })),
      isAuto
    );
    outcome.status = 'applied';
    remaining -= plan.changes.length;
  }
  return summary;
}

type Guard = (
  doc: DocInfo | undefined,
  path: string,
  kind: EditKind
) => Promise<{ reason: string } | { content: string }>;

async function planFinding(
  f: ApplyFinding,
  docs: Map<string, DocInfo>,
  store: ApplyStore,
  guard: Guard,
  stamp: string
): Promise<{ changes: Planned[] } | { reason: string }> {
  const one = async (
    path: string,
    kind: EditKind,
    edit: (content: string) => string | null
  ): Promise<Planned | { reason: string } | null> => {
    const g = await guard(docs.get(path), path, kind);
    if ('reason' in g) return g;
    const changed = edit(g.content);
    if (changed === null) return null;
    return { path, before: g.content, after: bumpUpdated(changed, stamp) };
  };
  const [a, b] = f.paths;
  const results: (Planned | { reason: string } | null)[] = [];
  switch (f.class) {
    case 'link-related': {
      const [ta, tb] = [await store.linkText(b), await store.linkText(a)];
      results.push(await one(a, 'body', c => addRelated(c, ta)));
      results.push(await one(b, 'body', c => addRelated(c, tb)));
      break;
    }
    case 'link-mention': {
      const target = await store.linkText(b);
      const name = String(f.detail.name ?? '');
      results.push(await one(a, 'body', c => linkFirstMention(c, name, target)));
      break;
    }
    case 'link-repair': {
      const target = await store.linkText(b);
      const old = String(f.detail.target ?? '');
      results.push(await one(a, 'body', c => repairLink(c, old, target)));
      break;
    }
    case 'fm-missing': {
      const fields = Array.isArray(f.detail.fields) ? (f.detail.fields as string[]) : [];
      results.push(await one(a, 'frontmatter', c => addMissingFrontmatter(c, fields)));
      break;
    }
    default:
      return { reason: 'report-only class' };
  }
  const blocked = results.find(r => r && 'reason' in r) as { reason: string } | undefined;
  if (blocked) return blocked;
  const changes = results.filter((r): r is Planned => r !== null && !('reason' in r));
  return changes.length ? { changes } : { reason: 'no-exact-change' };
}
