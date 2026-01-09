/**
 * Obsidian MCP Server
 *
 * A Model Context Protocol server for Obsidian vault management.
 * Provides SSE transport for remote access to vault operations.
 */

import express from 'express';
import { VaultManager } from './vault/VaultManager.js';
import { createMCPServer } from './server/mcp.js';
import { corsMiddleware } from './server/middleware.js';

// Configuration
const PORT = process.env.PORT || 3000;
const VAULT_PATH = process.env.VAULT_PATH || '/vault';

// Initialize Express app
const app = express();

// Middleware
app.use(corsMiddleware());
app.use(express.json());

// Initialize VaultManager
const vaultManager = new VaultManager(VAULT_PATH);

// Initialize MCP handlers
const { handleSSEConnection, handlePostRequest } = createMCPServer(vaultManager);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', vault: VAULT_PATH });
});

// SSE endpoint for MCP (GET)
app.get('/sse', async (req, res) => {
  console.log('New SSE connection');
  await handleSSEConnection(res);
});

// POST endpoint for messages (used by SSE transport)
app.post('/message', express.json(), async (req, res) => {
  res.json({ status: 'ok' });
});

// Direct POST endpoint for MCP protocol messages
app.post('/sse', handlePostRequest);

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Obsidian MCP SSE server running on port ${PORT}`);
  console.log(`Vault path: ${VAULT_PATH}`);
  console.log(`SSE endpoint: http://0.0.0.0:${PORT}/sse`);
});
