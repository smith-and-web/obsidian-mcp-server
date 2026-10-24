import fs from 'fs/promises';
import matter from 'gray-matter';
import { walkVault } from '../index/scanner.js';

/** Combine ticks across reports before applying any decision. */
export function parseDecisions(texts: string[]): {
  decisions: { id: number; decision: 'accepted' | 'rejected' }[];
  conflicts: number[];
} {
  const ticks = new Map<number, Set<string>>();
  for (const text of texts)
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*[-*] \[([ xX])\] (accept|reject) f(\d+)\s*$/.exec(line);
      if (!match || match[1] === ' ') continue;
      const id = Number(match[3]);
      const choices = ticks.get(id) ?? new Set<string>();
      choices.add(match[2]);
      ticks.set(id, choices);
    }
  const decisions: { id: number; decision: 'accepted' | 'rejected' }[] = [];
  const conflicts: number[] = [];
  for (const [id, choices] of ticks) {
    if (choices.size > 1) conflicts.push(id);
    else decisions.push({ id, decision: choices.has('accept') ? 'accepted' : 'rejected' });
  }
  return { decisions, conflicts };
}

/** Report identity is frontmatter, so moved or renamed reports still supply decisions. */
export async function readReportDecisions(vaultPath: string) {
  const texts: string[] = [];
  for (const file of await walkVault(vaultPath)) {
    const text = await fs.readFile(file.absPath, 'utf8');
    if (!text.includes('maintenance_report:')) continue;
    let report: boolean;
    try {
      report = typeof matter(text).data.maintenance_report === 'string';
    } catch {
      continue;
    }
    if (report) texts.push(text);
  }
  return parseDecisions(texts);
}
