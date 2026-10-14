/**
 * Express middleware configuration
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export interface CorsOptions {
  origin?: string;
  methods?: string;
  headers?: string;
}

/**
 * Configure CORS middleware
 */
export function corsMiddleware(options: CorsOptions = {}) {
  const {
    origin = '*',
    methods = 'GET, POST, OPTIONS',
    headers = 'Content-Type, Authorization',
  } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', methods);
    res.header('Access-Control-Allow-Headers', headers);

    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }

    next();
  };
}

export interface AuthOptions {
  apiKey: string | undefined;
  /**
   * When set, requests must carry a `Tailscale-User-Login` header equal to this value
   * (case-insensitive). `tailscale serve` adds that header to requests from tailnet users;
   * it is only trustworthy when the server listens on loopback behind `tailscale serve`.
   */
  requireTailscaleLogin?: string;
}

/** Constant-time string comparison (digests first, so lengths do not leak). */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * API key authentication middleware
 *
 * 1. Authorization header: "Bearer <api-key>" (compared in constant time).
 * 2. If `requireTailscaleLogin` is set, the `Tailscale-User-Login` header must match it too.
 *
 * If no API_KEY is configured (undefined or empty) the key check is skipped; the Tailscale
 * login check, when configured, still applies. The former `?api_key=` query parameter was
 * removed in 1.6.0 because it lands the secret in access logs and client history.
 */
export function authMiddleware(options: AuthOptions) {
  const { apiKey, requireTailscaleLogin } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    if (requireTailscaleLogin) {
      const raw = req.headers['tailscale-user-login'];
      const login = Array.isArray(raw) ? raw[0] : raw;
      if (!login || !safeEqual(login.toLowerCase(), requireTailscaleLogin.toLowerCase())) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'This server only accepts requests from the configured Tailscale user.',
        });
        return;
      }
    }

    // If no API key is configured, skip the key check
    if (!apiKey) {
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    if (authHeader) {
      const [scheme, token] = authHeader.split(' ');
      if (scheme?.toLowerCase() === 'bearer' && token !== undefined && safeEqual(token, apiKey)) {
        next();
        return;
      }
    }

    res.status(401).json({
      error: 'Unauthorized',
      message: 'Valid API key required. Provide it via the Authorization header (Bearer token).',
    });
  };
}
