import type { FindingRow, Hygiene } from '../index/store.js';
import { CLASSES } from './classes.js';

export interface MaintenanceMetrics extends Hygiene {
  findings: Record<string, number>;
  decisionsParsed: number;
  conflicts: number[];
}
export interface ClassCounts {
  class: string;
  decided: number;
  accepted: number;
}
export interface ReportInput {
  reportId: string;
  now: Date;
  timeZone: string;
  findings: FindingRow[];
  metrics: MaintenanceMetrics;
  previousMetrics: Record<string, unknown> | null;
  decided: FindingRow[];
  classes: ClassCounts[];
  openClasses: number;
}

/** Calendar parts and explicit offset come from the configured zone, never the process zone. */
export function zonedTimestamp(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  }).formatToParts(now);
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const offset = p.timeZoneName === 'GMT' ? '+00:00' : p.timeZoneName.replace('GMT', '');
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${offset}`;
}
export function isoWeek(now: Date, timeZone: string): string {
  const local = zonedTimestamp(now, timeZone).slice(0, 10);
  const day = new Date(`${local}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const year = day.getUTCFullYear();
  const week = Math.ceil(((day.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}
export function quoteYaml(value: string): string {
  return JSON.stringify(value);
}
const base = (p: unknown) => String(p).split('/').pop()!.replace(/\.md$/i, '');
const link = (p: unknown) => `[[${base(p)}]]`;
const cosine = (v: unknown) => Number(v).toFixed(4);
function findingText(f: FindingRow, timeZone: string): [string, string] {
  const [a, b] = f.paths;
  const d = f.detail;
  switch (f.class) {
    case 'link-related':
      return [
        `${link(a)} ↔ ${link(b)}`,
        `Cosine ${cosine(d.cosine)}. Add each to the other's \`## Related\`.`,
      ];
    case 'link-mention':
      return [
        `${link(b)} is mentioned in ${link(a)}`,
        `"${d.name}" appears unlinked (cosine ${cosine(d.cosine)}). Link the first mention.`,
      ];
    case 'link-repair':
      return [
        `${link(a)} links to "${d.target}"; matches ${link(b)}`,
        'Exactly one note matches by title or alias. Point the link at it.',
      ];
    case 'fm-missing':
      return [
        link(a),
        `Missing: ${(d.fields as string[]).join(', ')}. Add \`index: true\` / \`aliases: []\`.`,
      ];
    case 'summary-refresh':
      return [
        link(a),
        `Summary/body cosine fell from ${cosine(d.baseCosine)} to ${cosine(d.currentCosine)} since ${zonedTimestamp(new Date(String(d.summarySince)), timeZone).slice(0, 10)}. Rewrite the summary.`,
      ];
    case 'merge-duplicate':
      return [
        `${link(a)} ↔ ${link(b)}`,
        `Cosine ${cosine(d.cosine)}, title similarity ${cosine(d.titleSimilarity)}. Merge, or mark one as superseding the other.`,
      ];
    case 'hub-review':
      return [
        link(a),
        `${link(d.newestLinked)} was updated ${Math.floor(Number(d.days))} days after this hub. Review its status.`,
      ];
    case 'link-coread':
      return [
        `${link(a)} ↔ ${link(b)}`,
        `Read together on ${d.events} session-days (trail weight ${Number(d.weight).toFixed(1)}) but neither links to the other. Add each to the other's \`## Related\`.`,
      ];
    default:
      throw new Error(`Unknown finding class: ${f.class}`);
  }
}
/** Render the worker's only vault output. */
export function renderReport(input: ReportInput): string {
  const { reportId, now, timeZone, metrics, previousMetrics: prev } = input;
  const title = `Brain maintenance ${reportId}`;
  const stamp = zonedTimestamp(now, timeZone);
  const count = metrics.findings.open;
  const summary = `Weekly brain maintenance report ${reportId}: ${count ? `${count} open findings across ${input.openClasses} classes` : 'no open findings'}.`;
  const lines = [
    '---',
    `title: ${quoteYaml(title)}`,
    'type: inbox',
    'status: draft',
    'tags: [maintenance]',
    `created: ${quoteYaml(stamp)}`,
    `updated: ${quoteYaml(stamp)}`,
    `summary: ${quoteYaml(summary)}`,
    `maintenance_report: ${quoteYaml(reportId)}`,
    'index: false',
    'aliases: []',
    '---',
    `# ${title}`,
    '',
    'Tick **accept** or **reject** under each finding; the next weekly run records it, or decide in chat with',
    '`maintenance-decision`. Accepting changes no note: apply it yourself or with brain-health. A rejected finding is not',
    'proposed again.',
    '',
    '## Trends',
    '',
    '| Metric | This week | Last week |',
    '|---|---|---|',
  ];
  const labels: [keyof Hygiene, string][] = [
    ['documents', 'Documents'],
    ['unresolvedLinks', 'Unresolved links'],
    ['orphans', 'Orphans'],
    ['invalidFrontmatter', 'Invalid frontmatter'],
    ['nearDuplicatePairs', 'Near-duplicate pairs'],
    ['missingLinkPairs', 'Missing-link pairs'],
  ];
  for (const [key, label] of labels)
    lines.push(`| ${label} | ${metrics[key]} | ${prev?.[key] ?? '–'} |`);
  lines.push(
    `| Open findings | ${count} | ${(prev?.findings as Record<string, number> | undefined)?.open ?? '–'} |`,
    '',
    '## Findings'
  );
  for (const cls of CLASSES) {
    const findings = input.findings.filter(f => f.class === cls.class).sort((a, b) => a.id - b.id);
    if (!findings.length) continue;
    lines.push('', `### ${cls.class} (${findings.length})`);
    for (const f of findings) {
      const [subject, line] = findingText(f, timeZone);
      lines.push(
        '',
        `#### f${f.id} · ${subject}`,
        line,
        `- [ ] accept f${f.id}`,
        `- [ ] reject f${f.id}`
      );
    }
  }
  if (input.decided.length) {
    lines.push('', '## Decided since last report', '');
    for (const f of input.decided)
      lines.push(`- f${f.id} · ${f.class} · ${f.status} (${f.decidedVia})`);
  }
  const decidedClasses = input.classes.filter(c => c.decided > 0);
  if (decidedClasses.length) {
    lines.push(
      '',
      '## Acceptance so far',
      '',
      '| Class | Decided | Accepted | Rate |',
      '|---|---|---|---|'
    );
    for (const c of decidedClasses)
      lines.push(
        `| ${c.class} | ${c.decided} | ${c.accepted} | ${Math.round((100 * c.accepted) / c.decided)}% |`
      );
  }
  return lines.join('\n') + '\n';
}
