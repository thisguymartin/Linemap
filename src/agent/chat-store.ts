import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { NotFoundError } from '../domain/errors.js';
import type { ChatFile, ChatMessage, ChatThread, ChatThreadSummary } from './types.js';

function nowIso(): string {
  return new Date().toISOString();
}

// Chats per project, stored beside the project's other JSON as chat.json.
export class ChatStore {
  private cache = new Map<string, ChatFile>();

  constructor(private readonly projectDir: (projectId: string) => string) {}

  private file(projectId: string): string {
    return path.join(this.projectDir(projectId), 'chat.json');
  }

  runLogPath(projectId: string, messageId: string): string {
    return path.join(this.projectDir(projectId), 'runs', `${messageId}.log`);
  }

  private load(projectId: string): ChatFile {
    const cached = this.cache.get(projectId);
    if (cached) return cached;
    let file: ChatFile = { threads: [] };
    try {
      const raw = JSON.parse(fs.readFileSync(this.file(projectId), 'utf-8')) as Partial<ChatFile> & { messages?: ChatMessage[]; sessions?: ChatThread['sessions'] };
      if (Array.isArray(raw.threads)) file = { threads: raw.threads };
      else if (Array.isArray(raw.messages) && raw.messages.length) {
        // v1 file: one conversation per project. Becomes the first thread.
        const id = randomUUID();
        file = { threads: [{
          id, projectId, title: titleFrom(raw.messages), createdAt: raw.messages[0]!.createdAt, updatedAt: raw.messages.at(-1)!.createdAt,
          sessions: raw.sessions ?? {}, messages: raw.messages.map(m => ({ ...m, threadId: id }))
        }] };
      }
    } catch { /* no chats yet */ }
    for (const thread of file.threads) {
      for (const message of thread.messages) {
        message.thinking ??= '';
        message.liveText ??= '';
        message.activity ??= null;
        message.effort ??= null;
        // A server that stopped mid-run leaves "running" messages behind.
        if (message.status === 'running') {
          message.status = 'error';
          message.error = message.error ?? 'Interrupted: the canvas server stopped during this run.';
          message.activity = null;
        }
      }
    }
    this.cache.set(projectId, file);
    return file;
  }

  save(projectId: string): void {
    const file = this.cache.get(projectId);
    if (!file) return;
    const dir = this.projectDir(projectId);
    if (!fs.existsSync(dir)) {
      this.cache.delete(projectId);
      return;
    }
    const target = this.file(projectId);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    // Live-only fields are not worth persisting mid-run.
    fs.writeFileSync(tmp, JSON.stringify(file, (key, value) => (key === 'liveText' ? '' : value), 2), 'utf-8');
    fs.renameSync(tmp, target);
  }

  list(projectId: string, runningThreadId: string | null): ChatThreadSummary[] {
    return this.load(projectId).threads
      .map(t => ({
        id: t.id,
        title: t.title,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        messageCount: t.messages.length,
        runners: [...new Set(t.messages.map(m => m.runner).filter((r): r is NonNullable<typeof r> => !!r))],
        running: t.id === runningThreadId
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(projectId: string, threadId: string): ChatThread {
    const thread = this.load(projectId).threads.find(t => t.id === threadId);
    if (!thread) throw new NotFoundError(`Chat ${threadId} not found`);
    return thread;
  }

  create(projectId: string, title?: string): ChatThread {
    const file = this.load(projectId);
    const createdAt = nowIso();
    const thread: ChatThread = { id: randomUUID(), projectId, title: title?.trim() || 'New chat', createdAt, updatedAt: createdAt, sessions: {}, messages: [] };
    file.threads.push(thread);
    this.save(projectId);
    return thread;
  }

  rename(projectId: string, threadId: string, title: string): ChatThread {
    const thread = this.get(projectId, threadId);
    thread.title = title.trim().slice(0, 120) || thread.title;
    this.save(projectId);
    return thread;
  }

  delete(projectId: string, threadId: string): void {
    const file = this.load(projectId);
    const thread = this.get(projectId, threadId);
    file.threads = file.threads.filter(t => t.id !== threadId);
    this.save(projectId);
    for (const message of thread.messages) fs.rmSync(this.runLogPath(projectId, message.id), { force: true });
  }

  forget(projectId: string): void {
    this.cache.delete(projectId);
  }
}

export function titleFrom(messages: ChatMessage[]): string {
  const first = messages.find(m => m.role === 'user')?.text ?? 'New chat';
  const line = first.replace(/\s+/g, ' ').trim();
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}
