import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executeToolCall } from '../src/tools/handlers.js';
import { VaultManager } from '../src/vault/VaultManager.js';

describe('Markdown section tools', () => {
  let root;
  let call;
  const write = (name, body) => fs.writeFile(path.join(root, name), body);
  const read = name => fs.readFile(path.join(root, name), 'utf8');

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-section-tools-'));
    const vault = new VaultManager(root);
    call = (tool, args) => executeToolCall(tool, args, vault);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('creates a note and adds one line to three lists with no repair edits', async () => {
    const linkedNote = '# Plan - Example\n\nA new plan.\n';
    const initialNotes = [
      ['Plans.md', '## Draft', '- Existing plan', '\n\n## Active\n- Another plan\n'],
      ['First hub.md', '## Open items', '- Existing item', '\n\n## History\nPast work.\n'],
      ['Second hub.md', '## Open items', '- Existing item\n  - Nested item', '\n'],
    ];
    await Promise.all(
      initialNotes.map(([name, heading, body, after]) => write(name, `${heading}\n${body}${after}`))
    );
    expect(
      await call('create-note', { path: 'Plan - Example.md', content: linkedNote })
    ).toMatchObject({ created: true });

    await Promise.all(
      initialNotes.map(async ([name, heading, body, after]) => {
        expect(
          await call('append-to-section', {
            path: name,
            heading,
            content: '- [[Plan - Example]]',
          })
        ).toEqual({ path: name, heading, appended: true });
        expect(await read(name)).toBe(`${heading}\n${body}\n- [[Plan - Example]]${after}`);
      })
    );
    expect(await read('Plan - Example.md')).toBe(linkedNote);
  });

  it.each([
    ['empty section', '## Target\n\n## Next\n', '- Item', '## Target\n- Item\n\n## Next\n'],
    ['prose', '## Target\nOne.  \n## Next\n', 'Two.', '## Target\nOne.  \n\nTwo.\n\n## Next\n'],
    ['no final newline', '## Target\n1. One', '2. Two', '## Target\n1. One\n2. Two\n'],
    ['heading at EOF', '## Target', '- Item', '## Target\n- Item\n'],
    [
      'list item with an indented continuation',
      '## Target\n- One\n  continuation\n\n## Next\n',
      '- Two',
      '## Target\n- One\n  continuation\n- Two\n\n## Next\n',
    ],
    [
      'CRLF and nested bullets',
      '## Target\r\n\r\n- Outer\r\n  - First\r\n\r\n## Next\r\n',
      '  - Second\n  - Third\n',
      '## Target\r\n\r\n- Outer\r\n  - First\r\n  - Second\r\n  - Third\r\n\r\n## Next\r\n',
    ],
  ])('appends with correct spacing for %s', async (_label, initial, content, expected) => {
    await write('Section.md', initial);
    await call('append-to-section', { path: 'Section.md', heading: '## Target', content });
    expect(await read('Section.md')).toBe(expected);
  });

  it('replaces the full subtree and keeps the original heading and separator', async () => {
    await write(
      'Section.md',
      '## Target  \n\nIntro\n\n### Child\nOld body\n\n\n## Next\nNext body\n'
    );
    await call('replace-section', {
      path: 'Section.md',
      heading: '## Target',
      content: '- New body\n',
    });
    expect(await read('Section.md')).toBe('## Target  \n\n- New body\n\n\n## Next\nNext body\n');

    await call('replace-section', { path: 'Section.md', heading: '## Target', content: '' });
    expect(await read('Section.md')).toBe('## Target  \n\n\n## Next\nNext body\n');
  });

  it('reads a unique bare heading and stops at the next heading of equal or lesser depth', async () => {
    const body = 'Text\n\n### Child\nChild body\n\n````md\n```\n## Fake\n````';
    await write('Section.md', `# Parent\n\n## Status (draft)\n${body}\n\n# Next\nOutside\n`);
    expect(
      await call('read-section', { path: 'Section.md', heading: ' Status (draft) ' })
    ).toMatchObject({ content: body });
    expect(await call('list-headings', { path: 'Section.md', level: 2 })).toMatchObject({
      headings: [{ level: 2, text: 'Status (draft)', line: 3 }],
    });
  });

  it('reports ambiguous bare headings and still accepts a literal heading', async () => {
    await write(
      'Section.md',
      '## Open items\nFirst\n\n### Open items\nNested\n\n## Open items\nLast\n'
    );
    await expect(
      call('read-section', { path: 'Section.md', heading: 'Open items' })
    ).rejects.toThrow(/ambiguous.*"## Open items" \(line 1\).*"### Open items" \(line 4\)/);
    expect(
      await call('read-section', { path: 'Section.md', heading: '### Open items' })
    ).toMatchObject({ content: 'Nested' });
    expect(
      await call('read-section', { path: 'Section.md', heading: '## Open items' })
    ).toMatchObject({ content: 'First\n\n### Open items\nNested' });
  });
});
