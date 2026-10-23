/**
 * SearchService — what the MCP tools call.
 *
 * Owns an IndexStore and an Embedder. The server constructs one only when
 * DATABASE_URL is set; the indexer process uses the same pieces directly.
 */

import fs from 'fs/promises';
import path from 'path';
import { createEmbedder, type Embedder } from './embedder.js';
import { IndexStore, type IndexStatus, type SearchHit, type SimilarHit } from './store.js';
import { indexFile } from './scanner.js';
import { isExcludedPath } from './exclusions.js';
import type { IndexConfig } from './config.js';
import type { RankingConfig } from './ranking.js';

export interface SemanticSearchOptions {
  k?: number;
  mode?: 'hybrid' | 'vector' | 'text';
  directory?: string;
  tags?: string[];
  type?: string;
  status?: string;
}

export interface SemanticSearchResult {
  query: string;
  mode: 'hybrid' | 'vector' | 'text';
  results: SearchHit[];
}

export interface SimilarNotesResult {
  path: string;
  results: SimilarHit[];
}

export interface ReindexNoteResult {
  path: string;
  indexed: boolean;
  reason?: string;
  /** Present when the note was indexed but its frontmatter is not valid YAML. */
  warning?: string;
}

export class SearchService {
  readonly store: IndexStore;
  readonly embedder: Embedder;
  private vaultPath: string;
  private ranking: RankingConfig;

  private constructor(
    store: IndexStore,
    embedder: Embedder,
    vaultPath: string,
    ranking: RankingConfig
  ) {
    this.store = store;
    this.embedder = embedder;
    this.vaultPath = vaultPath;
    this.ranking = ranking;
  }

  /**
   * Connect to the database and the embedding provider and make sure the
   * schema exists. Throws if the index was built with a different model.
   */
  static async create(config: IndexConfig, vaultPath: string): Promise<SearchService> {
    const embedder = await createEmbedder(config.embedder);
    const store = new IndexStore({
      connectionString: config.databaseUrl,
      collection: config.collection,
    });
    await store.ensureSchema(embedder.model, embedder.dim);
    return new SearchService(store, embedder, vaultPath, config.ranking);
  }

  async close(): Promise<void> {
    await this.store.close();
  }

  /**
   * Hybrid semantic + full-text search over indexed chunks.
   */
  async semanticSearch(
    query: string,
    options: SemanticSearchOptions = {}
  ): Promise<SemanticSearchResult> {
    const mode = options.mode ?? 'hybrid';
    const trimmed = query.trim();
    if (!trimmed) return { query, mode, results: [] };
    const embedding = mode === 'text' ? null : (await this.embedder.embed([trimmed]))[0];
    const results = await this.store.search(embedding, trimmed, {
      k: options.k,
      mode,
      directory: options.directory,
      tags: options.tags,
      type: options.type,
      status: options.status,
      ranking: this.ranking,
    });
    return { query, mode, results };
  }

  /**
   * Notes nearest to a given note.
   */
  async similarNotes(notePath: string, k = 8): Promise<SimilarNotesResult> {
    const results = await this.store.similar(notePath, k);
    return { path: notePath, results };
  }

  async indexStatus(): Promise<IndexStatus> {
    return this.store.status();
  }

  /**
   * Re-index one note immediately, bypassing the stat check.
   */
  async reindexNote(notePath: string): Promise<ReindexNoteResult> {
    const rel = notePath.replace(/^[/\\]+/, '');
    const root = path.resolve(this.vaultPath);
    const abs = path.resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      throw new Error(`Path escapes vault: ${notePath}`);
    }
    if (isExcludedPath(rel)) {
      return { path: rel, indexed: false, reason: 'path is excluded from indexing' };
    }
    let content: string;
    let st: import('fs').Stats;
    try {
      st = await fs.stat(abs);
      content = await fs.readFile(abs, 'utf-8');
    } catch {
      await this.store.deleteDocument(rel);
      return { path: rel, indexed: false, reason: 'file not found; removed from index if present' };
    }
    let warning: string | undefined;
    const indexed = await indexFile(
      { relPath: rel, absPath: abs, mtime: st.mtime, size: st.size },
      content,
      {
        vaultPath: this.vaultPath,
        store: this.store,
        embedder: this.embedder,
        warn: msg => {
          warning = msg.replace(/^WARN /, '');
        },
      }
    );
    return indexed
      ? { path: rel, indexed: true, ...(warning ? { warning } : {}) }
      : { path: rel, indexed: false, reason: 'frontmatter index: false' };
  }
}
