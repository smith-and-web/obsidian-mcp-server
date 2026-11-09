import fs from 'fs/promises';
import { BUILTIN_PATTERNS } from '../learn/redact.js';
import type { DocInfo } from './applyStore.js';

/**
 * Notes auto-apply never edits, whatever the class's record. Pattern source: the learn log's
 * redaction file (MAINTAIN_GUARD_PATTERNS_FILE, default LEARN_REDACT_PATTERNS_FILE). It already
 * holds brain-lint's plooto-infra patterns and Josh's private terms, and lives outside every
 * repo; the server's built-in secret patterns and the FamilyLaw word are added here.
 */
export const GUARD_BUILTINS: RegExp[] = [...BUILTIN_PATTERNS, /family\s*law/i];

export async function loadGuardPatterns(
  file: string
): Promise<{ patterns: RegExp[] } | { error: string }> {
  if (!file) return { error: 'no guard patterns file (MAINTAIN_GUARD_PATTERNS_FILE)' };
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    return { error: `cannot read guard patterns file: ${(err as Error).message}` };
  }
  const patterns = [...GUARD_BUILTINS];
  for (const [i, raw] of text.split('\n').entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    try {
      patterns.push(new RegExp(line, 'i'));
    } catch {
      return { error: `invalid guard pattern on line ${i + 1}` };
    }
  }
  return { patterns };
}

export type EditKind = 'body' | 'frontmatter';

/** Static guards: where the note lives, what it is, what it says. Null means allowed. */
export function staticGuard(
  doc: DocInfo | undefined,
  content: string,
  kind: EditKind,
  excludeTags: string[],
  patterns: RegExp[]
): string | null {
  if (!doc) return 'not-indexed';
  const p = doc.path;
  if (p.startsWith('Journal/') || doc.type === 'journal') return 'journal';
  if (p.startsWith('Meetings/') || doc.type === 'meeting') return 'meeting';
  if (/^(Inbox|Clippings)\//.test(p) || ['inbox', 'clipping'].includes(doc.type)) return 'unfiled';
  if (kind === 'body' && (p.startsWith('Decisions/') || doc.type === 'decision'))
    return 'decision-body';
  if ((doc.tags || []).some(t => excludeTags.includes(t))) return 'excluded-tag';
  if (doc.frontmatterError) return 'invalid-frontmatter';
  if (
    patterns.some(re => {
      re.lastIndex = 0;
      return re.test(content);
    })
  )
    return 'sensitive';
  return null;
}
