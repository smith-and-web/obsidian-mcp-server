/**
 * Vault scanner
 *
 * Walks the vault, applies the exclusion rules, and compares what it finds
 * against the store. inotify does not propagate over NFS, so this is a poll:
 * cheap on the common path (stat only; nothing is read unless mtime or size
 * moved) and exact on the rare path (sha256 before re-embedding).
 */

import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { chunkNote } from './chunker.js';
import {
  hasNoindexMarker,
  isExcludedDirectoryName,
  isExcludedFileName,
  isExcludedByFrontmatter,
} from './exclusions.js';
import type { Embedder } from './embedder.js';
import type { IndexStore } from './store.js';

export interface ScanStats {
  seen: number;
  changed: number;
  removed: number;
  errors: number;
  errorText?: string;
}

export interface VaultFile {
  relPath: string;
  absPath: string;
  mtime: Date;
  size: number;
}

export interface ScannerOptions {
  vaultPath: string;
  store: IndexStore;
  embedder: Embedder;
  log?: (msg: string) => void;
}

/**
 * List every indexable markdown file under the vault.
 */
export async function walkVault(vaultPath: string): Promise<VaultFile[]> {
  const root = path.resolve(vaultPath);
  const out: VaultFile[] = [];

  async function walk(dir: string): Promise<void> {
    if (await hasNoindexMarker(dir)) return;
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (isExcludedDirectoryName(entry.name)) continue;
        await walk(abs);
      } else if (entry.isFile()) {
        if (isExcludedFileName(entry.name)) continue;
        try {
          const st = await fs.stat(abs);
          out.push({
            relPath: path.relative(root, abs).split(path.sep).join('/'),
            absPath: abs,
            mtime: st.mtime,
            size: st.size,
          });
        } catch {
          // Vanished between readdir and stat; the next run will see the truth.
        }
      }
    }
  }

  await walk(root);
  return out;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Index one file: read, chunk, embed, store. Returns false if the note opted
 * out via frontmatter (and removes any stale rows for it).
 */
export async function indexFile(
  file: VaultFile,
  content: string,
  opts: ScannerOptions
): Promise<boolean> {
  const note = chunkNote(content, file.relPath);
  if (isExcludedByFrontmatter(note.frontmatter)) {
    await opts.store.deleteDocument(file.relPath);
    return false;
  }
  const embeddings = await opts.embedder.embed(note.chunks.map(c => c.content));
  const tags = Array.isArray(note.frontmatter?.tags)
    ? (note.frontmatter!.tags as unknown[])
        .filter((t): t is string => typeof t === 'string')
        .map(t => t.replace(/^#/, ''))
    : [];
  await opts.store.upsertDocument({
    path: file.relPath,
    title: note.title,
    frontmatter: note.frontmatter,
    tags,
    contentSha256: sha256(content),
    mtime: file.mtime,
    size: file.size,
    chunks: note.chunks,
    embeddings,
    links: note.links,
  });
  return true;
}

/**
 * One full reconcile pass: index what changed, remove what disappeared.
 */
export async function scanOnce(opts: ScannerOptions): Promise<ScanStats> {
  const log = opts.log ?? (() => {});
  const stats: ScanStats = { seen: 0, changed: 0, removed: 0, errors: 0 };
  const files = await walkVault(opts.vaultPath);
  const known = await opts.store.listDocuments();
  const seenPaths = new Set<string>();
  const errorMessages: string[] = [];

  for (const file of files) {
    stats.seen++;
    seenPaths.add(file.relPath);
    const prev = known.get(file.relPath);
    const statUnchanged =
      prev &&
      prev.size === file.size &&
      Math.abs(prev.mtime.getTime() - file.mtime.getTime()) < 1000;
    if (statUnchanged) continue;

    try {
      const content = await fs.readFile(file.absPath, 'utf-8');
      if (prev && prev.contentSha256 === sha256(content)) {
        // Touched but not changed (e.g. Linter re-saved identical bytes): refresh stat only.
        await opts.store.upsertDocumentStat(file.relPath, file.mtime, file.size);
        continue;
      }
      const indexed = await indexFile(file, content, opts);
      if (indexed) {
        stats.changed++;
        log(`indexed ${file.relPath}`);
      } else {
        log(`skipped (index: false) ${file.relPath}`);
      }
    } catch (err) {
      stats.errors++;
      const msg = `${file.relPath}: ${(err as Error).message}`;
      errorMessages.push(msg);
      log(`error ${msg}`);
    }
  }

  for (const [docPath] of known) {
    if (!seenPaths.has(docPath)) {
      try {
        await opts.store.deleteDocument(docPath);
        stats.removed++;
        log(`removed ${docPath}`);
      } catch (err) {
        stats.errors++;
        errorMessages.push(`${docPath}: ${(err as Error).message}`);
      }
    }
  }

  if (errorMessages.length) stats.errorText = errorMessages.slice(0, 20).join('\n');
  return stats;
}
