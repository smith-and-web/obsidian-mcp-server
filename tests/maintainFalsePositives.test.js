import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { SearchService } from '../src/index/SearchService.js';
import { scanOnce } from '../src/index/scanner.js';
import { vaultMentionVerifier } from '../src/maintain/mentions.js';

// Regressions for the false positives in the first weekly report (1.11.0).
const DB = process.env.TEST_DATABASE_URL;
const run = DB ? describe : describe.skip;
run('maintenance false positives', () => {
  let root, service;
  const collection = `test-maint-fp-${process.pid}-${Date.now()}`;
  const note = (title, type, body, summary = 'gadget widget sprocket notes') =>
    `---\ntitle: ${title}\ntype: ${type}\nsummary: "${summary}"\nupdated: 2026-10-01\nindex: true\naliases: []\n---\n# ${title}\n\n${body}\n`;
  const write = async (rel, content) => {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), content);
  };
  const has = (candidates, a, b) =>
    candidates.some(c => c.paths.includes(a) && c.paths.includes(b));
  const widgetBody = 'widget rollout steps widget rollout checks widget rollout order';
  const exportBody = 'gadget export source format gadget export target gadget export schedule';
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'maint-fp-vault-'));
    await write(
      'notes/Widget rollout.md',
      note('Widget rollout', 'project', `${widgetBody}\n\n[[Widget rollout runbook]]`)
    );
    await write(
      'notes/Widget rollout runbook.md',
      note('Widget rollout runbook', 'reference', widgetBody)
    );
    await write('notes/Gadget guide.md', note('Gadget guide', 'reference', exportBody));
    await write('notes/Gadget guides.md', note('Gadget guides', 'reference', exportBody));
    await write(
      'notes/Plan - gadget export to alpha.md',
      note('Plan - gadget export to alpha', 'plan', exportBody)
    );
    await write(
      'notes/Plan - gadget export to beta.md',
      note('Plan - gadget export to beta', 'plan', exportBody)
    );
    await write('notes/Sprocket.md', note('Sprocket', 'reference', 'A small toothed wheel.'));
    await write(
      'notes/Sprocket setup.md',
      note('Sprocket setup', 'reference', 'Install the tool and restart it.', 'Sprocket setup')
    );
    await write(
      'notes/Sprocket code.md',
      note(
        'Sprocket code',
        'reference',
        'Run `sprocket` here.\n\n```sh\nsprocket start\n```\n\nSee [the sprocket](https://example.com/sprocket).'
      )
    );
    await write(
      'notes/Sprocket user.md',
      note('Sprocket user', 'reference', 'The sprocket turns.')
    );
    await write('notes/lantern.md', note('lantern', 'project', 'A writing app.'));
    await write(
      'notes/Launch page.md',
      note('Launch page', 'reference', 'Deployed lantern-site yesterday.')
    );
    await write(
      'Journal/2026-01-05.md',
      note('2026-01-05', 'journal', `The sprocket turns. lantern shipped. ${widgetBody}`)
    );
    service = await SearchService.create(
      {
        databaseUrl: DB,
        collection,
        embedder: { provider: 'fake', dim: 64, model: 'fake' },
        intervalSeconds: 60,
      },
      root
    );
    expect(
      (await scanOnce({ vaultPath: root, store: service.store, embedder: service.embedder })).errors
    ).toBe(0);
  });
  afterAll(async () => {
    if (service) {
      await service.store.truncateCollection();
      await service.close();
    }
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it('does not propose a hub and a note it links to as duplicates', async () => {
    const duplicates = await service.store.findNearDuplicates(0.5, 0.6);
    expect(has(duplicates, 'notes/Gadget guide.md', 'notes/Gadget guides.md')).toBe(true);
    expect(has(duplicates, 'notes/Widget rollout.md', 'notes/Widget rollout runbook.md')).toBe(
      false
    );
  });
  it('does not propose two plans as duplicates', async () => {
    const duplicates = await service.store.findNearDuplicates(0.5, 0.6);
    expect(
      has(
        duplicates,
        'notes/Plan - gadget export to alpha.md',
        'notes/Plan - gadget export to beta.md'
      )
    ).toBe(false);
    expect(has(duplicates, 'notes/Gadget guide.md', 'notes/Plan - gadget export to alpha.md')).toBe(
      true
    );
  });
  it('does not propose a mention found only in the title, summary, code or a link', async () => {
    const mentions = await service.store.findUnlinkedMentions(vaultMentionVerifier(root));
    expect(mentions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          paths: ['notes/Sprocket user.md', 'notes/Sprocket.md'],
          detail: expect.objectContaining({ name: 'Sprocket' }),
        }),
      ])
    );
    expect(has(mentions, 'notes/Sprocket setup.md', 'notes/Sprocket.md')).toBe(false);
    expect(has(mentions, 'notes/Sprocket code.md', 'notes/Sprocket.md')).toBe(false);
  });
  it('does not match a name inside a hyphenated word', async () => {
    const mentions = await service.store.findUnlinkedMentions(vaultMentionVerifier(root));
    expect(has(mentions, 'notes/Launch page.md', 'notes/lantern.md')).toBe(false);
  });
  it('gives Journal notes no link findings', async () => {
    const mentions = await service.store.findUnlinkedMentions(vaultMentionVerifier(root));
    const related = await service.store.findMissingLinks(0.5);
    expect(has(related, 'notes/Widget rollout runbook.md', 'notes/Widget rollout.md')).toBe(false);
    expect(related.length).toBeGreaterThan(0);
    for (const c of [...mentions, ...related])
      expect(c.paths.some(p => p.startsWith('Journal/'))).toBe(false);
  });
});
