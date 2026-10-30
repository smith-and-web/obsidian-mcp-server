import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { editFrontmatter } from './frontmatter.js';

export type EditResult =
  'written' | 'unchanged' | 'recent' | 'raced' | 'invalid' | 'missing' | 'roundtrip';

export function sameExceptKey(before: string, after: string, key: string): boolean {
  // Compare exact bytes outside the target field's YAML source range. This also
  // accepts a flow sequence restyled to a block sequence before a revert.
  const lines = (text: string): string[] => {
    const match = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?=\r?\n|$)/);
    if (!match) return text.split('\n');
    const doc = YAML.parseDocument(match[1]);
    if (doc.errors.length || !YAML.isMap(doc.contents)) return text.split('\n');
    const offset = match[0].indexOf('\n') + 1;
    const excluded = new Set<number>();
    for (const pair of doc.contents.items) {
      if (!YAML.isScalar(pair.key) || pair.key.value !== key || !pair.key.range) continue;
      const start = offset + pair.key.range[0];
      const end =
        offset +
        (YAML.isNode(pair.value) && pair.value.range ? pair.value.range[2] : pair.key.range[2]);
      const first = text.slice(0, start).split('\n').length - 1;
      const last = text.slice(0, Math.max(start, end - 1)).split('\n').length - 1;
      for (let line = first; line <= last; line++) excluded.add(line);
    }
    return text.split('\n').filter((_, i) => !excluded.has(i));
  };
  return JSON.stringify(lines(before)) === JSON.stringify(lines(after));
}

export async function atomicFrontmatterEdit(
  absPath: string,
  edit: (doc: YAML.Document) => void,
  opts: { minAgeMs: number; now: Date; onlyKey: string; checkOnly?: boolean }
): Promise<EditResult> {
  let stat;
  try {
    stat = await fs.stat(absPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw err;
  }
  if (opts.now.getTime() - stat.mtimeMs < opts.minAgeMs) return 'recent';
  let content: string;
  try {
    content = await fs.readFile(absPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw err;
  }
  let result;
  try {
    result = editFrontmatter(content, edit, { createIfMissing: false });
  } catch {
    return 'invalid';
  }
  if (!result) return 'invalid';
  if (result.content === content) return 'unchanged';
  if (!sameExceptKey(content, result.content, opts.onlyKey)) return 'roundtrip';
  if (opts.checkOnly) return 'written';
  const temp = path.join(path.dirname(absPath), `.${path.basename(absPath)}.edit.tmp`);
  // Exclusive creation prevents competing writers from sharing the staging file.
  let staged = false;
  try {
    await fs.writeFile(temp, result.content, { encoding: 'utf8', flag: 'wx', mode: stat.mode });
    staged = true;
    let next;
    try {
      next = await fs.stat(absPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'raced';
      throw err;
    }
    if (next.mtimeMs !== stat.mtimeMs || next.size !== stat.size) return 'raced';
    await fs.rename(temp, absPath);
    return 'written';
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return 'raced';
    throw err;
  } finally {
    if (staged) await fs.rm(temp, { force: true });
  }
}
