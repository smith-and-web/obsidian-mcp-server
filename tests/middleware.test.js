import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authMiddleware, corsMiddleware } from '../src/server/middleware.js';

describe('corsMiddleware', () => {
  it('should set default CORS headers', () => {
    const middleware = corsMiddleware();
    const req = { method: 'GET' };
    const res = {
      header: vi.fn(),
    };
    const next = vi.fn();

    middleware(req, res, next);

    expect(res.header).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    expect(res.header).toHaveBeenCalledWith('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    expect(res.header).toHaveBeenCalledWith(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization'
    );
    expect(next).toHaveBeenCalled();
  });

  it('should respond to OPTIONS requests', () => {
    const middleware = corsMiddleware();
    const req = { method: 'OPTIONS' };
    const res = {
      header: vi.fn(),
      sendStatus: vi.fn(),
    };
    const next = vi.fn();

    middleware(req, res, next);

    expect(res.sendStatus).toHaveBeenCalledWith(200);
    expect(next).not.toHaveBeenCalled();
  });

  it('should allow custom options', () => {
    const middleware = corsMiddleware({
      origin: 'https://example.com',
      methods: 'GET',
      headers: 'X-Custom',
    });
    const req = { method: 'GET' };
    const res = {
      header: vi.fn(),
    };
    const next = vi.fn();

    middleware(req, res, next);

    expect(res.header).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://example.com');
    expect(res.header).toHaveBeenCalledWith('Access-Control-Allow-Methods', 'GET');
    expect(res.header).toHaveBeenCalledWith('Access-Control-Allow-Headers', 'X-Custom');
  });
});

describe('authMiddleware', () => {
  let res;
  let next;

  beforeEach(() => {
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    next = vi.fn();
  });

  describe('when API key is not configured', () => {
    it('should skip authentication when apiKey is undefined', () => {
      const middleware = authMiddleware({ apiKey: undefined });
      const req = { headers: {}, query: {} };

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should skip authentication when apiKey is empty string', () => {
      const middleware = authMiddleware({ apiKey: '' });
      const req = { headers: {}, query: {} };

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('when API key is configured', () => {
    const API_KEY = 'test-secret-key-12345';
    let middleware;

    beforeEach(() => {
      middleware = authMiddleware({ apiKey: API_KEY });
    });

    it('should authenticate with valid Bearer token', () => {
      const req = {
        headers: { authorization: `Bearer ${API_KEY}` },
        query: {},
      };

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should NOT accept the removed ?api_key= query parameter', () => {
      const req = {
        headers: {},
        query: { api_key: API_KEY },
      };

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should reject request without credentials', () => {
      const req = {
        headers: {},
        query: {},
      };

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Valid API key required. Provide it via the Authorization header (Bearer token).',
      });
    });

    it('should reject request with invalid Bearer token', () => {
      const req = {
        headers: { authorization: 'Bearer wrong-key' },
        query: {},
      };

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should reject request with invalid query parameter', () => {
      const req = {
        headers: {},
        query: { api_key: 'wrong-key' },
      };

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should reject non-Bearer authorization schemes', () => {
      const req = {
        headers: { authorization: `Basic ${API_KEY}` },
        query: {},
      };

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should be case-insensitive for Bearer scheme', () => {
      const req = {
        headers: { authorization: `bearer ${API_KEY}` },
        query: {},
      };

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should prefer Authorization header over query parameter', () => {
      // If header is valid, should pass even with invalid query param
      const req = {
        headers: { authorization: `Bearer ${API_KEY}` },
        query: { api_key: 'wrong-key' },
      };

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });
});

describe('authMiddleware with requireTailscaleLogin', () => {
  const API_KEY = 'test-secret-key-12345';
  const LOGIN = 'Josh@example.com';
  let res;
  let next;

  beforeEach(() => {
    res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    next = vi.fn();
  });

  it('allows a matching login (case-insensitive) with a valid key', () => {
    const middleware = authMiddleware({ apiKey: API_KEY, requireTailscaleLogin: LOGIN });
    const req = {
      headers: { authorization: `Bearer ${API_KEY}`, 'tailscale-user-login': 'josh@EXAMPLE.com' },
      query: {},
    };

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects a missing login header with 403 even with a valid key', () => {
    const middleware = authMiddleware({ apiKey: API_KEY, requireTailscaleLogin: LOGIN });
    const req = { headers: { authorization: `Bearer ${API_KEY}` }, query: {} };

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rejects a different login with 403', () => {
    const middleware = authMiddleware({ apiKey: API_KEY, requireTailscaleLogin: LOGIN });
    const req = {
      headers: { authorization: `Bearer ${API_KEY}`, 'tailscale-user-login': 'other@example.com' },
      query: {},
    };

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('still requires the key when the login matches', () => {
    const middleware = authMiddleware({ apiKey: API_KEY, requireTailscaleLogin: LOGIN });
    const req = { headers: { 'tailscale-user-login': LOGIN }, query: {} };

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('enforces the login even when no API key is configured', () => {
    const middleware = authMiddleware({ apiKey: undefined, requireTailscaleLogin: LOGIN });

    middleware({ headers: {}, query: {} }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);

    const next2 = vi.fn();
    middleware({ headers: { 'tailscale-user-login': LOGIN }, query: {} }, res, next2);
    expect(next2).toHaveBeenCalled();
  });

  it('does nothing extra when requireTailscaleLogin is not set', () => {
    const middleware = authMiddleware({ apiKey: API_KEY });
    const req = { headers: { authorization: `Bearer ${API_KEY}` }, query: {} };

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
