import type { Express, Request, Response } from 'express';
import logger from '../../utils/logger.js';
import type { Snapshot } from '../../types.js';
import { elements, snapshots } from '../live-scene.js';
import { param } from '../http.js';

// Ephemeral, in-memory named snapshots: quick undo points for an agent in
// the middle of a drawing session. Durable history lives in versions.
export function registerSnapshotRoutes(app: Express): void {
  app.post('/api/snapshots', (req: Request, res: Response) => {
    const { name } = req.body ?? {};
    if (!name || typeof name !== 'string') return res.status(400).json({ success: false, error: 'Snapshot name is required' });
    const snapshot: Snapshot = {
      name,
      elements: structuredClone(Array.from(elements.values())),
      createdAt: new Date().toISOString()
    };
    snapshots.set(name, snapshot);
    logger.info(`Snapshot saved: "${name}" with ${snapshot.elements.length} elements`);
    res.json({ success: true, name, elementCount: snapshot.elements.length, createdAt: snapshot.createdAt });
  });

  app.get('/api/snapshots', (_req: Request, res: Response) => {
    const list = Array.from(snapshots.values()).map(s => ({ name: s.name, elementCount: s.elements.length, createdAt: s.createdAt }));
    res.json({ success: true, snapshots: list, count: list.length });
  });

  app.get('/api/snapshots/:name', (req: Request, res: Response) => {
    const name = param(req, 'name');
    const snapshot = snapshots.get(name);
    if (!snapshot) return res.status(404).json({ success: false, error: `Snapshot "${name}" not found` });
    res.json({ success: true, snapshot });
  });
}
