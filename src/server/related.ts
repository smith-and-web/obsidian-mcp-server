import type { Request, Response } from 'express';
import type { SearchService } from '../index/SearchService.js';
import { isExcludedPath } from '../index/exclusions.js';

/** Read-only sidebar data. Deliberately bypasses the learn-log methods. */
export function createRelatedHandler(
  search: SearchService | null
): (req: Request, res: Response) => Promise<void> {
  return async (req, res) => {
    if (!search) {
      res.status(503).json({ error: 'semantic search disabled' });
      return;
    }
    const raw = req.query.path;
    if (typeof raw !== 'string' || !raw || raw.length > 1024) {
      res.status(400).json({ error: 'path must be a string of 1 to 1024 characters' });
      return;
    }
    let path = raw.replace(/^\//, '');
    if (!path.endsWith('.md')) path += '.md';
    if (
      !path ||
      path.startsWith('/') ||
      /[\\\x00-\x1f\x7f]/.test(path) ||
      path.split('/').some(part => !part || part === '.' || part === '..') ||
      isExcludedPath(path)
    ) {
      res.status(400).json({ error: 'path must be a vault-relative markdown note' });
      return;
    }
    const rawK = req.query.k;
    if (
      rawK !== undefined &&
      (typeof rawK !== 'string' || !/^\d+$/.test(rawK) || Number(rawK) < 1 || Number(rawK) > 20)
    ) {
      res.status(400).json({ error: 'k must be an integer from 1 to 20' });
      return;
    }
    const k = rawK === undefined ? 8 : Number(rawK);
    try {
      const document = await search.store.relatedDocument(path);
      if (!document) {
        res.status(404).json({ error: 'not indexed' });
        return;
      }
      const [trails, similar, linked] = await Promise.all([
        search.store.trailsFor(path, k),
        search.store.similar(path, k),
        search.store.linkedPaths(path),
      ]);
      res.json({
        path,
        title: document.title,
        heat: document.heat && { ...document.heat, score: Number(document.heat.score.toFixed(2)) },
        trails: trails.map(item => ({
          ...item,
          weight: Number(item.weight.toFixed(1)),
          linked: linked.has(item.path),
        })),
        similar: similar.map(item => ({
          ...item,
          score: Number(item.score.toFixed(2)),
          linked: linked.has(item.path),
        })),
      });
    } catch (err) {
      console.error('Related notes store error', err);
      res.status(500).json({ error: 'internal error' });
    }
  };
}
