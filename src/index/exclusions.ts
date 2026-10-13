/**
 * Index exclusions
 *
 * Decides which vault entries the indexer never reads. Everything here is a
 * path or name check that runs before any file is opened, so excluded content
 * costs nothing and cannot leak into the index by accident.
 */

import fs from 'fs/promises';
import path from 'path';
import type { Frontmatter } from '../types/index.js';

/** Directory names skipped wherever they appear in the tree. */
export const EXCLUDED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
  '.obsidian', // editor config and plugin state
  '.trash', // Obsidian's in-vault trash
  '.git',
  '.smart-env', // Smart Connections cache, if it is ever installed
  '#recycle', // Synology share recycle bin
  '@eaDir', // Synology thumbnail/metadata sidecars
  '@tmp',
  'node_modules',
]);

/** File names skipped wherever they appear. */
export const EXCLUDED_FILE_NAMES: ReadonlySet<string> = new Set(['.DS_Store', 'Thumbs.db']);

/** A file placed in a directory to exclude that whole subtree. */
export const NOINDEX_MARKER = '.noindex';

/**
 * Should this directory entry be skipped entirely (not descended into)?
 */
export function isExcludedDirectoryName(name: string): boolean {
  return EXCLUDED_DIRECTORY_NAMES.has(name) || name.startsWith('.');
}

/**
 * Should this file be skipped? Only `.md` files are indexable; AppleDouble
 * sidecars (`._foo`), dotfiles and OS litter are never read.
 */
export function isExcludedFileName(name: string): boolean {
  if (EXCLUDED_FILE_NAMES.has(name)) return true;
  if (name.startsWith('._')) return true; // AppleDouble sidecar from NFSv3 or SMB without streams
  if (name.startsWith('.')) return true;
  return path.extname(name).toLowerCase() !== '.md';
}

/**
 * Does this directory contain a `.noindex` marker?
 */
export async function hasNoindexMarker(dirPath: string): Promise<boolean> {
  try {
    await fs.access(path.join(dirPath, NOINDEX_MARKER));
    return true;
  } catch {
    return false;
  }
}

/**
 * Does the note opt out of indexing through its frontmatter (`index: false`)?
 */
export function isExcludedByFrontmatter(frontmatter: Frontmatter | null): boolean {
  if (!frontmatter) return false;
  const value = frontmatter.index;
  return value === false || value === 'false';
}

/**
 * Should this vault-relative path be excluded by any of its path components?
 * Used to reject paths handed in by callers (e.g. `reindex-note`) without
 * walking the tree.
 */
export function isExcludedPath(relPath: string): boolean {
  const parts = relPath.split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0) return true;
  const file = parts[parts.length - 1];
  const dirs = parts.slice(0, -1);
  if (dirs.some(isExcludedDirectoryName)) return true;
  return isExcludedFileName(file);
}
