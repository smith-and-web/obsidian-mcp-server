import YAML from 'yaml';
import { editFrontmatter, setFrontmatterField } from '../vault/frontmatter.js';

/**
 * Pure text transforms for the deterministic maintenance classes. Each returns the new note
 * content, or null when the change cannot be made exactly (the caller then skips the finding
 * and leaves it for Josh). None of them touches anything but the change it names.
 */

const FM = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?=\r?\n|$)/;

function split(content: string): { head: string; body: string } {
  const match = content.match(FM);
  return match
    ? { head: match[0], body: content.slice(match[0].length) }
    : { head: '', body: content };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const eolOf = (content: string) => (content.includes('\r\n') ? '\r\n' : '\n');

/** True when the note already links to `target` (a basename or a path without .md). */
export function linksTo(content: string, target: string): boolean {
  const re = new RegExp(`\\[\\[\\s*${escape(target)}\\s*(?:\\\\?\\||#|\\]\\])`, 'i');
  return re.test(content);
}

/**
 * Append `[[target]]` to the note's `## Related` section, matching its style: a bullet list
 * gets a bullet, an inline list gets `, [[target]]`. Without the section, one is added at the end.
 */
export function addRelated(content: string, target: string): string | null {
  if (linksTo(content, target)) return null;
  const eol = eolOf(content);
  const link = `[[${target}]]`;
  const { head, body } = split(content);
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex(l => /^##\s+Related\s*$/i.test(l));
  if (start < 0) {
    const trimmed = body.replace(/\s+$/, '');
    return `${head}${trimmed}${eol}${eol}## Related${eol}${eol}- ${link}${eol}`;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++)
    if (/^#{1,2}\s/.test(lines[i])) {
      end = i;
      break;
    }
  let last = -1;
  for (let i = end - 1; i > start; i--)
    if (lines[i].trim()) {
      last = i;
      break;
    }
  if (last < 0) lines.splice(start + 1, 0, '', `- ${link}`);
  else if (/^\s*[-*]\s/.test(lines[last])) {
    const bullet = lines[last].match(/^(\s*[-*]\s)/)![1];
    lines.splice(last + 1, 0, `${bullet}${link}`);
  } else if (/\]\]\s*$/.test(lines[last]))
    lines[last] = `${lines[last].replace(/\s+$/, '')}, ${link}`;
  else return null;
  return head + lines.join(eol);
}

/** Replace inline code, links, embeds and URLs with spaces, keeping every position. */
function mask(line: string): string {
  const blank = (m: string) => ' '.repeat(m.length);
  return line
    .replace(/(`+)[^`]*?\1/g, blank)
    .replace(/!?\[\[[^\]]*\]\]/g, blank)
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, blank)
    .replace(/https?:\/\/\S+/g, blank);
}

/**
 * Turn the first prose mention of `name` into a wikilink to `target`. Prose follows the
 * mention check: no frontmatter, first H1, headings, code fences, inline code or links.
 */
export function linkFirstMention(content: string, name: string, target: string): string | null {
  if (linksTo(content, target)) return null;
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}_-])${words.map(escape).join('\\s+')}(?![\\p{L}\\p{N}_-])`,
    'iu'
  );
  const eol = eolOf(content);
  const { head, body } = split(content);
  const lines = body.split(/\r?\n/);
  let fence = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const marker = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = '';
      continue;
    }
    if (marker) {
      fence = marker[1];
      continue;
    }
    if (/^\s*#/.test(line) || /^\s*\|/.test(line)) continue;
    const found = re.exec(mask(line));
    if (!found) continue;
    const text = line.slice(found.index, found.index + found[0].length);
    const link = text === target ? `[[${target}]]` : `[[${target}|${text}]]`;
    lines[i] = line.slice(0, found.index) + link + line.slice(found.index + found[0].length);
    return head + lines.join(eol);
  }
  return null;
}

/**
 * Point every body wikilink to `oldTarget` at `newTarget`, keeping headings and display text.
 * A link without display text gets the old text as its display, so the note reads the same.
 */
export function repairLink(content: string, oldTarget: string, newTarget: string): string | null {
  const { head, body } = split(content);
  const re = new RegExp(
    `\\[\\[\\s*${escape(oldTarget)}\\s*((?:#[^\\]|]*)?)(\\\\?\\|[^\\]]*)?\\]\\]`,
    'g'
  );
  let count = 0;
  const lines = body.split(/\r?\n/).map(line => {
    const inTable = /^\s*\|/.test(line);
    return line.replace(re, (_m, heading: string, display: string | undefined) => {
      count++;
      if (display) return `[[${newTarget}${heading}${display}]]`;
      const pipe = inTable ? '\\|' : '|';
      return oldTarget === newTarget
        ? `[[${newTarget}${heading}]]`
        : `[[${newTarget}${heading}${pipe}${oldTarget}${heading}]]`;
    });
  });
  if (!count) return null;
  return head + lines.join(eolOf(content));
}

/** Frontmatter source lines with the given keys' lines removed, for a byte-exact comparison. */
function linesExcept(content: string, keys: Set<string>): string[] | null {
  const match = content.match(FM);
  if (!match) return null;
  const doc = YAML.parseDocument(match[1]);
  if (doc.errors.length || !YAML.isMap(doc.contents)) return null;
  const offset = match[0].indexOf('\n') + 1;
  const excluded = new Set<number>();
  for (const pair of doc.contents.items) {
    if (!YAML.isScalar(pair.key) || !keys.has(String(pair.key.value)) || !pair.key.range) continue;
    const start = offset + pair.key.range[0];
    const end =
      offset +
      (YAML.isNode(pair.value) && pair.value.range ? pair.value.range[2] : pair.key.range[2]);
    const first = content.slice(0, start).split('\n').length - 1;
    const last = content.slice(0, Math.max(start, end - 1)).split('\n').length - 1;
    for (let line = first; line <= last; line++) excluded.add(line);
  }
  return content.split('\n').filter((_, i) => !excluded.has(i));
}

/** True when `after` differs from `before` only in the named frontmatter keys. */
export function onlyKeysChanged(before: string, after: string, keys: string[]): boolean {
  const set = new Set(keys);
  const a = linesExcept(before, set);
  const b = linesExcept(after, set);
  return a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b);
}

/** Add `index: true` and/or `aliases: []` where missing. */
export function addMissingFrontmatter(content: string, fields: string[]): string | null {
  const wanted = fields.filter(f => f === 'index' || f === 'aliases');
  if (!wanted.length) return null;
  let result;
  try {
    result = editFrontmatter(
      content,
      doc => {
        for (const f of wanted)
          if (!doc.has(f)) setFrontmatterField(doc, f, f === 'index' ? true : []);
      },
      { createIfMissing: false }
    );
  } catch {
    return null;
  }
  if (!result || result.content === content) return null;
  return onlyKeysChanged(content, result.content, wanted) ? result.content : null;
}

/**
 * Set an existing `updated` field to `stamp`, keeping its quoting. Returns the content
 * unchanged when there is no frontmatter or no `updated`, or when the YAML would not round-trip.
 */
export function bumpUpdated(content: string, stamp: string): string {
  let result;
  try {
    result = editFrontmatter(
      content,
      doc => {
        const node = doc.get('updated', true);
        if (YAML.isScalar(node)) node.value = stamp;
      },
      { createIfMissing: false }
    );
  } catch {
    return content;
  }
  if (!result || result.content === content) return content;
  return onlyKeysChanged(content, result.content, ['updated']) ? result.content : content;
}
