import fs from 'fs/promises';
import path from 'path';
import { isExcludedDirectoryName } from '../index/exclusions.js';

/** Does a wikilink target name a file that exists in the vault? */
export type LinkTargetExists = (target: string) => boolean;

/**
 * Every file in the vault, including the ones the indexer never reads: notes with
 * `index: false` (generated notes such as Brain trails) and folders with a `.noindex`
 * marker (Clippings/Archive). The index has no row for those, so a link to one looks
 * unresolved there although Obsidian opens it fine. Only editor and OS directories
 * (`.obsidian`, `.trash`, `@eaDir`, dot-directories) are skipped.
 *
 * Matching follows Obsidian's "shortest path" links, ignoring case: an exact vault path,
 * or a path ending in `/<target>`, with or without `.md`. An ambiguous basename still
 * counts as existing: the link is not missing, so it is not a repair candidate.
 */
export async function vaultLinkTargets(vaultPath: string): Promise<LinkTargetExists> {
  const files: string[] = [];
  const walk = async (dir: string, rel: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!isExcludedDirectoryName(entry.name)) await walk(path.join(dir, entry.name), relPath);
      } else if (entry.isFile() && !entry.name.startsWith('.')) {
        files.push(relPath.toLowerCase());
      }
    }
  };
  await walk(vaultPath, '');
  return linkTargetMatcher(files);
}

/** The matcher behind `vaultLinkTargets`, over vault-relative file paths. */
export function linkTargetMatcher(relPaths: string[]): LinkTargetExists {
  const exact = new Set<string>();
  const basenames = new Set<string>();
  const lower = relPaths.map(p => p.toLowerCase().replace(/\\/g, '/'));
  for (const p of lower) {
    exact.add(p);
    if (p.endsWith('.md')) exact.add(p.slice(0, -3));
    const base = p.slice(p.lastIndexOf('/') + 1);
    basenames.add(base);
    if (base.endsWith('.md')) basenames.add(base.slice(0, -3));
  }
  return (target: string): boolean => {
    const t = target.trim().toLowerCase().replace(/\\/g, '/').replace(/^\/+/, '');
    if (!t) return false;
    if (exact.has(t)) return true;
    if (!t.includes('/')) return basenames.has(t);
    return lower.some(p => p.endsWith(`/${t}`) || p.endsWith(`/${t}.md`));
  };
}
