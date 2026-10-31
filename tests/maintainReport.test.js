import { describe, it, expect } from 'vitest';
import matter from 'gray-matter';
import { renderReport, isoWeek, quoteYaml } from '../src/maintain/report.js';
const metrics = {
  documents: 7,
  unresolvedLinks: 1,
  orphans: 2,
  invalidFrontmatter: 0,
  nearDuplicatePairs: 1,
  missingLinkPairs: 1,
  findings: { open: 7, accepted: 0, rejected: 0, resolved: 0 },
  decisionsParsed: 0,
  conflicts: [],
};
const input = {
  reportId: '2026-W44',
  now: new Date('2026-10-26T10:00:00Z'),
  timeZone: 'Atlantic/Bermuda',
  findings: [],
  metrics,
  previousMetrics: null,
  decided: [],
  classes: [],
  openClasses: 7,
};
describe('maintenance report', () => {
  it('round trips the complete required frontmatter', () => {
    expect(matter(renderReport(input)).data).toEqual({
      title: 'Brain maintenance 2026-W44',
      type: 'inbox',
      status: 'draft',
      tags: ['maintenance'],
      created: '2026-10-26T07:00:00-03:00',
      updated: '2026-10-26T07:00:00-03:00',
      summary: 'Weekly brain maintenance report 2026-W44: 7 open findings across 7 classes.',
      maintenance_report: '2026-W44',
      index: false,
      aliases: [],
    });
    const text = 'a summary: with "quotes" and \\ slash';
    expect(matter(`---\nsummary: ${quoteYaml(text)}\n---\n`).data.summary).toBe(text);
  });
  it('uses Atlantic winter offset and ISO weeks across year boundaries', () => {
    expect(
      matter(renderReport({ ...input, now: new Date('2026-12-01T10:00:00Z') })).data.created
    ).toBe('2026-12-01T06:00:00-04:00');
    for (const [date, week] of [
      ['2026-12-31', '2026-W53'],
      ['2027-01-01', '2026-W53'],
      ['2026-10-26', '2026-W44'],
    ])
      expect(isoWeek(new Date(`${date}T12:00:00Z`), 'Atlantic/Bermuda')).toBe(week);
    expect(isoWeek(new Date('2026-10-26T01:00:00Z'), 'Atlantic/Bermuda')).toBe('2026-W43');
  });
  const cases = [
    [
      'link-related',
      { cosine: 0.8712 },
      '[[A]] ↔ [[B]]',
      "Cosine 0.8712. Add each to the other's `## Related`.",
    ],
    [
      'link-mention',
      { cosine: 0.8, name: 'apple pie' },
      '[[B]] is mentioned in [[A]]',
      '"apple pie" appears unlinked (cosine 0.8000). Link the first mention.',
    ],
    [
      'link-repair',
      { target: 'old' },
      '[[A]] links to "old"; matches [[B]]',
      'Exactly one note matches by title or alias. Point the link at it.',
    ],
    [
      'fm-missing',
      { fields: ['aliases'] },
      '[[A]]',
      'Missing: aliases. Add `index: true` / `aliases: []`.',
    ],
    [
      'summary-refresh',
      { baseCosine: 0.9, currentCosine: 0.7, summarySince: '2026-10-01T12:00:00Z' },
      '[[A]]',
      'Summary/body cosine fell from 0.9000 to 0.7000 since 2026-10-01. Rewrite the summary.',
    ],
    [
      'merge-duplicate',
      { cosine: 0.92, titleSimilarity: 0.7 },
      '[[A]] ↔ [[B]]',
      'Cosine 0.9200, title similarity 0.7000. Merge, or mark one as superseding the other.',
    ],
    [
      'hub-review',
      { newestLinked: 'notes/B.md', days: 59 },
      '[[A]]',
      '[[B]] was updated 59 days after this hub. Review its status.',
    ],
  ];
  for (const [cls, detail, subject, line] of cases)
    it(`renders ${cls} exactly`, () => {
      const report = renderReport({
        ...input,
        findings: [{ id: 17, class: cls, paths: ['notes/A.md', 'notes/B.md'], detail }],
      });
      expect(report).toContain(
        `### ${cls} (1)\n\n#### f17 · ${subject}\n${line}\n- [ ] accept f17\n- [ ] reject f17`
      );
    });
  it('omits empty optional sections and shows absent metrics as dashes', () => {
    const report = renderReport({
      ...input,
      metrics: { ...metrics, findings: { open: 0 } },
      openClasses: 0,
    });
    expect(report).not.toContain('## Acceptance so far');
    expect(report).not.toContain('## Decided since last report');
    expect(report).not.toContain('### link-related');
    expect(report).toContain('| Documents | 7 | – |');
    expect(report).toContain('no open findings.');
  });
  it('renders previous metrics, decisions and acceptance counts', () => {
    const report = renderReport({
      ...input,
      previousMetrics: { documents: 6, findings: { open: 10 } },
      decided: [{ id: 9, class: 'link-mention', status: 'accepted', decidedVia: 'checkbox' }],
      classes: [{ class: 'link-related', decided: 4, accepted: 3 }],
    });
    expect(report).toContain('| Documents | 7 | 6 |');
    expect(report).toContain('| Open findings | 7 | 10 |');
    expect(report).toContain('- f9 · link-mention · accepted (checkbox)');
    expect(report).toContain('| link-related | 4 | 3 | 75% |');
  });
});
