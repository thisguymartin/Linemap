import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import logger from '../../utils/logger.js';
import { generateId } from '../../types.js';
import { elements, filesRecord } from '../live-scene.js';
import { broadcast, clients } from '../broadcast.js';
import { renderScene, RenderError, MAX_SCALE } from '../../core/render/index.js';

interface PendingExport {
  resolve: (data: { format: string; data: string }) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  collectionTimeout: ReturnType<typeof setTimeout> | null;
  bestResult: { format: string; data: string } | null;
}
const pendingExports = new Map<string, PendingExport>();

const exportImageSchema = z.object({
  format: z.enum(['png', 'svg']),
  background: z.boolean().optional(),
  renderer: z.enum(['auto', 'node', 'browser']).optional(),
  dark: z.boolean().optional(),
  scale: z.number().min(1).max(MAX_SCALE).optional(),
  padding: z.number().min(0).optional(),
  elementIds: z.array(z.string()).min(1).optional(),
  frameId: z.string().optional(),
  embedFonts: z.boolean().optional()
});
type ExportImageBody = z.infer<typeof exportImageSchema>;

export const NO_BROWSER_TAB_ERROR = 'No frontend client connected. Open the canvas in a browser first.';

// Ask the open browser tab(s) to render with Excalidraw itself. Slower and
// needs a tab, but it is the reference rendering (renderer: 'browser').
function exportViaBrowserTab(options: ExportImageBody): Promise<{ format: string; data: string }> {
  const { format, background, renderer: _renderer, ...rest } = options;
  const requestId = generateId();

  const exportPromise = new Promise<{ format: string; data: string }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      const pending = pendingExports.get(requestId);
      pendingExports.delete(requestId);
      if (pending?.bestResult) resolve(pending.bestResult);
      else reject(new Error('Export timed out after 30 seconds'));
    }, 30000);
    pendingExports.set(requestId, { resolve, reject, timeout, collectionTimeout: null, bestResult: null });
  });

  broadcast({ type: 'initial_elements', elements: Array.from(elements.values()), files: filesRecord() });
  setTimeout(() => {
    broadcast({ type: 'export_image_request', requestId, format, background: background ?? true, options: { background, ...rest } });
  }, 800);

  return exportPromise;
}

export function registerExportRoutes(app: Express): void {
  app.post('/api/export/image', async (req: Request, res: Response) => {
    const parsed = exportImageSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue?.path.join('.');
      return res.status(400).json({
        success: false,
        error: where === 'format' ? 'format must be "png" or "svg"' : `${where ? `${where}: ` : ''}${issue?.message ?? 'invalid request'}`
      });
    }
    const options = parsed.data;
    const renderer = options.renderer ?? 'auto';

    const respondBrowser = async (): Promise<void> => {
      if (clients.size === 0) {
        res.status(503).json({ success: false, error: NO_BROWSER_TAB_ERROR });
        return;
      }
      try {
        const result = await exportViaBrowserTab(options);
        res.json({ success: true, format: result.format, data: result.data, renderer: 'browser' });
      } catch (error) {
        res.status(500).json({ success: false, error: (error as Error).message });
      }
    };

    if (renderer === 'browser') return respondBrowser();

    try {
      const { renderer: _renderer, ...renderOptions } = options;
      const scene = { elements: Array.from(elements.values()), files: filesRecord() };
      const result = await renderScene(scene, renderOptions);
      res.json({
        success: true,
        format: result.format,
        data: result.data,
        renderer: 'node',
        width: result.width,
        height: result.height,
        ...(result.warnings.length > 0 ? { warnings: result.warnings } : {})
      });
    } catch (error) {
      if (error instanceof RenderError) return res.status(error.status).json({ success: false, error: error.message });
      logger.error('Headless image export failed:', error);
      if (renderer === 'auto' && clients.size > 0) {
        logger.warn('Falling back to the browser tab for this export');
        return respondBrowser();
      }
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  app.post('/api/export/image/result', (req: Request, res: Response) => {
    const { requestId, format, data, error } = req.body ?? {};
    if (!requestId) return res.status(400).json({ success: false, error: 'requestId is required' });
    const pending = pendingExports.get(requestId);
    if (!pending) return res.json({ success: true });
    if (error) {
      logger.warn(`Export error from one client (requestId=${requestId}): ${error}`);
      return res.json({ success: true });
    }
    if (!pending.bestResult || data.length > pending.bestResult.data.length) pending.bestResult = { format, data };
    if (!pending.collectionTimeout) {
      pending.collectionTimeout = setTimeout(() => {
        const p = pendingExports.get(requestId);
        if (p?.bestResult) {
          clearTimeout(p.timeout);
          pendingExports.delete(requestId);
          p.resolve(p.bestResult);
        }
      }, 3000);
    }
    res.json({ success: true });
  });
}
