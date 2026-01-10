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
  handleSSEConnection: (res: Response) => Promise<void>;
  handlePostRequest: (req: Request, res: Response) => Promise<Response | void>;
}

/**
 * Create and configure an MCP server instance
 */
export function createMCPServer(vaultManager: VaultManager): MCPServerHandlers {
  /**
   * Handle SSE connection (GET /sse)
   */
  async function handleSSEConnection(res: Response): Promise<void> {
    const transport = new SSEServerTransport('/message', res);
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
    console.log('MCP server connected via SSE');
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

    // Default response for other methods
    return res.json({
      jsonrpc: '2.0',
      id: id || 0,
      result: {},
    });
  }

  return {
    handleSSEConnection,
    handlePostRequest,
  };
}
