/**
 * MCP Server setup and handlers
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { toolDefinitions, executeToolCall } from '../tools/index.js';

/**
 * Create and configure an MCP server instance
 * @param {VaultManager} vaultManager - VaultManager instance
 * @returns {object} Server configuration object
 */
export function createMCPServer(vaultManager) {
  /**
   * Handle SSE connection (GET /sse)
   */
  async function handleSSEConnection(res) {
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
        const result = await executeToolCall(name, args, vaultManager);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
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
  async function handlePostRequest(req, res) {
    const { method, id, params } = req.body;

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
      const { name, arguments: args } = params;

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
            message: error.message,
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
