#!/usr/bin/env node
/**
 * Obsidian MCP Server
 *
 * A Model Context Protocol server for Obsidian vault management.
 * Provides SSE transport for remote access to vault operations.
 */

import express from 'express';
import { VaultManager } from './vault/VaultManager.js';
import { createMCPServer } from './server/mcp.js';
import { corsMiddleware, authMiddleware } from './server/middleware.js';

// Configuration
const PORT = process.env.PORT || 3000;
const VAULT_PATH = process.env.VAULT_PATH || '/vault';
const COMPACT_RESPONSES = process.env.COMPACT_RESPONSES === 'true';
const API_KEY = process.env.API_KEY;

// Initialize Express app
const app = express();

// Global middleware
app.use(corsMiddleware());
app.use(express.json());

// Auth middleware (only applied to protected routes)
const auth = authMiddleware({ apiKey: API_KEY });

// Initialize VaultManager
const vaultManager = new VaultManager(VAULT_PATH, { compactResponses: COMPACT_RESPONSES });

// Initialize MCP handlers
const { handleSSEConnection, handlePostRequest } = createMCPServer(vaultManager);

// Health check endpoint (public - no auth required)
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    vault: VAULT_PATH,
    auth: API_KEY ? 'enabled' : 'disabled',
  });
});

// SSE endpoint for MCP (GET) - protected
app.get('/sse', auth, async (_req, res) => {
  console.log('New SSE connection');
  await handleSSEConnection(res);
});

// POST endpoint for messages (used by SSE transport) - protected
app.post('/message', auth, express.json(), async (_req, res) => {
  res.json({ status: 'ok' });
});

// Direct POST endpoint for MCP protocol messages - protected
app.post('/sse', auth, handlePostRequest);

// Start server
app.listen(PORT, () => {
  console.log(`Obsidian MCP SSE server running on port ${PORT}`);
  console.log(`Vault path: ${VAULT_PATH}`);
  console.log(`Compact responses: ${COMPACT_RESPONSES}`);
  console.log(`Authentication: ${API_KEY ? 'enabled' : 'disabled'}`);
  console.log(`SSE endpoint: http://0.0.0.0:${PORT}/sse`);
});
