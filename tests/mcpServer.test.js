import { describe, it, expect, vi } from 'vitest';
import { createMCPServer } from '../src/server/mcp.js';
import { toolDefinitions } from '../src/tools/index.js';

/**
 * Build a mocked Express response whose `json` captures the payload.
 */
function makeRes() {
  const res = {
    json: vi.fn(payload => {
      res.body = payload;
      return res;
    }),
  };
  return res;
}

function makeReq(body) {
  return { body, query: {} };
}

describe('createMCPServer handlePostRequest', () => {
  const { handlePostRequest } = createMCPServer({});

  it('returns a spec-compliant empty array for resources/list', async () => {
    const res = makeRes();
    await handlePostRequest(makeReq({ jsonrpc: '2.0', id: 1, method: 'resources/list' }), res);

    expect(res.body).toEqual({ jsonrpc: '2.0', id: 1, result: { resources: [] } });
    expect(Array.isArray(res.body.result.resources)).toBe(true);
  });

  it('returns an empty array for resources/templates/list', async () => {
    const res = makeRes();
    await handlePostRequest(
      makeReq({ jsonrpc: '2.0', id: 2, method: 'resources/templates/list' }),
      res
    );

    expect(res.body).toEqual({ jsonrpc: '2.0', id: 2, result: { resourceTemplates: [] } });
    expect(Array.isArray(res.body.result.resourceTemplates)).toBe(true);
  });

  it('returns an empty array for prompts/list', async () => {
    const res = makeRes();
    await handlePostRequest(makeReq({ jsonrpc: '2.0', id: 3, method: 'prompts/list' }), res);

    expect(res.body).toEqual({ jsonrpc: '2.0', id: 3, result: { prompts: [] } });
    expect(Array.isArray(res.body.result.prompts)).toBe(true);
  });

  it('leaves the initialize response unchanged', async () => {
    const res = makeRes();
    await handlePostRequest(makeReq({ jsonrpc: '2.0', id: 4, method: 'initialize' }), res);

    expect(res.body).toEqual({
      jsonrpc: '2.0',
      id: 4,
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
  });

  it('leaves the tools/list response unchanged', async () => {
    const res = makeRes();
    await handlePostRequest(makeReq({ jsonrpc: '2.0', id: 5, method: 'tools/list' }), res);

    expect(res.body).toEqual({
      jsonrpc: '2.0',
      id: 5,
      result: { tools: toolDefinitions },
    });
  });

  it('leaves the tools/call response unchanged', async () => {
    const vaultManager = {};
    const { handlePostRequest: handle } = createMCPServer(vaultManager);
    const res = makeRes();
    await handle(
      makeReq({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'does-not-exist', arguments: {} },
      }),
      res
    );

    // Unknown tool surfaces as a JSON-RPC error, exactly as before.
    expect(res.body.jsonrpc).toBe('2.0');
    expect(res.body.id).toBe(6);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe(-32000);
  });
});
