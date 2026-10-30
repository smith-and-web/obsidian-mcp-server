/** Add one explicit link while preserving existing text and newline style. */
export function addRelatedLink(content: string, linktext: string): string {
  const link = `[[${linktext}]]`;
  if (content.includes(link)) return content;
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(newline);
  const start = lines.findIndex(line => /^## Related\s*$/.test(line));
  if (start < 0) {
    return `${content.replace(/(?:\r?\n)*$/, '')}${content ? newline + newline : ''}## Related${newline}- ${link}${newline}`;
  }
  let end = start + 1;
  while (end < lines.length && !/^#{1,2}(?:\s|$)/.test(lines[end])) end++;
  while (end > start + 1 && !lines[end - 1].trim()) end--;
  lines.splice(end, 0, `- ${link}`);
  return lines.join(newline);
}
