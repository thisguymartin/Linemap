import type { Request, Response } from 'express';
import { z } from 'zod';
import logger from '../utils/logger.js';

// Express 5 types route params as string | string[]; our routes never use
// repeated params, so collapse to the first value.
export function param(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export function queryString(req: Request, name: string): string | undefined {
  const value = req.query[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

interface StatusError extends Error {
  status?: number;
}

export function sendError(res: Response, error: unknown, fallbackStatus = 500): void {
  if (error instanceof z.ZodError) {
    res.status(400).json({
      success: false,
      error: error.issues.map(issue => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ')
    });
    return;
  }
  const status = typeof (error as StatusError)?.status === 'number' ? (error as StatusError).status! : fallbackStatus;
  if (status >= 500) logger.error('Request failed:', error);
  res.status(status).json({ success: false, error: (error as Error)?.message ?? String(error) });
}
