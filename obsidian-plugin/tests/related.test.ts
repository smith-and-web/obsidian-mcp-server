import { describe, it, expect } from 'vitest';
import { addRelatedLink } from '../src/related';

describe('addRelatedLink', () => {
  it('appends a section with exactly one blank line', () => {
    expect(addRelatedLink('# A\nBody\n\n\n', 'B')).toBe('# A\nBody\n\n## Related\n- [[B]]\n');
    expect(addRelatedLink('# A\nBody', 'B')).toBe('# A\nBody\n\n## Related\n- [[B]]\n');
  });
  it('inserts in a middle section before trailing blanks and next level-two heading', () => {
    expect(addRelatedLink('# A\n\n## Related\n- [[B]]\n\n## Other\nText\n', 'C')).toBe(
      '# A\n\n## Related\n- [[B]]\n- [[C]]\n\n## Other\nText\n'
    );
  });
  it('stops at a level-one heading but keeps level-three subsections inside', () => {
    expect(addRelatedLink('## Related\n### More\n- [[B]]\n\n# Other\n', 'C')).toBe(
      '## Related\n### More\n- [[B]]\n- [[C]]\n\n# Other\n'
    );
  });
  it('inserts at section end before trailing blanks', () => {
    expect(addRelatedLink('## Related\n- [[B]]\n\n', 'C')).toBe('## Related\n- [[B]]\n- [[C]]\n\n');
    expect(addRelatedLink('## Related\n- [[B]]', 'C')).toBe('## Related\n- [[B]]\n- [[C]]');
  });
  it('does nothing for a link appearing anywhere', () => {
    const content = '---\nup: ["[[B]]"]\n---\n# A\n';
    expect(addRelatedLink(content, 'B')).toBe(content);
  });
  it('preserves CRLF when inserting or appending', () => {
    expect(addRelatedLink('# A\r\n\r\n## Related\r\n- [[B]]\r\n\r\n## Other\r\n', 'C')).toBe(
      '# A\r\n\r\n## Related\r\n- [[B]]\r\n- [[C]]\r\n\r\n## Other\r\n'
    );
    expect(addRelatedLink('# A\r\n', 'B')).toBe('# A\r\n\r\n## Related\r\n- [[B]]\r\n');
  });
  it('handles empty content and empty related sections', () => {
    expect(addRelatedLink('', 'B')).toBe('## Related\n- [[B]]\n');
    expect(addRelatedLink('## Related\n\n## Other\n', 'B')).toBe(
      '## Related\n- [[B]]\n\n## Other\n'
    );
  });
  it('removes whitespace-only trailing blank lines before a new section', () => {
    expect(addRelatedLink('Body\n \n\t\n', 'B')).toBe('Body\n\n## Related\n- [[B]]\n');
    expect(addRelatedLink('Body\r\n \r\n', 'B')).toBe('Body\r\n\r\n## Related\r\n- [[B]]\r\n');
  });
  it('ignores a Related heading inside fenced code', () => {
    const content = '# A\n\n```md\n## Related\n## Example\n```\n';
    expect(addRelatedLink(content, 'B')).toBe(content + '\n## Related\n- [[B]]\n');
  });
  it('ignores fenced section boundaries inside a real Related section', () => {
    const content =
      '## Related\n- [[A]]\n~~~~md\n## Example\n~~~\n# Still fenced\n~~~~\n\n## Next\n';
    expect(addRelatedLink(content, 'B')).toBe(
      '## Related\n- [[A]]\n~~~~md\n## Example\n~~~\n# Still fenced\n~~~~\n- [[B]]\n\n## Next\n'
    );
  });
  it('leaves frontmatter headings alone', () => {
    const content = '---\nsummary: |\n  ## Related\n---\nBody\n';
    expect(addRelatedLink(content, 'B')).toBe(content + '\n## Related\n- [[B]]\n');
  });
});
