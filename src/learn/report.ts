import type { IndexStore } from '../index/store.js';

export interface LearnReport {
  version: 1;
  ranAt: string;
  serverVersion: string;
  collection: string;
  days: number;
  sessions: {
    total: number;
    perDay: number;
    byClient: Record<string, number>;
    medianMinutesClosed: number | null;
  };
  searches: {
    total: number;
    perDay: number;
    byTool: Record<string, number>;
    redactedShare: number | null;
  };
  links: {
    linkedSemanticPerDay: number;
    linkedSearchRate: number | null;
    usedAt1: number | null;
    usedAt3: number | null;
    usedAt8: number | null;
    missRate: number | null;
  };
  behaviour: { reformulationRate: number | null; fallbackRate: number | null };
  feedback: {
    coverage: number | null;
    bySource: { agent: number; user: number };
    negativeRateAll: number | null;
    negativeRateUser: number | null;
  };
  trailsShadow: {
    searches: number;
    top1Differs: number | null;
    mrrLive: number | null;
    mrrShadow: number | null;
  };
  volumeGate: 'pass' | 'fail';
}

const round = (value: number) => Math.round(value * 10000) / 10000;
const rate = (numerator: number | string, denominator: number | string): number | null =>
  Number(denominator) === 0 ? null : round(Number(numerator) / Number(denominator));

export async function buildReport(
  store: IndexStore,
  days: number,
  serverVersion: string
): Promise<LearnReport> {
  const sessions = await store.learnReportSessions(days);
  const searches = await store.learnReportSearches(days);
  const links = await store.learnReportLinks(days);
  const behaviour = await store.learnReportBehaviour(days);
  const feedback = await store.learnReportFeedback(days);
  const shadow = await store.learnReportTrailsShadow(days);
  const total = searches.reduce((sum, row) => sum + Number(row.n), 0);
  const redacted = searches.reduce((sum, row) => sum + Number(row.redacted), 0);
  const byTool = { 'semantic-search': 0, 'similar-notes': 0, 'search-vault': 0 };
  for (const row of searches) byTool[row.tool as keyof typeof byTool] = Number(row.n);
  const linkedSemanticPerDay = round(Number(links.linked) / days);
  return {
    version: 1,
    ranAt: new Date().toISOString(),
    serverVersion,
    collection: store.collection,
    days,
    sessions: {
      total: Number(sessions.total),
      perDay: round(Number(sessions.total) / days),
      byClient: Object.fromEntries(sessions.clients.map(row => [row.client, Number(row.n)])),
      medianMinutesClosed: sessions.median === null ? null : round(Number(sessions.median)),
    },
    searches: { total, perDay: round(total / days), byTool, redactedShare: rate(redacted, total) },
    links: {
      linkedSemanticPerDay,
      linkedSearchRate: rate(links.linked, links.semantic),
      usedAt1: rate(links.at1, links.reads),
      usedAt3: rate(links.at3, links.reads),
      usedAt8: rate(links.at8, links.reads),
      missRate: rate(links.misses, links.reads),
    },
    behaviour: {
      reformulationRate: rate(behaviour.reformulations, behaviour.total),
      fallbackRate: rate(behaviour.fallbacks, behaviour.total),
    },
    feedback: {
      coverage: rate(feedback.covered, links.semantic),
      bySource: { agent: Number(feedback.agent), user: Number(feedback.user) },
      negativeRateAll: rate(feedback.negative, feedback.total),
      negativeRateUser: rate(feedback.negative_user, feedback.user),
    },
    trailsShadow: {
      searches: Number(shadow.searches),
      top1Differs: shadow.top1_differs === null ? null : round(Number(shadow.top1_differs)),
      mrrLive: shadow.mrr_live === null ? null : round(Number(shadow.mrr_live)),
      mrrShadow: shadow.mrr_shadow === null ? null : round(Number(shadow.mrr_shadow)),
    },
    volumeGate: linkedSemanticPerDay >= 30 ? 'pass' : 'fail',
  };
}
