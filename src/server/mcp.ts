/**
 * MCP Server setup and handlers
 */

import { randomUUID } from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { getToolDefinitions, executeToolCall } from '../tools/index.js';
import type { VaultManager } from '../vault/VaultManager.js';
import type { SearchService } from '../index/SearchService.js';
import type { CallContext, LearnLog } from '../learn/log.js';
import type { Request, Response } from 'express';

interface MCPRequest {
  method: string;
  id: number | string;
  params?: {
    name: string;
    arguments: Record<string, unknown>;
    clientInfo?: { name?: string; version?: string };
  };
}

/** Streamable HTTP session header: issued on initialize, echoed by the client afterwards. */
const SESSION_HEADER = 'mcp-session-id';
/** mcp-remote's throwaway connection test; it never makes a tool call. */
const PROBE_CLIENT = 'mcp-remote-fallback-test';
/** POST sessions are kept in memory up to this many; older ones fall back to the database. */
const MAX_POST_SESSIONS = 1000;

interface MCPServerHandlers {
  handleSSEConnection: (req: Request, res: Response) => Promise<void>;
  handleMessagePost: (req: Request, res: Response) => Promise<void>;
  handlePostRequest: (req: Request, res: Response) => Promise<Response | void>;
  handleSessionDelete: (req: Request, res: Response) => Promise<void>;
}

/**
 * Create and configure an MCP server instance
 */
export function createMCPServer(
  vaultManager: VaultManager,
  search: SearchService | null = null,
  instructions?: string,
  learn: LearnLog | null = null
): MCPServerHandlers {
  const toolDefinitions = getToolDefinitions({ semantic: search !== null, learn: learn !== null });
  // Track active SSE transports by sessionId so /message POSTs can be routed
  // back to the correct stream. Required by the standard MCP-over-SSE flow:
  // the SSE stream emits an `endpoint` event pointing at /message?sessionId=...,
  // and the client POSTs JSON-RPC messages there. We must hand those off to
  // transport.handlePostMessage() so responses are streamed back over SSE.
  const transports = new Map<string, SSEServerTransport>();
  const clientNames = new Map<string, string | null>();
  // POST /sse sessions: Mcp-Session-Id → client name, for the learn log's call context.
  const postSessions = new Map<string, string | null>();

  function rememberPostSession(sessionId: string, clientName: string | null): void {
    postSessions.delete(sessionId);
    postSessions.set(sessionId, clientName);
    if (postSessions.size > MAX_POST_SESSIONS) {
      postSessions.delete(postSessions.keys().next().value!);
    }
  }

  /**
   * Call context for a POST /sse request. Without an Mcp-Session-Id header it is the
   * stateless context used before 1.10.1; with one, the session and its client name.
   */
  async function postContext(req: Request): Promise<CallContext> {
    const sessionId = req.get(SESSION_HEADER);
    if (!sessionId) return { sessionId: null, clientName: 'post' };
    if (!postSessions.has(sessionId)) {
      // Not seen since this process started: look it up, so sessions survive a restart.
      // Unknown sessions (or a failed lookup) keep the stateless client name.
      let recorded: string | null | undefined;
      try {
        recorded = learn ? await learn.sessionClient(sessionId) : undefined;
      } catch (err) {
        console.error('learn-log: ' + (err as Error).message);
      }
      rememberPostSession(sessionId, recorded === undefined ? 'post' : recorded);
    }
    return { sessionId, clientName: postSessions.get(sessionId) ?? null };
  }

  /**
   * Handle SSE connection (GET /sse)
   */
  async function handleSSEConnection(req: Request, res: Response): Promise<void> {
    const transport = new SSEServerTransport('/message', res);
    transports.set(transport.sessionId, transport);
    req.on('close', () => {
      transports.delete(transport.sessionId);
      learn?.sessionClosed(transport.sessionId);
      clientNames.delete(transport.sessionId);
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
        ...(instructions ? { instructions } : {}),
      }
    );

    // Register tool list handler
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefinitions }));

    // Register tool execution handler
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const { name, arguments: args } = request.params;

      try {
        const result = await executeToolCall(
          name,
          args as Record<string, unknown>,
          vaultManager,
          search,
          {
            sessionId: extra.sessionId ?? null,
            clientName: clientNames.get(extra.sessionId ?? '') ?? null,
          },
          learn
        );
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

    server.oninitialized = () => {
      const v = server.getClientVersion();
      clientNames.set(transport.sessionId, v?.name ?? null);
      learn?.sessionStarted(transport.sessionId, v);
    };
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
      const sessionId = randomUUID();
      const clientInfo = params?.clientInfo;
      if (clientInfo?.name !== PROBE_CLIENT) {
        rememberPostSession(sessionId, clientInfo?.name ?? null);
        learn?.sessionStarted(sessionId, clientInfo, 'post');
      }
      res.setHeader(SESSION_HEADER, sessionId);
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
          ...(instructions ? { instructions } : {}),
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
        const result = await executeToolCall(
          name,
          args,
          vaultManager,
          search,
          await postContext(req),
          learn
        );
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

  /**
   * Handle DELETE /sse — the client ending a session it started with POST /sse initialize.
   */
  async function handleSessionDelete(req: Request, res: Response): Promise<void> {
    const sessionId = req.get(SESSION_HEADER);
    if (!sessionId) {
      res.status(400).json({ error: 'Missing Mcp-Session-Id header' });
      return;
    }
    postSessions.delete(sessionId);
    learn?.sessionClosed(sessionId);
    res.status(204).end();
  }

  return {
    handleSSEConnection,
    handleMessagePost,
    handlePostRequest,
    handleSessionDelete,
  };
}
