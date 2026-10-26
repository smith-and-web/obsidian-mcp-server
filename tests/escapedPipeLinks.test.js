import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { extractWikilinks, stripTableEscape } from '../src/index/chunker.js';
import { SearchService } from '../src/index/SearchService.js';
import { scanOnce } from '../src/index/scanner.js';
import { VaultManager } from '../src/vault/VaultManager.js';

// Regressions for 1.11.2: a table-escaped alias (`[[A\|b]]`) left `A\` as the link target, which
// reached a LIKE pattern and failed the whole note ("LIKE pattern must not end with escape character").
const TABLE_ROW = '| `brain-conventions` | Shared rules: [[Vault configuration\\|frontmatter contract]], quoting. |';

describe('escaped-pipe wikilinks', () => {
  it('drops the table-escape backslash from the target', () => {
    expect(extractWikilinks(TABLE_ROW)).toEqual(['Vault configuration']);
  });
  it('still parses a plain alias, a heading link and a bare link', () => {
    expect(extractWikilinks('[[A|b]] [[C#Heading|d]] [[E]]')).toEqual(['A', 'C', 'E']);
  });
  it('strips only trailing backslashes', () => {
    expect(stripTableEscape('Vault configuration\\')).toBe('Vault configuration');
    expect(stripTableEscape('a\\b')).toBe('a\\b');
  });
});

describe('vault link tools with escaped-pipe wikilinks', () => {
  let root;
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'pipe-vault-'));
    await fs.writeFile(path.join(root, 'Vault configuration.md'), '# Vault configuration\n');
    await fs.writeFile(path.join(root, 'Brain skills.md'), `# Brain skills\n\n${TABLE_ROW}\n`);
  });
  afterAll(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });
  it('does not report the link as broken, and finds it as a backlink', async () => {
    const vm = new VaultManager(root);
    const broken = await vm.findBrokenLinks();
    expect(JSON.stringify(broken)).not.toContain('Vault configuration');
    const backlinks = await vm.getBacklinks('Vault configuration.md');
    expect(JSON.stringify(backlinks)).toContain('Brain skills');
  });
});

const DB = process.env.TEST_DATABASE_URL;
const run = DB ? describe : describe.skip;
run('link resolution never treats link text as a LIKE pattern', () => {
  let root, service;
  const collection = `test-pipe-${process.pid}-${Date.now()}`;
  const write = async (rel, content) => {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), content);
  };
  const note = (title, body = '') =>
    `---\ntitle: "${title}"\ntype: reference\nsummary: "s"\nindex: true\naliases: []\n---\n# ${title}\n\n${body}\n`;
  const target = async (srcPath, linkTarget) => {
    const r = await service.store.pool.query(
      `SELECT t.path FROM links l JOIN documents s ON s.id = l.src_document_id
       LEFT JOIN documents t ON t.id = l.target_document_id
       WHERE s.collection = $1 AND s.path = $2 AND l.target_path = $3`,
      [collection, srcPath, linkTarget]
    );
    expect(r.rows).toHaveLength(1);
    return r.rows[0].path;
  };
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'pipe-db-vault-'));
    await write('Reference/Vault configuration.md', note('Vault configuration'));
    await write('Reference/Brain skills.md', note('Brain skills', TABLE_ROW));
    await write('notes/a_c.md', note('a_c'));
    await write('notes/abc.md', note('abc'));
    await write('notes/100% done.md', note('100% done'));
    await write('notes/Linker.md', note('Linker', '[[a_c]] and [[100% done]].'));
    service = await SearchService.create(
      {
        databaseUrl: DB,
        collection,
        embedder: { provider: 'fake', dim: 64, model: 'fake' },
        intervalSeconds: 60,
      },
      root
    );
  });
  afterAll(async () => {
    if (service) {
      await service.store.truncateCollection();
      await service.close();
    }
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it('indexes a note with a table-escaped alias and resolves the link', async () => {
    const res = await scanOnce({ vaultPath: root, store: service.store, embedder: service.embedder });
    expect(res.errors).toBe(0);
    expect(await target('Reference/Brain skills.md', 'Vault configuration')).toBe(
      'Reference/Vault configuration.md'
    );
  });
  it('matches _ and % literally when resolving a basename', async () => {
    // With LIKE, `a_c` also matched `abc`, so the basename looked ambiguous and stayed unresolved.
    expect(await target('notes/Linker.md', 'a_c')).toBe('notes/a_c.md');
    expect(await target('notes/Linker.md', '100% done')).toBe('notes/100% done.md');
    expect((await service.store.hygieneMetrics()).unresolvedLinks).toBe(0);
  });
});
