/**
 * Response budgets for read-note and search-vault.
 *
 * A tool result stays in an agent's context and is re-sent with every later model
 * request, so a large read costs its size many times over. Both budgets are off by
 * default (0) and enabled per deployment:
 *   READ_OUTLINE_TOKENS          read-note returns an outline above this size unless full: true
 *   SEARCH_VAULT_BUDGET_TOKENS   search-vault output is trimmed to about this size
 * Tokens are estimated as characters / 4.
 */
import type { SearchFileResult, SearchMatch, SearchResult } from '../types/index.js';
import { markdownHeadings } from './sections.js';

export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

/** Read a non-negative integer budget from the environment; anything else is 0 (off). */
export function readBudget(env: NodeJS.ProcessEnv, name: string): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    console.error(`${name}=${raw} is not a non-negative integer; budget off`);
    return 0;
  }
  return n;
}

export interface OutlineSection {
  /** The heading line exactly as read-section expects it, e.g. "## Status". */
  heading: string;
  line: number;
  /** Tokens read-section would return for this heading (its text and subsections). */
  tokens: number;
}

/** Headings of a note with the size of each heading's subtree. Fenced code is skipped. */
export function outlineOf(content: string): OutlineSection[] {
  const heads = markdownHeadings(content);
  return heads.map((h, i) => {
    const next = heads.slice(i + 1).find(n => n.level <= h.level);
    const end = next ? next.offset : content.length;
    return { heading: h.heading, line: h.line, tokens: Math.ceil((end - h.offset) / 4) };
  });
}

const LINE_CHARS = 300;
const MATCHES_PER_FILE = 5;

function clip(text: string): string {
  return text.length > LINE_CHARS ? `${text.slice(0, LINE_CHARS)}…` : text;
}

function clipMatch(m: SearchMatch): SearchMatch {
  const out: SearchMatch = { line: m.line, content: clip(m.content) };
  if (m.context) {
    out.context = {
      before: m.context.before.map(c => ({ line: c.line, content: clip(c.content) })),
      after: m.context.after.map(c => ({ line: c.line, content: clip(c.content) })),
    };
  }
  return out;
}

export interface BudgetedSearchResult extends SearchResult {
  truncated?: boolean;
  omittedFiles?: number;
  hint?: string;
}

/**
 * Trim a search-vault result to about `budget` tokens: long lines are clipped, each file
 * keeps its first few matches (the rest are counted), and files stop once the budget is
 * spent. totalMatches and filesMatched still describe the whole scan.
 */
export function applySearchBudget(result: SearchResult, budget: number): BudgetedSearchResult {
  if (budget <= 0) return result;
  const kept: SearchFileResult[] = [];
  let used = estimateTokens(JSON.stringify({ ...result, results: [] }));
  let clipped = false;
  for (const file of result.results) {
    const matches = file.matches.slice(0, MATCHES_PER_FILE).map(clipMatch);
    const entry: SearchFileResult & { moreMatches?: number } = { ...file, matches };
    if (file.matches.length > MATCHES_PER_FILE)
      entry.moreMatches = file.matches.length - MATCHES_PER_FILE;
    if (
      entry.moreMatches ||
      matches.some((m, i) => JSON.stringify(m) !== JSON.stringify(file.matches[i]))
    )
      clipped = true;
    const cost = estimateTokens(JSON.stringify(entry));
    if (kept.length > 0 && used + cost > budget) break;
    kept.push(entry);
    used += cost;
  }
  const omitted = result.results.length - kept.length;
  if (!omitted && !clipped) return result;
  return {
    ...result,
    results: kept,
    truncated: true,
    ...(omitted ? { omittedFiles: omitted } : {}),
    hint:
      `Output trimmed to about ${budget} tokens (long lines clipped, ${MATCHES_PER_FILE} matches per file` +
      `${omitted ? `, ${omitted} more files omitted` : ''}). Narrow with directory or a more specific query, ` +
      'or read-section the part of a note you need.',
  };
}
