/**
 * Frontmatter parsing and serialization utilities
 * Uses gray-matter for robust YAML parsing
 */

import matter from 'gray-matter';
import YAML from 'yaml';
import type { Frontmatter, ParsedFrontmatter } from '../types/index.js';

/**
 * Parse YAML frontmatter from markdown content
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  try {
    // Passing an options object bypasses gray-matter's content-keyed cache. The cache stores
    // the entry before parsing, so a second parse of the same invalid content would silently
    // succeed with empty data instead of throwing (and the cache would grow without bound).
    const parsed = matter(content, {});

    // Check if there's actually frontmatter (gray-matter always returns data object)
    const hasFrontmatter = content.trim().startsWith('---');

    if (!hasFrontmatter || Object.keys(parsed.data).length === 0) {
      return { frontmatter: null, body: content, raw: null };
    }

    return {
      frontmatter: parsed.data as Frontmatter,
      body: parsed.content,
      raw: parsed.matter, // The raw YAML string between ---
    };
  } catch (err) {
    // If gray-matter fails, return content as body with no frontmatter. A note that opens
    // with a --- block but is not valid YAML (typically an unquoted "key: value: more")
    // reports why, so callers can warn instead of silently losing the metadata.
    const attempted = content.trimStart().startsWith('---');
    const message = err instanceof Error ? err.message.split('\n')[0].trim() : String(err);
    return attempted
      ? { frontmatter: null, body: content, raw: null, error: message }
      : { frontmatter: null, body: content, raw: null };
  }
}

/**
 * Serialize frontmatter object back to YAML string
 */
export function serializeFrontmatter(frontmatter: Frontmatter): string {
  // Use gray-matter's stringify but extract just the YAML portion
  const result = matter.stringify('', frontmatter);
  // Result is: ---\n{yaml}\n---\n
  // Extract just the YAML content
  const match = result.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (match) {
    return match[1];
  }

  // Fallback: manual serialization for edge cases
  const lines: string[] = [];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) {
          lines.push(`  - ${item}`);
        }
      }
    } else if (value === null || value === undefined) {
      lines.push(`${key}:`);
    } else if (typeof value === 'object') {
      // Nested objects - simple one-level handling
      lines.push(`${key}:`);
      for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
        lines.push(`  ${subKey}: ${subValue}`);
      }
    } else {
      const strValue = String(value);
      if (
        strValue.includes(':') ||
        strValue.includes('#') ||
        strValue.includes("'") ||
        strValue.includes('"') ||
        strValue.includes('\n')
      ) {
        lines.push(`${key}: "${strValue.replace(/"/g, '\\"')}"`);
      } else {
        lines.push(`${key}: ${strValue}`);
      }
    }
  }
  return lines.join('\n');
}

/**
 * Reconstruct full file content from frontmatter and body
 */
export function reconstructContent(frontmatter: Frontmatter | null, body: string): string {
  if (!frontmatter || Object.keys(frontmatter).length === 0) {
    return body;
  }
  const yaml = serializeFrontmatter(frontmatter);
  return `---\n${yaml}\n---\n${body}`;
}

// ---------------------------------------------------------------------------
// In-place frontmatter editing
// ---------------------------------------------------------------------------
//
// Writers must not parse the frontmatter to an object and dump it again: a dump
// normalises everything (a date-looking `title: 2026-10-14` becomes a timestamp,
// `created` loses its timezone offset, flow lists become block lists, comments and
// empty lists vanish). Instead the YAML is edited as a document, so every field that
// is not touched keeps its exact text.

/** Strings that a YAML 1.1 reader (Obsidian, gray-matter) would not read back as a string. */
function needsQuotes(value: string): boolean {
  return (
    /^\d{4}-\d{1,2}-\d{1,2}$/.test(value) || // date-only: read back as a Date
    /^(true|false|yes|no|on|off|y|n|null|~)$/i.test(value) ||
    /^[-+]?(\d[\d_]*\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(value) || // numbers
    /^0[xob][0-9a-f_]+$/i.test(value)
  );
}

export function toYamlNode(doc: YAML.Document, value: unknown): unknown {
  if (typeof value === 'string' && needsQuotes(value)) {
    const scalar = new YAML.Scalar(value);
    scalar.type = YAML.Scalar.QUOTE_DOUBLE;
    return scalar;
  }
  if (Array.isArray(value)) {
    const seq = doc.createNode(
      value.map(v => (typeof v === 'string' && needsQuotes(v) ? toYamlNode(doc, v) : v))
    ) as YAML.YAMLSeq;
    if (value.every(v => v === null || typeof v !== 'object')) seq.flow = true; // vault style: tags: [a, b]
    return seq;
  }
  return doc.createNode(value);
}

/** Set (or, for null/undefined, delete) one top-level field, keeping everything else as it was. */
export function setFrontmatterField(doc: YAML.Document, key: string, value: unknown): void {
  if (value === null || value === undefined) {
    doc.delete(key);
    return;
  }
  const existing = doc.get(key, true);
  const node = toYamlNode(doc, value);
  // Keep an existing list's style (flow or block) when a list is replaced by a list.
  if (YAML.isSeq(existing) && YAML.isSeq(node)) node.flow = existing.flow;
  doc.set(key, node);
}

export interface EditedFrontmatter {
  content: string;
  frontmatter: Frontmatter;
}

/**
 * Edit a note's frontmatter in place. `edit` receives the YAML document; return the new file
 * content and the resulting frontmatter object. Returns null when the note has no
 * frontmatter and `createIfMissing` is false. Throws (without changing anything) when the
 * existing frontmatter is not valid YAML, rather than clobbering it.
 */
export function editFrontmatter(
  content: string,
  edit: (doc: YAML.Document) => void,
  options: { createIfMissing?: boolean } = {}
): EditedFrontmatter | null {
  const { createIfMissing = true } = options;
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const match = content.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?=\r?\n|$)/);

  let doc: YAML.Document;
  let before = '';
  let after: string;
  if (match) {
    doc = YAML.parseDocument(match[1]);
    if (doc.errors.length) {
      throw new Error(
        `Frontmatter is not valid YAML, so it was not changed: ${doc.errors[0].message.split('\n')[0]}`
      );
    }
    if (!YAML.isMap(doc.contents)) doc.contents = doc.createNode({}) as YAML.YAMLMap;
    before = content.startsWith('\uFEFF') ? '\uFEFF' : '';
    after = content.slice(match[0].length);
  } else {
    if (!createIfMissing) return null;
    doc = new YAML.Document({});
    after = content === '' ? '' : `${eol}${content}`.replace(/^\r?\n/, eol);
  }

  edit(doc);

  const yaml = doc.toString({ lineWidth: 0, flowCollectionPadding: false }).replace(/\r?\n$/, '');
  const frontmatter = (doc.toJS() ?? {}) as Frontmatter;
  const body = match ? after : after.replace(/^\r?\n/, '');
  const out = `${before}---${eol}${yaml.replace(/\r?\n/g, eol)}${eol}---${match ? body : `${eol}${body}`}`;
  return { content: out, frontmatter };
}
