interface MarkdownHeading {
  heading: string;
  text: string;
  level: number;
  line: number;
  offset: number;
  end: number;
}

export function markdownHeadings(content: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  let offset = 0;
  let fence: string | undefined;
  const lines = content.split('\n');
  const frontmatterEnd = /^---\r?$/.test(lines[0])
    ? lines.findIndex((line, index) => index > 0 && /^---\r?$/.test(line))
    : -1;

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.replace(/\r$/, '');
    const start = offset;
    offset += rawLine.length + 1;
    if (index <= frontmatterEnd) continue;

    if (fence) {
      const close = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/)?.[1];
      if (close?.startsWith(fence)) fence = undefined;
      continue;
    }

    const opening = line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1];
    if (opening) {
      fence = opening;
      continue;
    }

    const match = line.match(/^(#{1,6})[ \t]+(\S.*)$/);
    if (match) {
      headings.push({
        heading: line.trimEnd(),
        text: match[2].trimEnd(),
        level: match[1].length,
        line: index + 1,
        offset: start,
        end: start + line.length,
      });
    }
  }
  return headings;
}

export function sectionRange(
  content: string,
  heading: string,
  notePath: string,
  allowBareHeading = false
): { start: number; end: number } {
  const headings = markdownHeadings(content);
  const requested = heading.trimEnd();
  let index = headings.findIndex(candidate => candidate.heading === requested);

  if (index < 0 && allowBareHeading && !/^#{1,6}(?:[ \t]|$)/.test(heading.trim())) {
    const matches = headings.filter(candidate => candidate.text === heading.trim());
    if (matches.length > 1) {
      const choices = matches.map(match => `"${match.heading}" (line ${match.line})`).join(', ');
      throw new Error(`Heading "${heading}" is ambiguous in ${notePath}: ${choices}`);
    }
    if (matches.length === 1) index = headings.indexOf(matches[0]);
  }

  if (index < 0) throw new Error(`Heading "${heading}" not found in ${notePath}`);

  const current = headings[index];
  const next = headings.slice(index + 1).find(candidate => candidate.level <= current.level);
  return { start: current.end, end: next?.offset ?? content.length };
}

const leadingBlankLines = /^(?:[ \t]*\r?\n)+/;
const trailingBlankLines = /(?:\r?\n[ \t]*)+$/;
const listItem = /^[ \t]*(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/;

function endsWithListItem(body: string): boolean {
  const lines = body.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index--) {
    if (listItem.test(lines[index])) return true;
    if (!/^(?: {2}|\t)[ \t]*\S/.test(lines[index])) return false;
  }
  return false;
}

export function writeSection(
  document: string,
  range: { start: number; end: number },
  content: string,
  mode: 'append' | 'replace'
): string {
  const eol = document.match(/\r?\n/)?.[0] ?? '\n';
  const body = document.slice(range.start, range.end);
  const existing = body.replace(trailingBlankLines, '');
  const incoming = content
    .replace(leadingBlankLines, '')
    .replace(trailingBlankLines, '')
    .replace(/\r?\n/g, eol);
  if (mode === 'append' && !incoming.trim()) return document;

  const trailing = body.slice(existing.length);
  const hasNextHeading = range.end < document.length;
  const suffix =
    hasNextHeading && (trailing.match(/\n/g)?.length ?? 0) < 2 ? eol + eol : trailing || eol;

  let updatedBody = '';
  if (incoming.trim()) {
    if (mode === 'append' && existing) {
      // A new list item extends the existing list. Other content starts a new block.
      const separator = endsWithListItem(existing) && listItem.test(incoming) ? eol : eol + eol;
      updatedBody = existing + separator + incoming;
    } else {
      const leading = existing.match(leadingBlankLines)?.[0] ?? eol;
      updatedBody = leading + incoming;
    }
  }

  return document.slice(0, range.start) + updatedBody + suffix + document.slice(range.end);
}
