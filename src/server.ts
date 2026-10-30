#!/usr/bin/env bun
import { createServer } from 'http';
import net from 'net';
import logger from './utils/logger.js';
import { isMainModule } from './core/entry.js';
import { writePidFile, removePidFile } from './core/pidfile.js';
import { DATA_DIR, LEGACY_DATA_DIR } from './core/config.js';
import { WorkspaceStore } from './domain/store.js';
import { Workspace } from './domain/workspace.js';
import { createApp, attachWebSocket } from './server/app.js';
import { entryPath } from './core/paths.js';
import { AgentManager } from './agent/manager.js';

// Canvas server entry point: HTTP API + WebSocket sync + static frontend,
// backed by the local SQLite workspace. Importing this module never starts it; the
// CLI and MCP server spawn `dist/server.js` as a child process instead.

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '127.0.0.1';
const LOOPBACK_GUARD_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '::']);
const LOOPBACK_ADDRESSES = ['127.0.0.1', '::1'];

function formatHostForUrl(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false;
    const socket = net.createConnection({ host, port });
    const finish = (isOpen: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(isOpen);
    };
    socket.setTimeout(250);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function findExistingLoopbackListener(port: number): Promise<string | null> {
  for (const host of LOOPBACK_ADDRESSES) {
    if (await canConnect(host, port)) return host;
  }
  return null;
}

export async function startServer(): Promise<void> {
  if (LOOPBACK_GUARD_HOSTS.has(HOST)) {
    const existingHost = await findExistingLoopbackListener(PORT);
    if (existingHost) {
      logger.error(
        `Refusing to start canvas server on ${formatHostForUrl(HOST)}:${PORT}: ` +
        `${formatHostForUrl(existingHost)}:${PORT} is already listening. ` +
        'This prevents duplicate IPv4/IPv6 canvas servers from splitting state.'
      );
      process.exit(1);
    }
  }

  const workspace = new Workspace(new WorkspaceStore(DATA_DIR, LEGACY_DATA_DIR));
  workspace.start();

  // Agents (local claude / codex CLIs) and folder access only on loopback.
  const loopbackBind = ['127.0.0.1', '::1', 'localhost'].includes(HOST);
  const canvasHost = HOST === '0.0.0.0' || HOST === '::' || HOST === 'localhost' ? '127.0.0.1' : formatHostForUrl(HOST);
  const agents = loopbackBind
    ? new AgentManager(workspace, {
        mcpEntry: entryPath('bin'),
        canvasUrl: `http://${canvasHost}:${PORT}`,
        timeoutMs: Number(process.env.EXCALIDRAW_AGENT_TIMEOUT_MS) || 15 * 60_000
      })
    : null;

  const app = createApp(workspace, { loopbackBind, agents });
  const server = createServer(app);
  attachWebSocket(server, workspace);

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      const address = (error as NodeJS.ErrnoException & { address?: string }).address || HOST;
      logger.error(`Canvas server port ${PORT} is already in use on ${formatHostForUrl(address)}.`);
    } else if (error.code === 'EACCES') {
      logger.error(`Canvas server cannot bind ${formatHostForUrl(HOST)}:${PORT}: permission denied.`);
    } else {
      logger.error('Failed to start canvas server:', error);
    }
    process.exit(1);
  });

  let ownsPidFile = false;
  server.listen(PORT, HOST, () => {
    const hostForUrl = formatHostForUrl(HOST);
    logger.info(`Canvas server running on http://${hostForUrl}:${PORT} (data: ${DATA_DIR})`);
    writePidFile(PORT, process.pid);
    ownsPidFile = true;
  });

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info(`Received ${signal}, shutting down canvas server`);
    agents?.stopAll();
    workspace.flush();
    if (ownsPidFile) removePidFile(PORT);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('exit', () => {
    workspace.flush();
    workspace.store.close();
    if (ownsPidFile) removePidFile(PORT);
  });
}

if (isMainModule(import.meta.url)) {
  void startServer();
}
