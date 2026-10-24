import fs from 'fs/promises';
import path from 'path';
import { parseFrontmatter } from '../vault/frontmatter.js';

/**
 * The prose of a note: the body without its frontmatter, its first H1 line, fenced and inline
 * code, wikilinks, embeds and markdown links. A mention found only in one of those is not one.
 */
export function bodyText(content: string): string {
  const lines = parseFrontmatter(content).body.split(/\r?\n/);
  const kept: string[] = [];
  let fence = '';
  let titleSeen = false;
  for (const line of lines) {
    const marker = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = '';
      continue;
    }
    if (marker) {
      fence = marker[1];
      continue;
    }
    if (!titleSeen && /^#\s/.test(line)) {
      titleSeen = true;
      continue;
    }
    kept.push(line);
  }
  return kept
    .join('\n')
    .replace(/(`+)[^`]*?\1/g, ' ')
    .replace(/!?\[\[[^\]]*\]\]/g, ' ')
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, ' ');
}

/**
 * True when `name` appears in `text` as a whole word, ignoring case. Hyphens count as word
 * characters, so `kindling` does not match inside `kindling-splash`; any run of whitespace in
 * the name matches any run in the text.
 */
export function mentions(text: string, name: string): boolean {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const pattern = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}_-])${pattern}(?![\\p{L}\\p{N}_-])`, 'iu').test(text);
}

/**
 * Picks, from names ordered by preference, the first one a vault note mentions in its prose.
 * Returns null when none does or the note cannot be read.
 */
export function vaultMentionVerifier(vaultPath: string) {
  return async (notePath: string, names: string[]): Promise<string | null> => {
    let content: string;
    try {
      content = await fs.readFile(path.join(vaultPath, notePath), 'utf8');
    } catch {
      return null;
    }
    const text = bodyText(content);
    return names.find(name => mentions(text, name)) ?? null;
  };
}
