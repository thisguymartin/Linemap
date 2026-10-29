import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { generateId } from '../../types.js';
import { broadcast, clients } from '../broadcast.js';
import { sendError } from '../http.js';

interface PendingViewport {
  resolve: (data: { success: boolean; message: string }) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}
const pendingViewports = new Map<string, PendingViewport>();

export const viewportRequestSchema = z.object({
  scrollToContent: z.boolean().optional(),
  scrollToElementIds: z.array(z.string().min(1)).min(1).optional(),
  viewportZoomFactor: z.number().positive().max(1).optional(),
  scrollToElementId: z.string().min(1).optional(),
  zoom: z.number().min(0.1).max(10).optional(),
  offsetX: z.number().optional(),
  offsetY: z.number().optional()
}).superRefine((params, ctx) => {
  const modes = [
    params.scrollToContent === true,
    params.scrollToElementIds !== undefined,
    params.scrollToElementId !== undefined,
    params.zoom !== undefined || params.offsetX !== undefined || params.offsetY !== undefined
  ].filter(Boolean).length;
  if (modes !== 1) {
    ctx.addIssue({ code: 'custom', message: 'Specify exactly one viewport mode: scrollToContent, scrollToElementIds, scrollToElementId, or manual zoom/offset' });
  }
  if (params.viewportZoomFactor !== undefined && params.scrollToContent !== true && params.scrollToElementIds === undefined) {
    ctx.addIssue({ code: 'custom', path: ['viewportZoomFactor'], message: 'viewportZoomFactor requires scrollToContent or scrollToElementIds' });
  }
});

export function registerViewportRoutes(app: Express): void {
  app.post('/api/viewport', (req: Request, res: Response) => {
    try {
      const params = viewportRequestSchema.parse(req.body);
      if (clients.size === 0) {
        return res.status(503).json({ success: false, error: 'No frontend client connected. Open the canvas in a browser first.' });
      }
      const requestId = generateId();
      const viewportPromise = new Promise<{ success: boolean; message: string }>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingViewports.delete(requestId);
          reject(new Error('Viewport request timed out after 10 seconds'));
        }, 10000);
        pendingViewports.set(requestId, { resolve, reject, timeout });
      });
      broadcast({ type: 'set_viewport', requestId, ...params });
      viewportPromise
        .then(result => res.json(result))
        .catch(error => res.status(500).json({ success: false, error: (error as Error).message }));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/viewport/result', (req: Request, res: Response) => {
    const { requestId, success, message, error } = req.body ?? {};
    if (!requestId) return res.status(400).json({ success: false, error: 'requestId is required' });
    const pending = pendingViewports.get(requestId);
    if (!pending) return res.json({ success: true });
    clearTimeout(pending.timeout);
    pendingViewports.delete(requestId);
    if (error || success === false) pending.reject(new Error(error || message || 'Viewport update failed'));
    else pending.resolve({ success: true, message: message || 'Viewport updated' });
    res.json({ success: true });
  });
}
