import fs from 'node:fs';
import path from 'node:path';
import type { ChatMessage, ChatThread } from '../agent/types.js';

type SqlValue = string | number | null;
interface SqliteConnection {
  exec(sql: string): unknown;
  prepare(sql: string): {
    all(...values: SqlValue[]): unknown[];
    get(...values: SqlValue[]): unknown;
    run(...values: SqlValue[]): unknown;
  };
  close(): void;
}

const Driver = process.versions.bun
  ? (await import('bun:sqlite')).Database
  : (await import('node:sqlite')).DatabaseSync;

export type RecordTable = 'projects' | 'diagrams' | 'versions' | 'notes' | 'links' | 'chat_threads';

const schema = `
CREATE TABLE imports (source TEXT PRIMARY KEY, imported_at TEXT NOT NULL);
CREATE TABLE projects (
  id TEXT PRIMARY KEY NOT NULL,
  data TEXT NOT NULL CHECK(json_valid(data) AND json_extract(data, '$.id') = id),
  slug TEXT GENERATED ALWAYS AS (json_extract(data, '$.slug')) STORED NOT NULL UNIQUE
);
CREATE TABLE diagrams (
  id TEXT PRIMARY KEY NOT NULL,
  data TEXT NOT NULL CHECK(json_valid(data) AND json_extract(data, '$.id') = id),
  project_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.projectId')) STORED NOT NULL,
  UNIQUE(project_id, id),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE TABLE versions (
  id TEXT PRIMARY KEY NOT NULL,
  data TEXT NOT NULL CHECK(json_valid(data) AND json_extract(data, '$.id') = id),
  project_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.projectId')) STORED NOT NULL,
  diagram_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.diagramId')) STORED NOT NULL,
  number INTEGER GENERATED ALWAYS AS (json_extract(data, '$.number')) STORED NOT NULL CHECK(number > 0),
  UNIQUE(diagram_id, number),
  FOREIGN KEY(project_id, diagram_id) REFERENCES diagrams(project_id, id) ON DELETE CASCADE
);
CREATE TABLE notes (
  id TEXT PRIMARY KEY NOT NULL,
  data TEXT NOT NULL CHECK(json_valid(data) AND json_extract(data, '$.id') = id),
  project_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.projectId')) STORED NOT NULL,
  diagram_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.diagramId')) STORED,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, diagram_id) REFERENCES diagrams(project_id, id) ON DELETE CASCADE
);
CREATE TABLE links (
  id TEXT PRIMARY KEY NOT NULL,
  data TEXT NOT NULL CHECK(json_valid(data) AND json_extract(data, '$.id') = id),
  project_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.projectId')) STORED NOT NULL,
  from_diagram_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.from.diagramId')) STORED NOT NULL,
  to_diagram_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.to.diagramId')) STORED NOT NULL,
  FOREIGN KEY(project_id, from_diagram_id) REFERENCES diagrams(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, to_diagram_id) REFERENCES diagrams(project_id, id) ON DELETE CASCADE
);
CREATE TABLE workspace (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  active_diagram_id TEXT REFERENCES diagrams(id) ON DELETE SET NULL
);
INSERT INTO workspace VALUES (1, NULL);
CREATE TABLE chat_threads (
  id TEXT PRIMARY KEY NOT NULL,
  data TEXT NOT NULL CHECK(json_valid(data) AND json_extract(data, '$.id') = id),
  project_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.projectId')) STORED NOT NULL,
  UNIQUE(project_id, id),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY NOT NULL,
  data TEXT NOT NULL CHECK(json_valid(data) AND json_extract(data, '$.id') = id),
  project_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.projectId')) STORED NOT NULL,
  thread_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.threadId')) STORED NOT NULL,
  diagram_id TEXT REFERENCES diagrams(id) ON DELETE SET NULL,
  position INTEGER NOT NULL CHECK(position >= 0),
  UNIQUE(thread_id, position),
  FOREIGN KEY(project_id, thread_id) REFERENCES chat_threads(project_id, id) ON DELETE CASCADE
);
CREATE TRIGGER message_diagram_project_insert BEFORE INSERT ON chat_messages
WHEN NEW.diagram_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM diagrams WHERE id = NEW.diagram_id AND project_id = NEW.project_id
)
BEGIN SELECT RAISE(ABORT, 'Message diagram belongs to another project'); END;
CREATE TRIGGER message_diagram_project_update BEFORE UPDATE ON chat_messages
WHEN NEW.diagram_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM diagrams WHERE id = NEW.diagram_id AND project_id = NEW.project_id
)
BEGIN SELECT RAISE(ABORT, 'Message diagram belongs to another project'); END;
CREATE INDEX versions_project ON versions(project_id);
CREATE INDEX notes_project_diagram ON notes(project_id, diagram_id);
CREATE INDEX links_from ON links(project_id, from_diagram_id);
CREATE INDEX links_to ON links(project_id, to_diagram_id);
CREATE INDEX chat_messages_diagram ON chat_messages(diagram_id);
PRAGMA user_version = 1;
`;

// One synchronous connection per canvas server. JSON keeps the Excalidraw and
// chat payloads portable; generated columns make their ownership enforceable.
export class LocalDatabase {
  readonly filename: string;
  private readonly connection: SqliteConnection;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.filename = path.join(dataDir, 'linemap.db');
    this.connection = new Driver(this.filename);
    try {
      this.connection.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
      this.transaction(() => {
        const version = this.get<{ user_version: number }>('PRAGMA user_version')!.user_version;
        if (version > 1) throw new Error(`Database ${this.filename} needs a newer Linemap (schema ${version})`);
        if (version === 0) this.connection.exec(schema);
      });
    } catch (error) {
      this.connection.close();
      throw error;
    }
  }

  all<T>(sql: string, ...values: SqlValue[]): T[] {
    return this.connection.prepare(sql).all(...values) as T[];
  }

  get<T>(sql: string, ...values: SqlValue[]): T | undefined {
    return this.connection.prepare(sql).get(...values) as T | undefined;
  }

  run(sql: string, ...values: SqlValue[]): void {
    this.connection.prepare(sql).run(...values);
  }

  transaction<T>(work: () => T): T {
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.connection.exec('COMMIT');
      return result;
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }

  records<T>(table: RecordTable, where = '', ...values: SqlValue[]): T[] {
    return this.all<{ data: string }>(`SELECT data FROM ${table} ${where}`, ...values)
      .map(row => JSON.parse(row.data) as T);
  }

  put(table: RecordTable, record: { id: string }): void {
    this.run(`INSERT INTO ${table}(id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, record.id, JSON.stringify(record));
  }

  threadMessages(threadId: string): ChatMessage[] {
    return this.all<{ data: string; diagram_id: string | null }>(
      'SELECT data, diagram_id FROM chat_messages WHERE thread_id = ? ORDER BY position', threadId
    ).map(row => ({ ...JSON.parse(row.data) as ChatMessage, diagramId: row.diagram_id }));
  }

  // Caller owns the transaction so import can include all threads atomically.
  putThread(thread: ChatThread): void {
    const { messages, ...meta } = thread;
    this.put('chat_threads', meta);
    this.run('DELETE FROM chat_messages WHERE thread_id = ?', thread.id);
    messages.forEach((message, position) => {
      this.run('INSERT INTO chat_messages(id, data, diagram_id, position) VALUES (?, ?, ?, ?)',
        message.id, JSON.stringify({ ...message, liveText: '' }), message.diagramId, position);
    });
  }

  close(): void {
    this.connection.close();
  }
}
