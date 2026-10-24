import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import express from 'express';
import { createMCPServer } from '../src/server/mcp.js';
import { readKeepaliveConfig, DEFAULT_KEEPALIVE_SECONDS } from '../src/server/keepalive.js';

describe('readKeepaliveConfig', () => {
  it('defaults to 30 seconds when unset or empty', () => {
    expect(readKeepaliveConfig({})).toEqual({ seconds: DEFAULT_KEEPALIVE_SECONDS, error: null });
    expect(readKeepaliveConfig({ SSE_KEEPALIVE_SECONDS: '' }).seconds).toBe(30);
  });
  it('accepts 0 to disable and integers up to 3600', () => {
    expect(readKeepaliveConfig({ SSE_KEEPALIVE_SECONDS: '0' })).toEqual({ seconds: 0, error: null });
    expect(readKeepaliveConfig({ SSE_KEEPALIVE_SECONDS: '3600' }).seconds).toBe(3600);
  });
  it.each(['-1', '1.5', 'abc', '3601'])('keeps the default and reports %s', raw => {
    expect(readKeepaliveConfig({ SSE_KEEPALIVE_SECONDS: raw })).toEqual({
      seconds: 30,
      error: `Invalid SSE_KEEPALIVE_SECONDS=${raw}: expected an integer from 0 to 3600`,
    });
  });
});

describe('SSE keepalive', () => {
  let server;
  afterEach(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    server = undefined;
  });

  /** Serve GET /sse with the given keepalive and collect the stream for `ms`. */
  async function collect(keepaliveSeconds, ms) {
    const { handleSSEConnection } = createMCPServer({}, null, undefined, null, { keepaliveSeconds });
    const app = express();
    app.get('/sse', handleSSEConnection);
    server = app.listen(0);
    await new Promise(resolve => server.once('listening', resolve));
    const { port } = server.address();
    return new Promise((resolve, reject) => {
      const req = http.get({ port, path: '/sse' }, res => {
        let body = '';
        res.on('data', chunk => (body += chunk));
        setTimeout(() => {
          req.destroy();
          resolve(body);
        }, ms);
      });
      req.on('error', err => (err.code === 'ECONNRESET' ? undefined : reject(err)));
    });
  }

  it('writes an SSE comment ping after the endpoint event', async () => {
    const body = await collect(0.05, 180);
    expect(body).toMatch(/^event: endpoint\ndata: \/message\?sessionId=[0-9a-f-]+\n\n/);
    const pings = body.split(': ping\n\n').length - 1;
    expect(pings).toBeGreaterThanOrEqual(2);
    // Only comment lines and the endpoint event: nothing a client would parse as a message.
    expect(body.replace(/^event: endpoint\ndata: .*\n\n/, '').replaceAll(': ping\n\n', '')).toBe('');
  });

  it('sends no ping when disabled', async () => {
    const body = await collect(0, 150);
    expect(body).not.toContain(': ping');
  });
});
