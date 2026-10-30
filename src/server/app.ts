import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import path from 'path';
import { packageRoot } from '../core/paths.js';
import type { Server as HttpServer } from 'http';
import { WebSocketServer, type WebSocket } from 'ws';
import logger, { RESOLVED_LOG_FILE_PATH } from '../utils/logger.js';
import { packageVersion } from '../core/version.js';
import type { Workspace } from '../domain/workspace.js';
import { elements, filesRecord } from './live-scene.js';
import { clients } from './broadcast.js';
import { registerElementRoutes } from './routes/elements.js';
import { registerFileRoutes } from './routes/files.js';
import { registerExportRoutes } from './routes/export.js';
import { registerViewportRoutes } from './routes/viewport.js';
import { registerSnapshotRoutes } from './routes/snapshots.js';
import { registerWorkspaceRoutes } from './routes/workspace.js';
import { registerAgentRoutes } from './routes/agent.js';
import { requestGuard } from './guard.js';
import type { AgentManager } from '../agent/manager.js';

export const CANVAS_SERVICE_NAME = 'linemap-canvas';

// dist/server/app.js -> repo root
export const repoRoot = packageRoot();
const frontendDir = path.join(repoRoot, 'dist', 'frontend');

export interface AppOptions {
  loopbackBind: boolean;
  agents: AgentManager | null;
}

export function createApp(workspace: Workspace, options: AppOptions): Express {
  const app: Express = express();
  app.disable('x-powered-by');
  app.use(requestGuard({ loopbackBind: options.loopbackBind }));
  app.use(express.json({ limit: '25mb' }));

  app.use(express.static(frontendDir, { index: false }));
  app.use('/assets/fonts', express.static(path.join(repoRoot, 'node_modules/@excalidraw/excalidraw/dist/prod/fonts')));

  app.get('/health', (_req: Request, res: Response) => {
    const active = workspace.activeDiagram();
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      elements_count: elements.size,
      websocket_clients: clients.size,
      renderers: { node: true, browser: clients.size },
      service: CANVAS_SERVICE_NAME,
      version: packageVersion(),
      pid: process.pid,
      activeDiagramId: active?.id ?? null,
      activeProjectId: active?.projectId ?? null,
      dataDir: workspace.store.dataDir,
      databasePath: workspace.store.db.filename,
      logFile: RESOLVED_LOG_FILE_PATH
    });
  });

  app.get('/api/sync/status', (_req: Request, res: Response) => {
    res.json({
      success: true,
      elementCount: elements.size,
      activeDiagramId: workspace.activeDiagramId,
      timestamp: new Date().toISOString(),
      memoryUsage: {
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
      },
      websocketClients: clients.size
    });
  });

  registerElementRoutes(app, workspace);
  registerFileRoutes(app);
  registerExportRoutes(app);
  registerViewportRoutes(app);
  registerSnapshotRoutes(app);
  registerWorkspaceRoutes(app, workspace);
  registerAgentRoutes(app, workspace, options.agents);

  // Unknown API routes are 404s; everything else is the single-page app so
  // deep links like /p/<project>/d/<diagram> load directly.
  app.all('/api/{*splat}', (_req: Request, res: Response) => {
    res.status(404).json({ success: false, error: 'Not found' });
  });
  app.get('/{*splat}', (req: Request, res: Response) => {
    res.sendFile(path.join(frontendDir, 'index.html'), err => {
      if (err) {
        logger.error('Error serving frontend:', err);
        res.status(404).send('Frontend not built. Run "npm run build" first.');
      }
    });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  });

  return app;
}

export function attachWebSocket(server: HttpServer, workspace: Workspace): WebSocketServer {
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws);
    logger.info('New WebSocket connection established');
    const active = workspace.activeDiagram();
    ws.send(JSON.stringify({
      type: 'initial_elements',
      diagramId: active?.id ?? null,
      elements: Array.from(elements.values()),
      files: filesRecord()
    }));
    ws.send(JSON.stringify({ type: 'sync_status', elementCount: elements.size, timestamp: new Date().toISOString() }));
    ws.send(JSON.stringify({
      type: 'workspace_event',
      event: 'active_changed',
      projectId: active?.projectId ?? null,
      diagramId: active?.id ?? null,
      diagramName: active?.name ?? null
    }));
    ws.on('close', () => {
      clients.delete(ws);
      logger.info('WebSocket connection closed');
    });
    ws.on('error', error => {
      logger.error('WebSocket error:', error);
      clients.delete(ws);
    });
  });
  return wss;
}
