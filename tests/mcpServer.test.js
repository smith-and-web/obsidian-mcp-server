import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fileURLToPath } from 'url';
import { VaultManager } from '../src/vault/VaultManager.js';
import { createMCPServer } from '../src/server/mcp.js';
import { toolDefinitions } from '../src/tools/index.js';

/**
 * Build a mocked Express response whose `json` captures the payload.
 */
function makeRes() {
  const res = {
    headers: {},
    json: vi.fn(payload => {
      res.body = payload;
      return res;
    }),
    setHeader: vi.fn((name, value) => {
      res.headers[name.toLowerCase()] = value;
      return res;
    }),
    status: vi.fn(code => {
      res.statusCode = code;
      return res;
    }),
    end: vi.fn(() => res),
  };
  return res;
}

function makeReq(body, headers = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { body, query: {}, get: name => lower[name.toLowerCase()] };
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

  it('includes instructions in the initialize result when configured', async () => {
    const { handlePostRequest: withInstructions } = createMCPServer({}, null, 'Use me first.');
    const res = makeRes();
    await withInstructions(makeReq({ jsonrpc: '2.0', id: 6, method: 'initialize' }), res);

    expect(res.body.result.instructions).toBe('Use me first.');
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

describe('learn tool definitions', () => {
  it('advertises feedback only when semantic search and logging are enabled', async () => {
    const { getToolDefinitions } = await import('../src/tools/definitions.js');
    expect(
      getToolDefinitions({ semantic: true, learn: false }).some(t => t.name === 'search-feedback')
    ).toBe(false);
    expect(
      getToolDefinitions({ semantic: true, learn: true }).some(t => t.name === 'search-feedback')
    ).toBe(true);
    expect(
      getToolDefinitions({ semantic: false, learn: true }).some(t => t.name === 'search-feedback')
    ).toBe(false);
  });
  it.each(['read-note', 'read-multiple-notes', 'read-section'])(
    '%s accepts an optional requestId',
    name => {
      const schema = toolDefinitions.find(t => t.name === name).inputSchema;
      expect(schema.properties.requestId.type).toBe('string');
      expect(schema.required).not.toContain('requestId');
    }
  );
});

describe('POST /sse sessions (Mcp-Session-Id)', () => {
  const vault = new VaultManager(fileURLToPath(new URL('../examples/test-vault', import.meta.url)));
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  let learn, handlers;
  const initialize = async (clientInfo = { name: 'test-client', version: '2' }) => {
    const res = makeRes();
    await handlers.handlePostRequest(
      makeReq({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo } }),
      res
    );
    return res;
  };
  const readNote = (headers = {}) =>
    handlers.handlePostRequest(
      makeReq(
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'read-note', arguments: { path: 'Welcome.md' } },
        },
        headers
      ),
      makeRes()
    );
  beforeEach(() => {
    learn = {
      sessionStarted: vi.fn(),
      sessionClosed: vi.fn(),
      sessionClient: vi.fn(async () => undefined),
      logReads: vi.fn(),
    };
    handlers = createMCPServer(vault, null, undefined, learn);
  });

  it('returns a new session id in the Mcp-Session-Id header on initialize and records it', async () => {
    const res = await initialize();
    const sessionId = res.headers['mcp-session-id'];
    expect(sessionId).toMatch(uuid);
    expect((await initialize()).headers['mcp-session-id']).not.toBe(sessionId);
    expect(learn.sessionStarted).toHaveBeenCalledWith(
      sessionId,
      { name: 'test-client', version: '2' },
      'post'
    );
    expect(res.body.result.serverInfo.name).toBe('obsidian-mcp');
  });

  it('issues a header but records no session for the mcp-remote connection test', async () => {
    const res = await initialize({ name: 'mcp-remote-fallback-test', version: '0.0.0' });
    expect(res.headers['mcp-session-id']).toMatch(uuid);
    expect(learn.sessionStarted).not.toHaveBeenCalled();
  });

  it('logs later calls carrying the header with that session id and client name', async () => {
    const sessionId = (await initialize()).headers['mcp-session-id'];
    await readNote({ 'Mcp-Session-Id': sessionId });
    expect(learn.logReads).toHaveBeenCalledWith(
      { sessionId, clientName: 'test-client' },
      'read-note',
      ['Welcome.md'],
      null
    );
    expect(learn.sessionClient).not.toHaveBeenCalled();
  });

  it('looks up a session it has not seen in this process, once', async () => {
    learn.sessionClient.mockResolvedValue('restarted-client');
    await readNote({ 'mcp-session-id': 'from-before-restart' });
    await readNote({ 'mcp-session-id': 'from-before-restart' });
    expect(learn.sessionClient).toHaveBeenCalledTimes(1);
    expect(learn.logReads).toHaveBeenLastCalledWith(
      { sessionId: 'from-before-restart', clientName: 'restarted-client' },
      'read-note',
      ['Welcome.md'],
      null
    );
  });

  it('keeps the stateless client name for an unknown session or a failed lookup', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await readNote({ 'mcp-session-id': 'unknown' });
    learn.sessionClient.mockRejectedValue(new Error('database down'));
    await readNote({ 'mcp-session-id': 'lookup-fails' });
    expect(learn.logReads.mock.calls.map(c => c[0])).toEqual([
      { sessionId: 'unknown', clientName: 'post' },
      { sessionId: 'lookup-fails', clientName: 'post' },
    ]);
    vi.restoreAllMocks();
  });

  it('logs a call without the header exactly as before', async () => {
    await initialize();
    await readNote();
    expect(learn.logReads).toHaveBeenCalledWith(
      { sessionId: null, clientName: 'post' },
      'read-note',
      ['Welcome.md'],
      null
    );
  });

  it('closes the session on DELETE and answers 204', async () => {
    const sessionId = (await initialize()).headers['mcp-session-id'];
    const res = makeRes();
    await handlers.handleSessionDelete(makeReq(undefined, { 'Mcp-Session-Id': sessionId }), res);
    expect(learn.sessionClosed).toHaveBeenCalledWith(sessionId);
    expect(res.statusCode).toBe(204);
    expect(res.end).toHaveBeenCalled();
  });

  it('rejects DELETE without the header', async () => {
    const res = makeRes();
    await handlers.handleSessionDelete(makeReq(undefined), res);
    expect(res.statusCode).toBe(400);
    expect(learn.sessionClosed).not.toHaveBeenCalled();
  });
});

describe('maintenance tool surface', () => {
  it('registers both tools with semantic search, independently of logging', async () => {
    const { getToolDefinitions } = await import('../src/tools/definitions.js');
    for (const learn of [false, true])
      for (const semantic of [false, true]) {
        const names = getToolDefinitions({ semantic, learn }).map(t => t.name);
        for (const tool of ['recommend-notes', 'maintenance-decision'])
          expect(names.includes(tool)).toBe(semantic);
      }
  });
  it.each([
    ['recommend-notes', {}, 'Invalid positive: expected 1 to 10 strings'],
    ['recommend-notes', { positive: [] }, 'Invalid positive: expected 1 to 10 strings'],
    ['recommend-notes', { positive: [2] }, 'Invalid positive: expected 1 to 10 strings'],
    [
      'recommend-notes',
      { positive: Array(11).fill('notes/a.md') },
      'Invalid positive: expected 1 to 10 strings',
    ],
    [
      'recommend-notes',
      { positive: ['notes/a.md'], negative: 'bad' },
      'Invalid negative: expected 0 to 10 strings',
    ],
    [
      'recommend-notes',
      { positive: ['notes/a.md'], negative: Array(11).fill('notes/b.md') },
      'Invalid negative: expected 0 to 10 strings',
    ],
    [
      'recommend-notes',
      { positive: ['notes/a.md'], k: 0 },
      'Invalid k: expected an integer from 1 to 50',
    ],
    [
      'recommend-notes',
      { positive: ['notes/a.md'], k: 1.5 },
      'Invalid k: expected an integer from 1 to 50',
    ],
    [
      'recommend-notes',
      { positive: ['notes/a.md'], k: 51 },
      'Invalid k: expected an integer from 1 to 50',
    ],
    [
      'recommend-notes',
      { positive: ['notes/a.md'], strategy: 'bad' },
      'Invalid strategy: expected best_score or average_vector',
    ],
    [
      'maintenance-decision',
      { finding: 'nope', decision: 'accept' },
      'Invalid finding: expected an id like f17',
    ],
    [
      'maintenance-decision',
      { finding: 'f17', decision: 'maybe' },
      'Invalid decision: expected accept or reject',
    ],
  ])('validates %s before touching the store', async (name, args, error) => {
    const { executeToolCall } = await import('../src/tools/handlers.js');
    const store = {
      missingPaths: vi.fn(),
      recommendNotes: vi.fn(),
      decideFinding: vi.fn(),
      refreshClassCounts: vi.fn(),
    };
    await expect(executeToolCall(name, args, {}, { store })).rejects.toThrow(error);
    for (const method of Object.values(store)) expect(method).not.toHaveBeenCalled();
  });
  it('uses built-in redaction without logging and custom redaction with logging', async () => {
    const { executeToolCall } = await import('../src/tools/handlers.js');
    const store = {
      decideFinding: vi
        .fn()
        .mockResolvedValue({
          id: 17,
          class: 'link-related',
          paths: ['notes/a.md'],
          status: 'accepted',
        }),
      refreshClassCounts: vi.fn(),
    };
    await executeToolCall(
      'maintenance-decision',
      { finding: '17', decision: 'accept', note: 'a'.repeat(64) },
      {},
      { store }
    );
    expect(store.decideFinding).toHaveBeenLastCalledWith(17, 'accepted', 'tool', null, false);
    await executeToolCall(
      'maintenance-decision',
      { finding: 'f17', decision: 'reject', note: 'private marker' },
      {},
      { store },
      undefined,
      { patterns: [/private marker/] }
    );
    expect(store.decideFinding).toHaveBeenLastCalledWith(17, 'rejected', 'tool', null, false);
    await executeToolCall(
      'maintenance-decision',
      { finding: 'f17', decision: 'accept', note: 'useful' },
      {},
      { store }
    );
    expect(store.decideFinding).toHaveBeenLastCalledWith(17, 'accepted', 'tool', 'useful', false);
  });
});
