import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { LocalDatabase, type RecordTable } from './database.js';
import { emptyScene, type Diagram, type Link, type Note, type Project, type Version, type WorkspaceState } from './model.js';
import type { ChatFile, ChatMessage, ChatThread } from '../agent/types.js';
import logger from '../utils/logger.js';

function read<T>(file: string): T | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed === null || typeof parsed !== 'object') throw new Error('Expected a JSON object or array');
    return parsed as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error(`Cannot import ${file}: ${(error as Error).message}`, { cause: error });
  }
}

function directories(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
}

function atSource<T>(file: string, work: () => T): T {
  try { return work(); }
  catch (error) { throw new Error(`Cannot import ${file}: ${(error as Error).message}`, { cause: error }); }
}

function scene(record: Diagram | Version): void {
  record.scene ??= emptyScene();
  record.scene.elements ??= [];
  record.scene.files ??= {};
  if (!Array.isArray(record.scene.elements) || typeof record.scene.files !== 'object' || record.scene.files === null) {
    throw new Error('Invalid Excalidraw scene');
  }
}

export function normalizeMessage(message: ChatMessage): ChatMessage {
  return { ...message, thinking: message.thinking ?? '', liveText: '', activity: message.activity ?? null, effort: message.effort ?? null };
}

// The import marker and every record commit together. A malformed source leaves
// an empty, retryable database and never causes Scratchpad to hide a failed import.
export function importLegacyJson(db: LocalDatabase, source: string): void {
  db.transaction(() => {
    if (db.get('SELECT source FROM imports LIMIT 1')) return;
    const projectsDir = path.join(source, 'projects');
    const pending: Array<{ dir: string; projectId: string }> = [];
    const insert = (table: RecordTable, file: string, record: { id: string }): void => {
      atSource(file, () => {
        if (!record || typeof record.id !== 'string' || !record.id) throw new Error('Missing record id');
        db.run(`INSERT INTO ${table}(id, data) VALUES (?, ?)`, record.id, JSON.stringify(record));
      });
    };

    for (const projectId of directories(projectsDir)) {
      const dir = path.join(projectsDir, projectId);
      const file = path.join(dir, 'project.json');
      const project = read<Project>(file);
      atSource(file, () => {
        if (!project || project.id !== projectId || typeof project.name !== 'string') throw new Error('Invalid project identity');
      });
      const validProject = project!;
      validProject.rootPath ??= null;
      insert('projects', file, validProject);
      pending.push({ dir, projectId });

      for (const diagramId of directories(path.join(dir, 'diagrams'))) {
        const diagramDir = path.join(dir, 'diagrams', diagramId);
        const diagramFile = path.join(diagramDir, 'diagram.json');
        const diagram = read<Diagram>(diagramFile);
        atSource(diagramFile, () => {
          if (!diagram || diagram.id !== diagramId || diagram.projectId !== projectId) throw new Error('Invalid diagram ownership');
          scene(diagram);
        });
        insert('diagrams', diagramFile, diagram!);
        const versionDir = path.join(diagramDir, 'versions');
        const files = fs.existsSync(versionDir) ? fs.readdirSync(versionDir).filter(file => file.endsWith('.json')).sort() : [];
        for (const name of files) {
          const versionFile = path.join(versionDir, name);
          const version = read<Version>(versionFile);
          atSource(versionFile, () => {
            if (!version || version.diagramId !== diagramId || version.projectId !== projectId) throw new Error('Invalid version ownership');
            scene(version);
          });
          insert('versions', versionFile, version!);
        }
      }
    }

    for (const { dir, projectId } of pending) {
      for (const [name, table] of [['notes.json', 'notes'], ['links.json', 'links']] as const) {
        const file = path.join(dir, name);
        const records = read<Array<Note | Link>>(file) ?? [];
        atSource(file, () => {
          if (!Array.isArray(records)) throw new Error('Expected an array');
          for (const record of records) {
            if (record.projectId !== projectId) throw new Error('Invalid project ownership');
            insert(table, file, record);
          }
        });
      }

      const file = path.join(dir, 'chat.json');
      const raw = read<Partial<ChatFile> & { messages?: ChatMessage[]; sessions?: ChatThread['sessions'] }>(file);
      if (raw !== undefined) atSource(file, () => {
        let threads: ChatThread[];
        if (Array.isArray(raw.threads)) threads = raw.threads;
        else if (Array.isArray(raw.messages)) {
          const id = randomUUID();
          const first = raw.messages[0];
          threads = first ? [{
            id, projectId, title: raw.messages.find(m => m.role === 'user')?.text.replace(/\s+/g, ' ').trim().slice(0, 60) || 'New chat',
            createdAt: first.createdAt, updatedAt: raw.messages.at(-1)!.createdAt,
            sessions: raw.sessions ?? {}, messages: raw.messages.map(message => ({ ...message, threadId: id }))
          }] : [];
        } else throw new Error('Expected chat threads or legacy messages');
        for (const thread of threads) {
          if (thread.projectId !== projectId || !Array.isArray(thread.messages)) throw new Error('Invalid chat ownership');
          thread.sessions ??= {};
          thread.messages = thread.messages.map(message => {
            if (message.projectId !== projectId || message.threadId !== thread.id) throw new Error('Invalid message ownership');
            const normalized = normalizeMessage(message);
            // Old JSON chats retained references to diagrams that were deleted.
            if (normalized.diagramId && !db.get('SELECT id FROM diagrams WHERE id = ?', normalized.diagramId)) normalized.diagramId = null;
            return normalized;
          });
          if (db.get('SELECT id FROM chat_threads WHERE id = ?', thread.id)) throw new Error('Duplicate chat id');
          db.putThread(thread);
        }
      });
    }

    const stateFile = path.join(source, 'workspace.json');
    const state = read<WorkspaceState>(stateFile);
    if (state?.activeDiagramId && db.get('SELECT id FROM diagrams WHERE id = ?', state.activeDiagramId)) {
      db.run('UPDATE workspace SET active_diagram_id = ? WHERE id = 1', state.activeDiagramId);
    }
    db.run('INSERT INTO imports(source, imported_at) VALUES (?, ?)', path.resolve(source), new Date().toISOString());
    logger.info('Legacy workspace import complete', { source, database: db.filename, projects: pending.length });
  });
}
