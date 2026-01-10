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

    it('should authenticate with valid query parameter', () => {
      const req = {
        headers: {},
        query: { api_key: API_KEY },
      };

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
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
        message:
          'Valid API key required. Provide via Authorization header (Bearer token) or api_key query parameter.',
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
