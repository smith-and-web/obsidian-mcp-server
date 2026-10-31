#!/usr/bin/env node
/**
 * Obsidian MCP Server
 *
 * A Model Context Protocol server for Obsidian vault management.
 * Provides SSE transport for remote access to vault operations.
 */

import express from 'express';
import { createRelatedHandler } from './server/related.js';
import { createGraphHandler } from './server/graph.js';
import { VaultManager } from './vault/VaultManager.js';
import { createMCPServer } from './server/mcp.js';
import { readInstructions } from './server/instructions.js';
import { readKeepaliveConfig } from './server/keepalive.js';
import { corsMiddleware, authMiddleware } from './server/middleware.js';
import { readIndexConfig } from './index/config.js';
import { SearchService } from './index/SearchService.js';
import { readLearnConfig } from './learn/config.js';

// Configuration
const PORT = process.env.PORT || 3000;
const VAULT_PATH = process.env.VAULT_PATH || '/vault';
const COMPACT_RESPONSES = process.env.COMPACT_RESPONSES === 'true';
const API_KEY = process.env.API_KEY;
const INSTRUCTIONS = readInstructions();
const KEEPALIVE = readKeepaliveConfig();
if (KEEPALIVE.error) console.error(`${KEEPALIVE.error}; using ${KEEPALIVE.seconds}s`);

// Initialize Express app
const app = express();

// Global middleware
app.use(corsMiddleware());
app.use(express.json());

// Auth middleware (only applied to protected routes)
const REQUIRE_TAILSCALE_LOGIN = process.env.REQUIRE_TAILSCALE_LOGIN || undefined;
const auth = authMiddleware({
  apiKey: API_KEY,
  requireTailscaleLogin: REQUIRE_TAILSCALE_LOGIN,
});

// Initialize VaultManager
const vaultManager = new VaultManager(VAULT_PATH, { compactResponses: COMPACT_RESPONSES });

// Optional semantic search (pgvector + Ollama), enabled by DATABASE_URL
const indexConfig = readIndexConfig();
let search: SearchService | null = null;
if (indexConfig) {
  try {
    search = await SearchService.create(indexConfig, VAULT_PATH);
  } catch (err) {
    console.error(`Semantic search disabled: ${(err as Error).message}`);
  }
}

const learnConfig = indexConfig?.learn ?? readLearnConfig(process.env);
console.log(
  learnConfig.error
    ? `Learn log: disabled (${learnConfig.error})`
    : search?.learn
      ? `Learn log: enabled (retention ${learnConfig.retentionDays} days, ${learnConfig.patterns.length} patterns)`
      : 'Learn log: disabled'
);

// Initialize MCP handlers
const { handleSSEConnection, handleMessagePost, handlePostRequest, handleSessionDelete } =
  createMCPServer(vaultManager, search, INSTRUCTIONS, search?.learn ?? null, {
    keepaliveSeconds: KEEPALIVE.seconds,
  });

// Health check endpoint (public - no auth required)
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    vault: VAULT_PATH,
    auth: API_KEY ? 'enabled' : 'disabled',
    semanticSearch: search ? 'enabled' : 'disabled',
  });
});

// SSE endpoint for MCP (GET) - protected
app.get('/sse', auth, async (req, res) => {
  console.log('New SSE connection');
  await handleSSEConnection(req, res);
});

// POST endpoint for messages (used by SSE transport) - protected.
// Standard MCP-over-SSE clients (e.g. mcp-remote) POST JSON-RPC here using
// the sessionId advertised in the SSE `endpoint` event; responses come back
// over the SSE stream.
app.post('/message', auth, handleMessagePost);

// Direct POST endpoint for MCP protocol messages - protected
app.post('/sse', auth, handlePostRequest);

// Ends a POST /sse session (Mcp-Session-Id header) - protected
app.delete('/sse', auth, handleSessionDelete);
app.get('/api/related', auth, createRelatedHandler(search));
app.get('/api/graph', auth, createGraphHandler(search));

// Start server
app.listen(PORT, () => {
  console.log(`Obsidian MCP SSE server running on port ${PORT}`);
  console.log(`Vault path: ${VAULT_PATH}`);
  console.log(`Compact responses: ${COMPACT_RESPONSES}`);
  console.log(`Authentication: ${API_KEY ? 'enabled' : 'disabled'}`);
  if (REQUIRE_TAILSCALE_LOGIN) console.log(`Tailscale login required: ${REQUIRE_TAILSCALE_LOGIN}`);
  console.log(`Instructions: ${INSTRUCTIONS ? `${INSTRUCTIONS.length} chars` : 'none'}`);
  console.log(`SSE keepalive: ${KEEPALIVE.seconds ? `every ${KEEPALIVE.seconds}s` : 'disabled'}`);
  console.log(`Semantic search: ${search ? `enabled (${search.embedder.model})` : 'disabled'}`);
  console.log(`SSE endpoint: http://0.0.0.0:${PORT}/sse`);
});
