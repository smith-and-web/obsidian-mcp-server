import fs from 'fs/promises';
import path from 'path';

/** Resolve existing ancestors so an indexed directory cannot redirect a writer outside its vault. */
export async function confinedNotePath(
  vaultPath: string,
  relativePath: string,
  createParents = false
): Promise<string> {
  const root = path.resolve(vaultPath);
  const abs = path.resolve(root, relativePath);
  if (
    !relativePath.endsWith('.md') ||
    relativePath.includes('\\') ||
    !abs.startsWith(root + path.sep)
  )
    throw new Error(`Path escapes vault: ${relativePath}`);
  const realRoot = await fs.realpath(root);
  const inside = (p: string) => p === realRoot || p.startsWith(realRoot + path.sep);
  let ancestor = path.dirname(abs);
  for (;;) {
    try {
      if (!inside(await fs.realpath(ancestor)))
        throw new Error(`Path escapes vault: ${relativePath}`);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw err;
      ancestor = parent;
    }
  }
  if (createParents) {
    await fs.mkdir(path.dirname(abs), { recursive: true });
    if (!inside(await fs.realpath(path.dirname(abs))))
      throw new Error(`Path escapes vault: ${relativePath}`);
  }
  try {
    if ((await fs.lstat(abs)).isSymbolicLink())
      throw new Error(`Refusing symbolic-link note: ${relativePath}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  return abs;
}
