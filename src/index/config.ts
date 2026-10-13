/**
 * Semantic index configuration, read from the environment.
 *
 * The whole feature is gated on DATABASE_URL: when it is unset, the MCP server
 * registers no semantic tools and the indexer refuses to start.
 */

import type { EmbedderConfig } from './embedder.js';

export interface IndexConfig {
  databaseUrl: string;
  collection: string;
  embedder: EmbedderConfig;
  intervalSeconds: number;
}

export function readIndexConfig(env: NodeJS.ProcessEnv = process.env): IndexConfig | null {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) return null;
  const provider = env.EMBED_PROVIDER === 'fake' ? 'fake' : 'ollama';
  const dim = env.EMBED_DIM ? Number(env.EMBED_DIM) : undefined;
  return {
    databaseUrl,
    collection: env.INDEX_COLLECTION || 'default',
    embedder: {
      provider,
      url: env.OLLAMA_URL || 'http://localhost:11434',
      model: env.EMBED_MODEL || (provider === 'fake' ? 'fake' : 'nomic-embed-text'),
      dim: Number.isFinite(dim) ? dim : undefined,
      batchSize: env.EMBED_BATCH_SIZE ? Number(env.EMBED_BATCH_SIZE) : undefined,
    },
    intervalSeconds: Math.max(5, Number(env.INDEX_INTERVAL_SECONDS || 60)),
  };
}
