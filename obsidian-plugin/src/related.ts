/** Find actual Markdown headings, excluding frontmatter and fenced examples. */
function headings(lines: string[]): Map<number, string> {
  const result = new Map<number, string>();
  let frontmatter = lines[0] === '---';
  let fence: { marker: string; length: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (frontmatter) {
      if (i > 0 && /^(---|\.\.\.)\s*$/.test(line)) frontmatter = false;
      continue;
    }
    if (fence) {
      const close = /^ {0,3}(`+|~+)[ \t]*$/.exec(line);
      if (close && close[1][0] === fence.marker && close[1].length >= fence.length) fence = null;
      continue;
    }
    const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (open && (open[1][0] !== '`' || !open[2].includes('`'))) {
      fence = { marker: open[1][0], length: open[1].length };
      continue;
    }
    if (/^ {0,3}#{1,2}(?:[ \t]|$)/.test(line)) result.set(i, line.trim());
  }
  return result;
}

/** Add one explicit link while preserving existing text and newline style. */
export function addRelatedLink(content: string, linktext: string): string {
  const link = `[[${linktext}]]`;
  if (content.includes(link)) return content;
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(newline);
  const sections = headings(lines);
  const start = [...sections].find(([, line]) =>
    /^##[ \t]+Related(?:[ \t]+#+)?[ \t]*$/.test(line)
  )?.[0];
  if (start === undefined) {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return `${lines.join(newline)}${lines.length ? newline + newline : ''}## Related${newline}- ${link}${newline}`;
  }
  let end = start + 1;
  while (end < lines.length && !sections.has(end)) end++;
  while (end > start + 1 && !lines[end - 1].trim()) end--;
  lines.splice(end, 0, `- ${link}`);
  return lines.join(newline);
}
