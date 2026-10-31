import type { Request, Response } from 'express';
import type { SearchService } from '../index/SearchService.js';

/** Read-only graph data, deliberately independent of all learn-log methods. */
export function createGraphHandler(
  search: SearchService | null
): (req: Request, res: Response) => Promise<void> {
  return async (_req, res) => {
    if (!search) {
      res.status(503).json({ error: 'semantic search disabled' });
      return;
    }
    try {
      res.json(await search.store.graph());
    } catch (err) {
      console.error('Graph store error', err);
      res.status(500).json({ error: 'internal error' });
    }
  };
}
