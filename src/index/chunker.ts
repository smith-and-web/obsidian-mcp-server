/**
 * Heading-aware chunker
 *
 * Splits a markdown note into chunks that follow its heading structure, so a
 * chunk never straddles two sections and every chunk carries the breadcrumb of
 * headings above it. Long sections are split further with overlap. Chunk 0 is
 * the note's title plus its frontmatter `summary`, which is the single most
 * useful thing to embed for "which note answers this" retrieval.
 *
 * Token counts are estimated at ~4 characters per token. That is close enough
 * for sizing chunks against an embedding model's context window; nothing here
 * depends on exact tokenisation.
 */

import { parseFrontmatter } from '../vault/frontmatter.js';
import type { Frontmatter } from '../types/index.js';

export interface Chunk {
  ord: number;
  headingPath: string;
  content: string;
  tokens: number;
}

export interface ChunkerOptions {
  /** Target maximum tokens per chunk (default 800). */
  maxTokens?: number;
  /** Overlap in tokens when a long section is split (default 100). */
  overlapTokens?: number;
  /** Deepest heading level that starts a new chunk (default 3 = H1–H3). */
  maxHeadingLevel?: number;
}

export interface ChunkedNote {
  title: string;
  frontmatter: Frontmatter | null;
  chunks: Chunk[];
  /** Wikilink targets found in the body, without aliases or anchors. */
  links: string[];
}

const DEFAULTS: Required<ChunkerOptions> = {
  maxTokens: 800,
  overlapTokens: 100,
  maxHeadingLevel: 3,
};

/** Estimate tokens from text length. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Derive the note title: frontmatter `title`, else the first H1, else the
 * file name without extension.
 */
export function deriveTitle(
  frontmatter: Frontmatter | null,
  body: string,
  relPath: string
): string {
  const fmTitle = frontmatter?.title;
  if (typeof fmTitle === 'string' && fmTitle.trim()) return fmTitle.trim();
  const h1 = body.match(/^#\s+(.+?)\s*$/m);
  if (h1) return h1[1].trim();
  const base = relPath.split(/[\\/]/).pop() ?? relPath;
  return base.replace(/\.md$/i, '');
}

/**
 * Extract wikilink targets (`[[Target]]`, `[[Target|alias]]`, `[[Target#heading]]`).
 * Embeds (`![[...]]`) are included; the caller can filter by extension if needed.
 */
export function extractWikilinks(body: string): string[] {
  const out = new Set<string>();
  const re = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const target = m[1].trim();
    if (target) out.add(target);
  }
  return Array.from(out);
}

interface Section {
  headingPath: string[];
  lines: string[];
}

/**
 * Walk the body line by line, opening a new section at every heading up to
 * maxHeadingLevel. Fenced code blocks are opaque: a `#` inside them is not a
 * heading.
 */
function splitIntoSections(body: string, maxHeadingLevel: number): Section[] {
  const sections: Section[] = [];
  let current: Section = { headingPath: [], lines: [] };
  const stack: string[] = [];
  let inFence = false;
  let fenceMarker = '';

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine;
    const fence = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[1][0];
      } else if (fence[1][0] === fenceMarker) {
        inFence = false;
      }
      current.lines.push(line);
      continue;
    }
    if (inFence) {
      current.lines.push(line);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading && heading[1].length <= maxHeadingLevel) {
      const level = heading[1].length;
      if (current.lines.some(l => l.trim() !== '') || sections.length === 0) {
        sections.push(current);
      }
      stack.length = Math.max(0, level - 1);
      stack[level - 1] = heading[2].trim();
      // Fill any gap (e.g. H1 then H3) so the breadcrumb has no holes.
      const headingPath = stack.filter((s): s is string => typeof s === 'string');
      current = { headingPath, lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  if (current.lines.some(l => l.trim() !== '')) sections.push(current);
  return sections;
}

/**
 * Split a long section's text into windows of at most maxTokens with overlap,
 * preferring paragraph boundaries.
 */
function splitLongText(text: string, maxTokens: number, overlapTokens: number): string[] {
  if (estimateTokens(text) <= maxTokens) return [text];
  const maxChars = maxTokens * 4;
  const overlapChars = overlapTokens * 4;
  const paragraphs = text.split(/\n{2,}/);
  const windows: string[] = [];
  let buf = '';

  const flush = () => {
    if (buf.trim()) windows.push(buf.trim());
  };

  for (const para of paragraphs) {
    const candidate = buf ? `${buf}\n\n${para}` : para;
    if (candidate.length <= maxChars) {
      buf = candidate;
      continue;
    }
    if (buf) {
      flush();
      // Carry the tail of the previous window forward as overlap.
      buf = buf.slice(Math.max(0, buf.length - overlapChars));
    }
    if (para.length > maxChars) {
      // A single paragraph larger than the window: hard-split on characters.
      let start = 0;
      while (start < para.length) {
        const piece = para.slice(start, start + maxChars);
        windows.push(piece.trim());
        start += maxChars - overlapChars;
      }
      buf = '';
    } else {
      buf = buf ? `${buf}\n\n${para}` : para;
    }
  }
  flush();
  return windows.filter(w => w.length > 0);
}

/**
 * Chunk a markdown note.
 */
export function chunkNote(
  content: string,
  relPath: string,
  options: ChunkerOptions = {}
): ChunkedNote {
  const opts = { ...DEFAULTS, ...options };
  const { frontmatter, body } = parseFrontmatter(content);
  const title = deriveTitle(frontmatter, body, relPath);
  const links = extractWikilinks(body);
  const chunks: Chunk[] = [];

  // Chunk 0: title + summary (+ tags, as plain words). Always present.
  const summary = typeof frontmatter?.summary === 'string' ? frontmatter.summary.trim() : '';
  const tags = Array.isArray(frontmatter?.tags)
    ? (frontmatter!.tags as unknown[]).filter((t): t is string => typeof t === 'string')
    : [];
  const headParts = [title];
  if (summary) headParts.push(summary);
  if (tags.length) headParts.push(`Tags: ${tags.join(', ')}`);
  const head = headParts.join('\n');
  chunks.push({ ord: 0, headingPath: '', content: head, tokens: estimateTokens(head) });

  for (const section of splitIntoSections(body, opts.maxHeadingLevel)) {
    const text = section.lines.join('\n').trim();
    if (!text) continue;
    const breadcrumb = [title, ...section.headingPath].join(' › ');
    for (const window of splitLongText(text, opts.maxTokens, opts.overlapTokens)) {
      const withCrumb = `${breadcrumb}\n\n${window}`;
      chunks.push({
        ord: chunks.length,
        headingPath: section.headingPath.join(' › '),
        content: withCrumb,
        tokens: estimateTokens(withCrumb),
      });
    }
  }

  return { title, frontmatter, chunks, links };
}
