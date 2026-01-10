/**
 * Express middleware configuration
 */

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
}

/**
 * API key authentication middleware
 *
 * Supports two methods:
 * 1. Authorization header: "Bearer <api-key>"
 * 2. Query parameter: ?api_key=<api-key>
 *
 * If no API_KEY is configured (undefined or empty), authentication is skipped.
 */
export function authMiddleware(options: AuthOptions) {
  const { apiKey } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    // If no API key is configured, skip authentication
    if (!apiKey) {
      next();
      return;
    }

    // Check Authorization header (Bearer token)
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const [scheme, token] = authHeader.split(' ');
      if (scheme?.toLowerCase() === 'bearer' && token === apiKey) {
        next();
        return;
      }
    }

    // Check query parameter
    const queryKey = req.query.api_key;
    if (queryKey === apiKey) {
      next();
      return;
    }

    // Authentication failed
    res.status(401).json({
      error: 'Unauthorized',
      message:
        'Valid API key required. Provide via Authorization header (Bearer token) or api_key query parameter.',
    });
  };
}
