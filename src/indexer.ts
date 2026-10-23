#!/usr/bin/env node
/**
 * Obsidian vault indexer
 *
 * Polls VAULT_PATH, chunks and embeds changed notes, and writes them to the
 * pgvector database in DATABASE_URL. Runs forever by default; `--once` does a
 * single pass and exits (exit code 1 if any file errored). `--reindex` drops
 * this collection first and rebuilds it from scratch.
 *
 * Same image as the MCP server; run it as a second container with the vault
 * mounted read-only.
 */

import { readIndexConfig } from './index/config.js';
import { createEmbedder } from './index/embedder.js';
import { IndexStore } from './index/store.js';
import { scanOnce } from './index/scanner.js';

const args = new Set(process.argv.slice(2));
const once = args.has('--once');
const reindex = args.has('--reindex');
const verbose = args.has('--verbose') || process.env.INDEX_VERBOSE === 'true';

function log(msg: string): void {
  console.log(`${new Date().toISOString()} ${msg}`);
}

async function main(): Promise<void> {
  const vaultPath = process.env.VAULT_PATH || '/vault';
  const config = readIndexConfig();
  if (!config) {
    console.error('DATABASE_URL is not set; nothing to index into.');
    process.exit(2);
  }

  const embedder = await createEmbedder(config.embedder);
  const store = new IndexStore({
    connectionString: config.databaseUrl,
    collection: config.collection,
  });

  if (reindex) {
    log(`--reindex: dropping collection "${config.collection}"`);
    // ensureSchema would refuse on a model change; make sure the tables exist
    // (possibly with the old dim), truncate, and let ensureSchema re-stamp meta.
    try {
      await store.truncateCollection();
    } catch {
      // Tables may not exist yet; that is fine.
    }
    const meta = await store.getMeta().catch(() => ({}) as Record<string, string>);
    if (meta.dim && Number(meta.dim) !== embedder.dim) {
      log(`embedding dimension changed ${meta.dim} → ${embedder.dim}; resetting schema`);
      await store.resetSchema();
    }
  }

  await store.ensureSchema(embedder.model, embedder.dim);
  log(
    `indexer started: vault=${vaultPath} collection=${config.collection} model=${embedder.model} dim=${embedder.dim} interval=${config.intervalSeconds}s`
  );

  // Restarting should not hide a standing problem: list notes whose frontmatter is invalid.
  const standing = await store.listInvalidFrontmatter();
  for (const n of standing.notes) log(`WARN invalid frontmatter in ${n.path}: ${n.error}`);
  if (standing.count > standing.notes.length) {
    log(
      `WARN ${standing.count - standing.notes.length} more notes with invalid frontmatter (see index-status)`
    );
  }

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    log('stopping after current pass');
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  const runPass = async (): Promise<number> => {
    const runId = await store.startRun();
    const started = Date.now();
    try {
      const stats = await scanOnce({
        vaultPath,
        store,
        embedder,
        log: verbose ? log : undefined,
        warn: log,
      });
      await store.finishRun(runId, stats);
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      if (stats.changed || stats.removed || stats.errors || once || verbose) {
        const invalid = (await store.listInvalidFrontmatter(0)).count;
        log(
          `pass done in ${secs}s: seen=${stats.seen} changed=${stats.changed} removed=${stats.removed} errors=${stats.errors} invalid_frontmatter=${invalid}`
        );
      }
      return stats.errors;
    } catch (err) {
      await store.finishRun(runId, {
        seen: 0,
        changed: 0,
        removed: 0,
        errors: 1,
        errorText: (err as Error).message,
      });
      log(`pass failed: ${(err as Error).message}`);
      return 1;
    }
  };

  if (once) {
    const errors = await runPass();
    await store.close();
    process.exit(errors ? 1 : 0);
  }

  while (!stopping) {
    await runPass();
    if (config.learn.enabled) {
      try {
        const key = `learn_retention_at:${config.collection}`;
        const meta = await store.getMeta();
        if (!meta[key] || Date.now() - Date.parse(meta[key]) > 24 * 60 * 60 * 1000) {
          const { queries, notes } = await store.applyRetention(config.learn.retentionDays);
          await store.setMeta(key, new Date().toISOString());
          log(`learn retention: cleared ${queries} queries, ${notes} notes`);
        }
      } catch (err) {
        log(`learn retention failed: ${(err as Error).message}`);
      }
    }
    for (let i = 0; i < config.intervalSeconds && !stopping; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  await store.close();
  log('stopped');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
