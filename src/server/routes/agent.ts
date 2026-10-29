import { spawn } from 'child_process';
import fs from 'fs';
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import type { Workspace } from '../../domain/workspace.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../domain/errors.js';
import { displayPath, gitInfo, listDirectories } from '../../domain/folder.js';
import type { AgentManager } from '../../agent/manager.js';
import { detectRunners } from '../../agent/runners.js';
import { param, queryString, sendError } from '../http.js';

const sendInput = z.object({
  message: z.string().min(1).max(20000),
  runner: z.enum(['claude', 'codex']),
  diagramId: z.string().nullable().optional(),
  selectedIds: z.array(z.string()).max(200).optional(),
  model: z.string().max(80).regex(/^[A-Za-z0-9._:\-[\]]*$/, 'model contains unsupported characters').nullable().optional(),
  effort: z.string().max(20).nullable().optional()
});

export function folderInfo(rootPath: string | null): { rootPath: string | null; display: string | null; exists: boolean; git: ReturnType<typeof gitInfo> | null } {
  if (!rootPath) return { rootPath: null, display: null, exists: false, git: null };
  const exists = fs.existsSync(rootPath);
  return { rootPath, display: displayPath(rootPath), exists, git: exists ? gitInfo(rootPath) : null };
}

// Agents and the folder browser touch the local machine; only offer them
// when the server listens on loopback.
export function registerAgentRoutes(app: Express, workspace: Workspace, agents: AgentManager | null): void {
  const local = (): AgentManager => {
    if (!agents) throw new ForbiddenError('Local agents and folder access are disabled because the canvas server listens beyond localhost.');
    return agents;
  };

  app.get('/api/agents', async (req: Request, res: Response) => {
    try {
      if (!agents) return res.json({ success: true, enabled: false, runners: [] });
      res.json({ success: true, enabled: true, runners: await detectRunners(queryString(req, 'refresh') === '1') });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/projects/:pid/chats', (req: Request, res: Response) => {
    try {
      const a = local();
      const projectId = param(req, 'pid');
      workspace.store.getProject(projectId);
      const running = a.runningThread(projectId);
      res.json({ success: true, threads: a.chat.list(projectId, running), runningThreadId: running });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/projects/:pid/chats', (req: Request, res: Response) => {
    try {
      const { title } = z.object({ title: z.string().max(120).optional() }).parse(req.body ?? {});
      res.status(201).json({ success: true, thread: local().createThread(param(req, 'pid'), title) });
    } catch (error) {
      sendError(res, error, 400);
    }
  });

  app.get('/api/projects/:pid/chats/:tid', (req: Request, res: Response) => {
    try {
      const a = local();
      const projectId = param(req, 'pid');
      workspace.store.getProject(projectId);
      const thread = a.chat.get(projectId, param(req, 'tid'));
      res.json({ success: true, thread, running: a.runningThread(projectId) === thread.id });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.patch('/api/projects/:pid/chats/:tid', (req: Request, res: Response) => {
    try {
      const { title } = z.object({ title: z.string().min(1).max(120) }).parse(req.body ?? {});
      res.json({ success: true, thread: local().renameThread(param(req, 'pid'), param(req, 'tid'), title) });
    } catch (error) {
      sendError(res, error, 400);
    }
  });

  app.delete('/api/projects/:pid/chats/:tid', (req: Request, res: Response) => {
    try {
      local().deleteThread(param(req, 'pid'), param(req, 'tid'));
      res.json({ success: true });
    } catch (error) {
      sendError(res, error);
    }
  });

  // tid may be "new" to start a chat with this first message.
  app.post('/api/projects/:pid/chats/:tid/messages', (req: Request, res: Response) => {
    try {
      const input = sendInput.parse(req.body ?? {});
      const result = local().start({ projectId: param(req, 'pid'), threadId: param(req, 'tid'), ...input });
      res.status(202).json({ success: true, threadId: result.thread.id, user: result.user, assistant: result.assistant });
    } catch (error) {
      sendError(res, error, 400);
    }
  });

  app.get('/api/projects/:pid/chats/:tid/messages/:mid/log', (req: Request, res: Response) => {
    try {
      const a = local();
      const projectId = param(req, 'pid');
      const thread = a.chat.get(projectId, param(req, 'tid'));
      const messageId = param(req, 'mid');
      if (!thread.messages.some(m => m.id === messageId)) throw new NotFoundError('Message not found');
      const file = a.chat.runLogPath(projectId, messageId);
      if (!fs.existsSync(file)) throw new NotFoundError('No log for this message');
      res.type('text/plain; charset=utf-8').send(fs.readFileSync(file, 'utf-8'));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/projects/:pid/chat/cancel', (req: Request, res: Response) => {
    try {
      res.json({ success: true, cancelled: local().cancel(param(req, 'pid')) });
    } catch (error) {
      sendError(res, error);
    }
  });

  // ---- folders ------------------------------------------------------------

  app.get('/api/fs/dirs', (req: Request, res: Response) => {
    try {
      local();
      res.json({ success: true, ...listDirectories(queryString(req, 'path'), queryString(req, 'hidden') === '1') });
    } catch (error) {
      sendError(res, error, 400);
    }
  });

  app.get('/api/projects/:pid/folder', (req: Request, res: Response) => {
    try {
      const project = workspace.store.getProject(param(req, 'pid'));
      res.json({ success: true, folder: folderInfo(project.rootPath) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/projects/:pid/reveal', (req: Request, res: Response) => {
    try {
      local();
      const project = workspace.store.getProject(param(req, 'pid'));
      if (!project.rootPath || !fs.existsSync(project.rootPath)) throw new ValidationError('This project has no linked folder');
      const [command, args] = process.platform === 'darwin'
        ? ['open', [project.rootPath]]
        : process.platform === 'win32' ? ['explorer', [project.rootPath]] : ['xdg-open', [project.rootPath]];
      const child = spawn(command, args as string[], { detached: true, stdio: 'ignore' });
      child.on('error', () => { /* no opener available */ });
      child.unref();
      res.json({ success: true });
    } catch (error) {
      sendError(res, error, 400);
    }
  });
}
