import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { confinedNotePath } from '../vault/confinedPath.js';

export const sha = (text: string) => createHash('sha256').update(text).digest('hex');

export type WriteResult = 'written' | 'raced' | 'missing';

/**
 * Replace a note's content only if it still equals `expected`: stage a temp file next to it,
 * re-check size and mtime, then rename. Mirrors atomicFrontmatterEdit for whole-note edits.
 */
export async function replaceIfUnchanged(
  vaultPath: string,
  rel: string,
  expected: string,
  next: string
): Promise<WriteResult> {
  const absPath = await confinedNotePath(vaultPath, rel);
  let stat;
  let current: string;
  try {
    stat = await fs.stat(absPath);
    current = await fs.readFile(absPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw err;
  }
  if (current !== expected) return 'raced';
  const temp = path.join(path.dirname(absPath), `.${path.basename(absPath)}.apply.tmp`);
  let staged = false;
  try {
    await fs.writeFile(temp, next, { encoding: 'utf8', flag: 'wx', mode: stat.mode });
    staged = true;
    const again = await fs.stat(absPath);
    if (again.mtimeMs !== stat.mtimeMs || again.size !== stat.size) return 'raced';
    await confinedNotePath(vaultPath, rel);
    await fs.rename(temp, absPath);
    staged = false;
    return 'written';
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return 'raced';
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw err;
  } finally {
    if (staged) await fs.rm(temp, { force: true });
  }
}
