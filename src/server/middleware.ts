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
  const { origin = '*', methods = 'GET, POST, OPTIONS', headers = 'Content-Type' } = options;

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
