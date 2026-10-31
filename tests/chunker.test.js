import { describe, it, expect } from 'vitest';
import { chunkNote, extractWikilinks, deriveTitle, estimateTokens } from '../src/index/chunker.js';

const NOTE = `---
title: host-a NFS gate
type: area
tags: [infra, nas]
summary: Docker on host-a waits for /mnt/data via a RequiresMountsFor drop-in.
---
# host-a

Intro paragraph about the host. See [[notes/host-b|the other box]] and [[docs/backups#Schedule]].

## Storage

Two NFS mounts from the Synology.

\`\`\`bash
# not a heading
mount | grep dsm
\`\`\`

### Docker waits for the mount

RequiresMountsFor=/mnt/data in a drop-in.

## DNS

AdGuard first, router second.
`;

describe('chunkNote', () => {
  it('produces a head chunk with title, summary and tags', () => {
    const { chunks, title } = chunkNote(NOTE, 'notes/host-a.md');
    expect(title).toBe('host-a NFS gate');
    expect(chunks[0].ord).toBe(0);
    expect(chunks[0].headingPath).toBe('');
    expect(chunks[0].content).toContain('host-a NFS gate');
    expect(chunks[0].content).toContain('RequiresMountsFor drop-in');
    expect(chunks[0].content).toContain('Tags: infra, nas');
  });

  it('splits on headings up to H3 and carries the breadcrumb', () => {
    const { chunks } = chunkNote(NOTE, 'notes/host-a.md');
    const paths = chunks.map(c => c.headingPath);
    expect(paths).toEqual([
      '',
      'host-a',
      'host-a › Storage',
      'host-a › Storage › Docker waits for the mount',
      'host-a › DNS',
    ]);
    const docker = chunks[3];
    expect(docker.content.startsWith('host-a NFS gate › host-a › Storage › Docker waits')).toBe(
      true
    );
    expect(docker.content).toContain('RequiresMountsFor=/mnt/data');
  });

  it('does not treat # inside a code fence as a heading', () => {
    const { chunks } = chunkNote(NOTE, 'notes/host-a.md');
    const storage = chunks.find(c => c.headingPath === 'host-a › Storage');
    expect(storage.content).toContain('# not a heading');
    expect(chunks.some(c => c.headingPath.includes('not a heading'))).toBe(false);
  });

  it('numbers chunks consecutively', () => {
    const { chunks } = chunkNote(NOTE, 'notes/host-a.md');
    expect(chunks.map(c => c.ord)).toEqual([0, 1, 2, 3, 4]);
  });

  it('splits a long section into overlapping windows', () => {
    const para = 'lorem ipsum dolor sit amet '.repeat(40); // ~1080 chars ≈ 270 tokens
    const body = `# Big\n\n${Array.from({ length: 8 }, () => para).join('\n\n')}`;
    const { chunks } = chunkNote(body, 'big.md', { maxTokens: 300, overlapTokens: 50 });
    const bodyChunks = chunks.filter(c => c.ord > 0);
    expect(bodyChunks.length).toBeGreaterThan(3);
    for (const c of bodyChunks) {
      expect(c.tokens).toBeLessThanOrEqual(300 + 40); // breadcrumb adds a little
      expect(c.headingPath).toBe('Big');
    }
  });

  it('hard-splits a single oversized paragraph', () => {
    const body = `# Wall\n\n${'x'.repeat(10000)}`;
    const { chunks } = chunkNote(body, 'wall.md', { maxTokens: 500, overlapTokens: 50 });
    expect(chunks.length).toBeGreaterThan(4);
  });

  it('handles a note with no frontmatter and no headings', () => {
    const { chunks, title, frontmatter } = chunkNote('just a line of text', 'Inbox/scratch.md');
    expect(frontmatter).toBeNull();
    expect(title).toBe('scratch');
    expect(chunks.length).toBe(2);
    expect(chunks[1].content).toContain('just a line of text');
  });

  it('fills breadcrumb gaps when heading levels skip', () => {
    const { chunks } = chunkNote('# A\n\ntext\n\n### C\n\ndeep', 'skip.md');
    expect(chunks.map(c => c.headingPath)).toEqual(['', 'A', 'A › C']);
  });
});

describe('extractWikilinks', () => {
  it('strips aliases, anchors and dedupes', () => {
    const links = extractWikilinks(
      'see [[A]] and [[A|alias]] and [[B#heading]] and ![[img.png]] and [[C|x]] [[B]]'
    );
    expect(links).toEqual(['A', 'B', 'img.png', 'C']);
  });
});

describe('deriveTitle', () => {
  it('prefers frontmatter, then H1, then filename', () => {
    expect(deriveTitle({ title: 'FM' }, '# H1', 'x/y.md')).toBe('FM');
    expect(deriveTitle(null, 'intro\n# H1 Title\n', 'x/y.md')).toBe('H1 Title');
    expect(deriveTitle(null, 'no heading', 'x/My Note.md')).toBe('My Note');
  });
});

describe('estimateTokens', () => {
  it('estimates roughly four characters per token', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });
});
