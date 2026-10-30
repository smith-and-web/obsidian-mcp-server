/**
 * Vault scanner
 *
 * Walks the vault, applies the exclusion rules, and compares what it finds
 * against the store. inotify does not propagate over NFS, so this is a poll:
 * cheap on the common path (stat only; nothing is read unless mtime or size
 * moved, or the note was last checked within seconds of its last write) and
 * exact on the rare path (sha256 before re-embedding).
 */

import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { parseFrontmatter, editFrontmatter, setFrontmatterField } from '../vault/frontmatter.js';
import { chunkNote } from './chunker.js';
import {
  hasNoindexMarker,
  isExcludedDirectoryName,
  isExcludedFileName,
  isExcludedByFrontmatter,
} from './exclusions.js';
import type { Embedder } from './embedder.js';
import type { IndexStore } from './store.js';

/** A hash checked less than this long after the file's mtime is re-checked next pass. */
const SETTLE_MS = 5000;

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
  frontmatterLinkKeys: string[];
  volatileKeys: string[];
  store: IndexStore;
  embedder: Embedder;
  log?: (msg: string) => void;
  /** Always-on channel for problems worth seeing without --verbose (e.g. invalid frontmatter). */
  warn?: (msg: string) => void;
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

export function contentHash(content: string, volatileKeys: string[]): string {
  if (!volatileKeys?.length) return sha256(content);
  const parsed = parseFrontmatter(content);
  if (
    parsed.error ||
    !parsed.frontmatter ||
    !volatileKeys.some(k => Object.hasOwn(parsed.frontmatter!, k))
  )
    return sha256(content);
  try {
    const r = editFrontmatter(
      content,
      doc => volatileKeys.forEach(k => setFrontmatterField(doc, k, null)),
      { createIfMissing: false }
    );
    return sha256(r ? r.content : content);
  } catch {
    return sha256(content);
  }
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
  const note = chunkNote(content, file.relPath, { frontmatterLinkKeys: opts.frontmatterLinkKeys });
  if (isExcludedByFrontmatter(note.frontmatter)) {
    await opts.store.deleteDocument(file.relPath);
    return false;
  }
  if (note.frontmatterError) {
    opts.warn?.(
      `WARN invalid frontmatter in ${file.relPath}: ${note.frontmatterError} ` +
        `(indexed without it; quote values that contain ": ")`
    );
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
    contentSha256: contentHash(content, opts.volatileKeys),
    mtime: file.mtime,
    size: file.size,
    chunks: note.chunks,
    embeddings,
    links: note.links,
    frontmatterError: note.frontmatterError ?? null,
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
    // Trust the stat only once the stored hash was checked comfortably after the
    // last write. A read that lands while a write is still finishing (common on
    // NFS) can store a stale hash with the final size and mtime; such a note is
    // re-read on the next pass, and re-hashing is cheap.
    const statUnchanged =
      prev &&
      prev.size === file.size &&
      prev.mtime.getTime() === file.mtime.getTime() &&
      prev.indexedAt.getTime() - file.mtime.getTime() >= SETTLE_MS;
    if (statUnchanged) continue;

    try {
      const content = await fs.readFile(file.absPath, 'utf-8');
      if (prev && prev.contentSha256 === contentHash(content, opts.volatileKeys)) {
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
