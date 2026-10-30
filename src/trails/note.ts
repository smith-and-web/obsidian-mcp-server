import fs from 'fs/promises';
import path from 'path';
import { quoteYaml, zonedTimestamp } from '../maintain/report.js';
import { parseFrontmatter } from '../vault/frontmatter.js';
export interface TrailsNoteInput {
  notePath: string;
  now: Date;
  tz: string;
  minWeight: number;
  maxSources: number;
  perNote: number;
  edges: { pathA: string; pathB: string; weight: number }[];
  scores: { path: string; score: number }[];
  created?: string;
  updated?: string;
}
export function renderTrailsNote(input: TrailsNoteInput): string {
  const { notePath, now, tz, minWeight, maxSources, perNote } = input;
  const edges = input.edges.filter(e => e.weight >= minWeight);
  const scores = new Map(input.scores.map(s => [s.path, s.score]));
  const partners = new Map<string, { path: string; weight: number }[]>();
  for (const e of edges)
    for (const [a, b] of [
      [e.pathA, e.pathB],
      [e.pathB, e.pathA],
    ]) {
      const list = partners.get(a) ?? [];
      list.push({ path: b, weight: e.weight });
      partners.set(a, list);
    }
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const sources = [...partners.keys()]
    .sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0) || compare(a, b))
    .slice(0, maxSources);
  const title = path.basename(notePath, '.md'),
    stamp = zonedTimestamp(now, tz);
  const lines = [
    '---',
    `title: ${quoteYaml(title)}`,
    'type: reference',
    'status: active',
    'tags: [generated, trails]',
    `created: ${quoteYaml(input.created ?? stamp)}`,
    `updated: ${quoteYaml(input.updated ?? stamp)}`,
    `summary: ${quoteYaml("Generated nightly: notes most often read together, from the brain's learn log. Do not edit.")}`,
    'index: false',
    'aliases: []',
    'BC-list-note-field: trail',
    'BC-list-note-exclude-index: true',
    '---',
    `# ${title}`,
    '',
    `Rebuilt every night by the trails job from which notes are read together. Edits are overwritten. ${edges.length} edges at or above weight ${minWeight.toFixed(1)}, ${sources.length} source notes.`,
    '',
  ];
  const link = (p: string) => `[[${p.replace(/\.md$/, '')}]]`;
  for (const source of sources) {
    lines.push(`- ${link(source)}`);
    for (const partner of partners
      .get(source)!
      .sort((a, b) => b.weight - a.weight || compare(a.path, b.path))
      .slice(0, perNote))
      lines.push(`  - ${link(partner.path)}`);
  }
  return lines.join('\n') + '\n';
}
export async function writeTrailsNote(
  vaultPath: string,
  input: TrailsNoteInput
): Promise<'written' | 'unchanged'> {
  const abs = path.resolve(vaultPath, input.notePath);
  let old = '';
  try {
    old = await fs.readFile(abs, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  if (old) {
    const fm = parseFrontmatter(old).frontmatter;
    if (fm?.['BC-list-note-field'] !== 'trail')
      throw new Error(`brain-trails: ${input.notePath} is not a trails note`);
    input = {
      ...input,
      created: fm.created ? String(fm.created) : undefined,
      updated: fm.updated ? String(fm.updated) : undefined,
    };
    if (renderTrailsNote(input) === old) return 'unchanged';
  } else {
    // An existing empty file is still user-owned.
    try {
      await fs.stat(abs);
      throw new Error(`brain-trails: ${input.notePath} is not a trails note`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const temp = path.join(path.dirname(abs), `.${path.basename(abs)}.tmp`);
  await fs.writeFile(temp, renderTrailsNote({ ...input, updated: undefined }), 'utf8');
  await fs.rename(temp, abs);
  return 'written';
}
