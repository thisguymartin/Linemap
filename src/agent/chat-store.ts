import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { NotFoundError } from '../domain/errors.js';
import { LocalDatabase } from '../domain/database.js';
import { normalizeMessage } from '../domain/import-json.js';
import type { ChatMessage, ChatThread, ChatThreadSummary } from './types.js';

function nowIso(): string {
  return new Date().toISOString();
}

type ThreadMeta = Omit<ChatThread, 'messages'>;

export class ChatStore {
  // Streaming callbacks hold mutable references until their run finishes.
  private running = new Map<string, ChatThread>();

  constructor(
    private readonly db: LocalDatabase,
    private readonly projectDir: (projectId: string) => string,
    private readonly legacyProjectDir = projectDir
  ) {
    this.db.transaction(() => {
      for (const meta of this.db.records<ThreadMeta>('chat_threads')) {
        const messages = this.db.threadMessages(meta.id).map(normalizeMessage);
        let interrupted = false;
        for (const message of messages) {
          if (message.status !== 'running') continue;
          message.status = 'error';
          message.error ??= 'Interrupted: the canvas server stopped during this run.';
          message.activity = null;
          interrupted = true;
        }
        if (interrupted) this.db.putThread({ ...meta, messages });
      }
    });
  }

  runLogPath(projectId: string, messageId: string): string {
    const local = path.join(this.projectDir(projectId), 'runs', `${messageId}.log`);
    const legacy = path.join(this.legacyProjectDir(projectId), 'runs', `${messageId}.log`);
    return fs.existsSync(local) || !fs.existsSync(legacy) ? local : legacy;
  }

  save(projectId: string, thread: ChatThread): void {
    const saved = this.db.transaction(() => {
      if (!this.db.get('SELECT id FROM projects WHERE id = ?', projectId)) {
        this.running.delete(thread.id);
        return false;
      }
      if (thread.projectId !== projectId) throw new Error('Chat belongs to another project');
      for (const message of thread.messages) {
        if (message.diagramId && !this.db.get('SELECT id FROM diagrams WHERE id = ?', message.diagramId)) message.diagramId = null;
      }
      this.db.putThread(thread);
      return true;
    });
    if (!saved) return;
    if (thread.messages.some(message => message.status === 'running')) this.running.set(thread.id, thread);
    else this.running.delete(thread.id);
  }

  list(projectId: string, runningThreadId: string | null): ChatThreadSummary[] {
    return this.db.records<ThreadMeta>('chat_threads', 'WHERE project_id = ?', projectId)
      .map(meta => {
        const thread = this.get(projectId, meta.id);
        return {
          id: thread.id, title: thread.title, createdAt: thread.createdAt, updatedAt: thread.updatedAt,
          messageCount: thread.messages.length,
          runners: [...new Set(thread.messages.map(message => message.runner).filter(runner => runner !== null))],
          running: thread.id === runningThreadId
        };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(projectId: string, threadId: string): ChatThread {
    const [meta] = this.db.records<ThreadMeta>('chat_threads', 'WHERE id = ? AND project_id = ?', threadId, projectId);
    if (!meta) throw new NotFoundError(`Chat ${threadId} not found`);
    const running = this.running.get(threadId);
    if (running) {
      // A diagram may have been deleted during the run. Keep the callback's
      // message objects, but clear references that SQLite has already cleared.
      for (const message of running.messages) {
        if (message.diagramId && !this.db.get('SELECT id FROM diagrams WHERE id = ?', message.diagramId)) message.diagramId = null;
      }
      return running;
    }
    return { ...meta, messages: this.db.threadMessages(threadId).map(normalizeMessage) };
  }

  create(projectId: string, title?: string): ChatThread {
    if (!this.db.get('SELECT id FROM projects WHERE id = ?', projectId)) throw new NotFoundError(`Project ${projectId} not found`);
    const createdAt = nowIso();
    const thread: ChatThread = { id: randomUUID(), projectId, title: title?.trim() || 'New chat', createdAt, updatedAt: createdAt, sessions: {}, messages: [] };
    this.save(projectId, thread);
    return thread;
  }

  rename(projectId: string, threadId: string, title: string): ChatThread {
    const thread = this.get(projectId, threadId);
    thread.title = title.trim().slice(0, 120) || thread.title;
    this.save(projectId, thread);
    return thread;
  }

  delete(projectId: string, threadId: string): void {
    const thread = this.get(projectId, threadId);
    this.db.run('DELETE FROM chat_threads WHERE id = ? AND project_id = ?', threadId, projectId);
    this.running.delete(threadId);
    for (const message of thread.messages) fs.rmSync(path.join(this.projectDir(projectId), 'runs', `${message.id}.log`), { force: true });
  }

  forget(projectId: string): void {
    for (const [id, thread] of this.running) if (thread.projectId === projectId) this.running.delete(id);
  }
}

export function titleFrom(messages: ChatMessage[]): string {
  const first = messages.find(m => m.role === 'user')?.text ?? 'New chat';
  const line = first.replace(/\s+/g, ' ').trim();
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}
