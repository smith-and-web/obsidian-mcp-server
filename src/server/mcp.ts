/**
 * MCP Server setup and handlers
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { toolDefinitions, executeToolCall } from '../tools/index.js';
import type { VaultManager } from '../vault/VaultManager.js';
import type { Request, Response } from 'express';

interface MCPRequest {
  method: string;
  id: number | string;
  params?: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

interface MCPServerHandlers {
  handleSSEConnection: (req: Request, res: Response) => Promise<void>;
  handleMessagePost: (req: Request, res: Response) => Promise<void>;
  handlePostRequest: (req: Request, res: Response) => Promise<Response | void>;
}

/**
 * Create and configure an MCP server instance
 */
export function createMCPServer(vaultManager: VaultManager): MCPServerHandlers {
  // Track active SSE transports by sessionId so /message POSTs can be routed
  // back to the correct stream. Required by the standard MCP-over-SSE flow:
  // the SSE stream emits an `endpoint` event pointing at /message?sessionId=...,
  // and the client POSTs JSON-RPC messages there. We must hand those off to
  // transport.handlePostMessage() so responses are streamed back over SSE.
  const transports = new Map<string, SSEServerTransport>();

  /**
   * Handle SSE connection (GET /sse)
   */
  async function handleSSEConnection(req: Request, res: Response): Promise<void> {
    const transport = new SSEServerTransport('/message', res);
    transports.set(transport.sessionId, transport);
    req.on('close', () => {
      transports.delete(transport.sessionId);
    });

    const server = new Server(
      {
        name: 'obsidian-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Register tool list handler
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefinitions }));

    // Register tool execution handler
    server.setRequestHandler(CallToolRequestSchema, async request => {
      const { name, arguments: args } = request.params;

      try {
        const result = await executeToolCall(name, args as Record<string, unknown>, vaultManager);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    });

    await server.connect(transport);
    console.log(`MCP server connected via SSE (session: ${transport.sessionId})`);
  }

  /**
   * Handle POST /message — the standard MCP-over-SSE message channel.
   * Routes JSON-RPC requests to the SSEServerTransport for the matching
   * sessionId; responses are streamed back over the SSE connection.
   */
  async function handleMessagePost(req: Request, res: Response): Promise<void> {
    const sessionId = req.query.sessionId as string | undefined;
    if (!sessionId) {
      res.status(400).json({ error: 'Missing sessionId query parameter' });
      return;
    }
    const transport = transports.get(sessionId);
    if (!transport) {
      res.status(404).json({ error: `No active SSE session for ${sessionId}` });
      return;
    }
    // Pass parsed body since global express.json() already consumed the stream.
    await transport.handlePostMessage(req, res, req.body);
  }

  /**
   * Handle direct POST requests (POST /sse)
   */
  async function handlePostRequest(req: Request, res: Response): Promise<Response | void> {
    const { method, id, params } = req.body as MCPRequest;

    if (method === 'initialize') {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'obsidian-mcp',
            version: '1.0.0',
          },
        },
      });
    }

    if (method === 'tools/list') {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          tools: toolDefinitions,
        },
      });
    }

    if (method === 'tools/call') {
      const { name, arguments: args } = params!;

      try {
        const result = await executeToolCall(name, args, vaultManager);
        return res.json({
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          },
        });
      } catch (error) {
        return res.json({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32000,
            message: (error as Error).message,
          },
        });
      }
    }

    if (method === 'resources/list') {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          resources: [],
        },
      });
    }

    if (method === 'resources/templates/list') {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          resourceTemplates: [],
        },
      });
    }

    if (method === 'prompts/list') {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          prompts: [],
        },
      });
    }

    // Default response for other methods
    return res.json({
      jsonrpc: '2.0',
      id: id || 0,
      result: {},
    });
  }

  return {
    handleSSEConnection,
    handleMessagePost,
    handlePostRequest,
  };
}
