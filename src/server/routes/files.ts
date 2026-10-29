import type { Express, Request, Response } from 'express';
import type { ExcalidrawFile } from '../../types.js';
import { files, filesRecord, markSceneDirty } from '../live-scene.js';
import { broadcast } from '../broadcast.js';
import { param } from '../http.js';

export function registerFileRoutes(app: Express): void {
  app.get('/api/files', (_req: Request, res: Response) => {
    res.json({ files: filesRecord() });
  });

  app.post('/api/files', (req: Request, res: Response) => {
    const body = req.body;
    const list: ExcalidrawFile[] = Array.isArray(body) ? body : (body?.files || []);
    for (const f of list) {
      if (f.id && f.dataURL) {
        files.set(f.id, { id: f.id, dataURL: f.dataURL, mimeType: f.mimeType || 'image/png', created: f.created || Date.now() });
      }
    }
    broadcast({ type: 'files_added', files: list });
    markSceneDirty();
    res.json({ success: true, count: list.length });
  });

  app.delete('/api/files/:id', (req: Request, res: Response) => {
    const id = param(req, 'id');
    if (files.delete(id)) {
      broadcast({ type: 'file_deleted', fileId: id });
      markSceneDirty();
      res.json({ success: true });
    } else {
      res.status(404).json({ success: false, error: `File with ID ${id} not found` });
    }
  });
}
