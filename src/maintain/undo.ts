import fs from 'fs/promises';
import { confinedNotePath } from '../vault/confinedPath.js';
import type { ApplyStore } from './applyStore.js';
import { replaceIfUnchanged, sha } from './write.js';

/**
 * Undo an applied change and every other change of the same finding (a link-related fix edits
 * two notes). Refuses unless each note still holds exactly what auto-apply wrote, so a later
 * edit is never overwritten. The finding becomes a rejection and counts toward demotion.
 */
export async function undoChange(
  store: ApplyStore,
  vaultPath: string,
  id: number,
  opts: { dry: boolean; log: (line: string) => void }
): Promise<{ code: 0 | 1; message?: string }> {
  const change = await store.change(id);
  if (!change) return { code: 1, message: `no change ${id}` };
  if (change.revertedAt) return { code: 1, message: `change ${id} was already reverted` };
  const group =
    change.findingId === null
      ? [change]
      : (await store.findingChanges(change.findingId)).filter(c => !c.revertedAt);
  const current = new Map<number, string>();
  for (const c of group) {
    let text: string;
    try {
      text = await fs.readFile(await confinedNotePath(vaultPath, c.path), 'utf8');
    } catch {
      return { code: 1, message: `cannot read ${c.path}` };
    }
    if (sha(text) !== c.afterSha)
      return {
        code: 1,
        message: `${c.path} changed after change ${c.id}; undo refused (restore it by hand or from a snapshot)`,
      };
    current.set(c.id, text);
  }
  for (const c of group)
    opts.log(`${opts.dry ? 'would restore' : 'restore'} ${c.path} (change ${c.id})`);
  if (opts.dry) return { code: 0 };
  const restored: typeof group = [];
  for (const c of group) {
    const r = await replaceIfUnchanged(vaultPath, c.path, current.get(c.id)!, c.beforeText);
    if (r !== 'written') {
      for (const done of restored.reverse())
        await replaceIfUnchanged(vaultPath, done.path, done.beforeText, current.get(done.id)!);
      return { code: 1, message: `${c.path}: ${r}; nothing was undone` };
    }
    restored.push(c);
  }
  await store.recordReverted(
    group.map(c => c.id),
    change.findingId,
    id
  );
  return { code: 0 };
}
