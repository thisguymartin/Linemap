import type { Express, Request, Response } from 'express';
import logger from '../../utils/logger.js';
import { EXCALIDRAW_ELEMENT_TYPES, generateId, normalizeFontFamily, type ServerElement } from '../../types.js';
import { elements, markSceneDirty } from '../live-scene.js';
import { broadcast } from '../broadcast.js';
import { resolveArrowBindings, rerouteBoundArrows } from '../arrows.js';
import { CreateElementSchema, UpdateElementSchema } from '../schemas.js';
import { param, sendError } from '../http.js';
import type { Workspace } from '../../domain/workspace.js';

function normalizeLineBreakMarkup(text: string): string {
  return text.replace(/<\s*b\s*r\s*\/?\s*>/gi, '\n').replace(/\n{3,}/g, '\n\n');
}

export function registerElementRoutes(app: Express, workspace: Workspace): void {
  app.get('/api/elements', (_req: Request, res: Response) => {
    const list = Array.from(elements.values());
    res.json({ success: true, elements: list, count: list.length, diagramId: workspace.activeDiagramId });
  });

  app.post('/api/elements', (req: Request, res: Response) => {
    try {
      const params = CreateElementSchema.parse(req.body);
      const id = params.id || generateId();
      const element: ServerElement = {
        ...params,
        id,
        fontFamily: normalizeFontFamily(params.fontFamily),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1
      } as ServerElement;
      if (element.type === 'arrow' || element.type === 'line') resolveArrowBindings([element]);
      elements.set(id, element);
      broadcast({ type: 'element_created', element });
      markSceneDirty();
      res.json({ success: true, element });
    } catch (error) {
      sendError(res, error, 400);
    }
  });

  app.put('/api/elements/:id', (req: Request, res: Response) => {
    try {
      const id = param(req, 'id');
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const updates = UpdateElementSchema.parse({ ...body, id });
      const existing = elements.get(id);
      if (!existing) return res.status(404).json({ success: false, error: `Element with ID ${id} not found` });

      const updated: ServerElement = {
        ...existing,
        ...updates,
        fontFamily: updates.fontFamily !== undefined ? normalizeFontFamily(updates.fontFamily) : existing.fontFamily,
        updatedAt: new Date().toISOString(),
        version: (existing.version || 0) + 1
      } as ServerElement;

      // Keep Excalidraw's text source in sync when clients update text via REST.
      const hasTextUpdate = Object.prototype.hasOwnProperty.call(body, 'text');
      const hasOriginalTextUpdate = Object.prototype.hasOwnProperty.call(body, 'originalText');
      if (updated.type === EXCALIDRAW_ELEMENT_TYPES.TEXT && hasTextUpdate && !hasOriginalTextUpdate) {
        const incomingText = updates.text ?? '';
        const existingText = typeof existing.text === 'string' ? existing.text : '';
        const existingOriginal = typeof existing.originalText === 'string' ? existing.originalText : '';
        const existingOriginalHasBr = /<\s*b\s*r\s*\/?\s*>/i.test(existingOriginal);
        const normalizedExistingText = normalizeLineBreakMarkup(existingText);
        const normalizedExistingOriginal = normalizeLineBreakMarkup(existingOriginal);
        if (existingOriginalHasBr && incomingText === normalizedExistingText && normalizedExistingOriginal) {
          updated.text = normalizedExistingOriginal;
          updated.originalText = normalizedExistingOriginal;
        } else {
          updated.originalText = incomingText;
        }
      }

      elements.set(id, updated);
      broadcast({ type: 'element_updated', element: updated });

      const geometryChanged = ['x', 'y', 'width', 'height'].some(key => Object.prototype.hasOwnProperty.call(body, key));
      if (geometryChanged && updated.type !== 'arrow' && updated.type !== 'line') {
        for (const arrow of rerouteBoundArrows(id)) broadcast({ type: 'element_updated', element: arrow });
      }
      markSceneDirty();
      res.json({ success: true, element: updated });
    } catch (error) {
      sendError(res, error, 400);
    }
  });

  // Must be registered before /:id
  app.delete('/api/elements/clear', (_req: Request, res: Response) => {
    const count = elements.size;
    elements.clear();
    broadcast({ type: 'canvas_cleared', timestamp: new Date().toISOString() });
    markSceneDirty();
    logger.info(`Canvas cleared: ${count} elements removed`);
    res.json({ success: true, message: `Cleared ${count} elements`, count });
  });

  app.delete('/api/elements/:id', (req: Request, res: Response) => {
    const id = param(req, 'id');
    if (!elements.has(id)) return res.status(404).json({ success: false, error: `Element with ID ${id} not found` });
    elements.delete(id);
    broadcast({ type: 'element_deleted', elementId: id });
    markSceneDirty();
    res.json({ success: true, message: `Element ${id} deleted successfully` });
  });

  app.get('/api/elements/search', (req: Request, res: Response) => {
    try {
      const { type, x_min, x_max, y_min, y_max, ...filters } = req.query;
      let results = Array.from(elements.values());
      if (type && typeof type === 'string') results = results.filter(el => el.type === type);
      if (x_min !== undefined || x_max !== undefined || y_min !== undefined || y_max !== undefined) {
        const xMin = x_min !== undefined ? Number(x_min) : -Infinity;
        const xMax = x_max !== undefined ? Number(x_max) : Infinity;
        const yMin = y_min !== undefined ? Number(y_min) : -Infinity;
        const yMax = y_max !== undefined ? Number(y_max) : Infinity;
        results = results.filter(el => el.x >= xMin && el.x <= xMax && el.y >= yMin && el.y <= yMax);
      }
      if (Object.keys(filters).length > 0) {
        results = results.filter(el => Object.entries(filters).every(([key, value]) => (el as unknown as Record<string, unknown>)[key] === value));
      }
      res.json({ success: true, elements: results, count: results.length });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/elements/:id', (req: Request, res: Response) => {
    const id = param(req, 'id');
    const element = elements.get(id);
    if (!element) return res.status(404).json({ success: false, error: `Element with ID ${id} not found` });
    res.json({ success: true, element });
  });

  app.post('/api/elements/batch', (req: Request, res: Response) => {
    try {
      const { elements: toCreate, replace = false } = req.body ?? {};
      if (!Array.isArray(toCreate)) return res.status(400).json({ success: false, error: 'Expected an array of elements' });
      if (typeof replace !== 'boolean') return res.status(400).json({ success: false, error: 'replace must be a boolean' });

      const created: ServerElement[] = toCreate.map(data => {
        const params = CreateElementSchema.parse(data);
        const id = params.id || generateId();
        return {
          ...params,
          id,
          fontFamily: normalizeFontFamily(params.fontFamily),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: 1
        } as ServerElement;
      });

      // Validate and prepare the whole batch before touching storage.
      resolveArrowBindings(created, !replace);
      if (replace) {
        const count = elements.size;
        elements.clear();
        broadcast({ type: 'canvas_cleared', timestamp: new Date().toISOString() });
        logger.info(`Canvas replaced: ${count} existing elements removed`);
      }
      created.forEach(el => elements.set(el.id, el));
      broadcast({ type: 'elements_batch_created', elements: created });
      markSceneDirty();
      res.json({ success: true, elements: created, count: created.length });
    } catch (error) {
      sendError(res, error, 400);
    }
  });

  app.post('/api/elements/from-mermaid', (req: Request, res: Response) => {
    const { mermaidDiagram, config } = req.body ?? {};
    if (!mermaidDiagram || typeof mermaidDiagram !== 'string') {
      return res.status(400).json({ success: false, error: 'Mermaid diagram definition is required' });
    }
    broadcast({ type: 'mermaid_convert', mermaidDiagram, config: config || {}, timestamp: new Date().toISOString() });
    res.json({ success: true, mermaidDiagram, config: config || {}, message: 'Mermaid diagram sent to frontend for conversion.' });
  });

  // Full-scene write from a browser tab. The tab says which diagram it thinks
  // it is editing; a stale tab must never overwrite a freshly opened one.
  app.post('/api/elements/sync', (req: Request, res: Response) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { elements: incoming, timestamp, diagramId } = body;
      if (!Array.isArray(incoming)) return res.status(400).json({ success: false, error: 'Expected elements to be an array' });
      if (typeof diagramId === 'string' && diagramId !== workspace.activeDiagramId) {
        return res.status(409).json({
          success: false,
          error: 'Canvas switched to another diagram; reload before syncing',
          activeDiagramId: workspace.activeDiagramId
        });
      }

      const beforeCount = elements.size;
      elements.clear();
      const processed: ServerElement[] = [];
      incoming.forEach((element: Record<string, unknown>, index: number) => {
        try {
          const id = typeof element.id === 'string' && element.id ? element.id : generateId();
          const next = {
            ...element,
            id,
            syncedAt: new Date().toISOString(),
            source: 'frontend_sync',
            syncTimestamp: timestamp,
            version: 1
          } as ServerElement;
          elements.set(id, next);
          processed.push(next);
        } catch (elementError) {
          logger.warn(`Failed to process element ${index}:`, elementError);
        }
      });

      broadcast({ type: 'elements_synced', count: processed.length, timestamp: new Date().toISOString(), source: 'manual_sync' });
      markSceneDirty();
      res.json({
        success: true,
        message: `Successfully synced ${processed.length} elements`,
        count: processed.length,
        syncedAt: new Date().toISOString(),
        beforeCount,
        afterCount: elements.size
      });
    } catch (error) {
      sendError(res, error);
    }
  });
}
