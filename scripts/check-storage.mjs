#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceStore, ChatStore, LocalDatabase } from '../dist/testing.js';

const date = '2026-10-29T12:00:00.000Z';
const scene = { elements: [{ id: 'shape', type: 'rectangle', x: 0, y: 0, width: 50, height: 40, customData: { tags: ['system'], note: 'keep this' } }], files: { image: { id: 'image', dataURL: 'data:image/png;base64,synthetic' } } };
const project = { id: 'p_old', name: 'Legacy', slug: 'legacy', description: 'Preserve me', tags: ['old'], color: '#123456', rootPath: null, createdAt: date, updatedAt: date };
const diagram = { id: 'd_old', projectId: project.id, name: 'Main', description: '', tags: [], createdAt: date, updatedAt: date, elementCount: 1, versionCount: 1, latestVersion: 1, latestConfirmedVersion: 1, scene };
const version = { id: 'v_old', projectId: project.id, diagramId: diagram.id, number: 1, label: 'Checkpoint', note: 'verified', author: 'human', confirmed: true, confirmedAt: date, createdAt: date, elementCount: 1, scene };
const note = { id: 'n_old', projectId: project.id, diagramId: diagram.id, author: 'human', role: 'human', body: 'Question', elementIds: ['shape'], tags: [], resolved: false, createdAt: date, updatedAt: date };
const message = { id: 'm_old', threadId: 't_old', projectId: project.id, diagramId: diagram.id, role: 'user', runner: 'claude', text: 'Keep the session', parts: [{ type: 'text', text: 'Keep the session' }], selectedIds: ['shape'], status: 'done', error: null, createdAt: date, finishedAt: date, durationMs: null, costUsd: null, model: null, effort: null, thinking: '', liveText: '', activity: null };
const thread = { id: 't_old', projectId: project.id, title: 'Existing chat', createdAt: date, updatedAt: date, sessions: { claude: 'claude-session', codex: 'codex-session' }, messages: [message] };
let passed = 0;

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

function fixture(root) {
  const source = path.join(root, 'legacy');
  const dir = path.join(source, 'projects', project.id);
  const diagramFile = path.join(dir, 'diagrams', diagram.id, 'diagram.json');
  write(path.join(dir, 'project.json'), project);
  write(diagramFile, diagram);
  write(path.join(dir, 'diagrams', diagram.id, 'versions', '0001-v_old.json'), version);
  write(path.join(dir, 'notes.json'), [note]);
  write(path.join(dir, 'links.json'), []);
  write(path.join(dir, 'chat.json'), { threads: [thread] });
  write(path.join(source, 'workspace.json'), { activeDiagramId: diagram.id });
  return { source, dir, diagramFile };
}

function check(name, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linemap-storage-'));
  const connections = [];
  const open = (dataDir = path.join(root, 'local'), source = dataDir) => {
    const store = new WorkspaceStore(dataDir, source);
    connections.push(store);
    return store;
  };
  try {
    fn({ root, open });
    passed++;
    console.log(`ok - ${name}`);
  } finally {
    for (const store of connections) store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

check('legacy import preserves scenes, versions, notes, chats, sessions and source files', ({ root, open }) => {
  const { source, diagramFile } = fixture(root);
  const original = fs.readFileSync(diagramFile, 'utf8');
  const store = open(path.join(root, 'local'), source);
  store.load();
  const chat = new ChatStore(store.db, id => store.projectDir(id));
  assert.deepEqual(store.getDiagram(diagram.id), diagram);
  assert.deepEqual(store.getVersion(version.id), version);
  assert.deepEqual(store.getNote(note.id), note);
  assert.deepEqual(store.getState(), { activeDiagramId: diagram.id });
  assert.deepEqual(chat.get(project.id, thread.id), thread);
  assert.equal(fs.readFileSync(diagramFile, 'utf8'), original);
  assert.deepEqual(store.db.all('PRAGMA foreign_key_check'), []);
  assert.equal(store.db.get('PRAGMA integrity_check').integrity_check, 'ok');
});

check('import runs once; edits and deletions survive reopening without resurrecting JSON', ({ root, open }) => {
  const { source, diagramFile } = fixture(root);
  const local = path.join(root, 'local');
  const store = open(local, source);
  store.load();
  store.updateProject(project.id, { name: 'Renamed locally' });
  store.deleteDiagram(diagram.id);
  write(diagramFile, { ...diagram, name: 'Stale JSON' });
  const reopened = open(local, source);
  reopened.load();
  assert.equal(reopened.getProject(project.id).name, 'Renamed locally');
  assert.throws(() => reopened.getDiagram(diagram.id), /not found/);
  assert.equal(reopened.listNotes(project.id).length, 0);
  assert.equal(reopened.db.threadMessages(thread.id)[0].diagramId, null);
  assert.equal(fs.existsSync(diagramFile), true);
  assert.equal(reopened.db.all('SELECT * FROM imports').length, 1);
});

check('malformed JSON rolls back the whole import and can be repaired and retried', ({ root, open }) => {
  const { source, dir } = fixture(root);
  const file = path.join(dir, 'notes.json');
  fs.writeFileSync(file, '{broken');
  const store = open(path.join(root, 'local'), source);
  assert.throws(() => store.load(), error => error.message.includes(file));
  assert.equal(store.listProjects().length, 0);
  assert.equal(store.db.all('SELECT * FROM imports').length, 0);
  write(file, [note]);
  store.load();
  assert.equal(store.getProject(project.id).noteCount, 1);
});

check('invalid ownership and duplicate records fail import without partial data', ({ root, open }) => {
  const { source, dir } = fixture(root);
  const file = path.join(dir, 'notes.json');
  write(file, [note, note]);
  const store = open(path.join(root, 'local'), source);
  assert.throws(() => store.load(), error => error.message.includes(file));
  assert.equal(store.listProjects().length, 0);
  write(file, [{ ...note, diagramId: 'missing-diagram' }]);
  assert.throws(() => store.load(), /FOREIGN KEY/i);
  assert.equal(store.listProjects().length, 0);
});

check('v1 chat import keeps message order and CLI sessions, clears deleted diagram refs', ({ root, open }) => {
  const { source, dir } = fixture(root);
  const first = { ...message }; delete first.threadId;
  const second = { ...first, id: 'm_second', role: 'assistant', status: 'running', diagramId: 'deleted', liveText: 'unfinished' };
  write(path.join(dir, 'chat.json'), { messages: [first, second], sessions: thread.sessions });
  const store = open(path.join(root, 'local'), source);
  store.load();
  const chat = new ChatStore(store.db, id => store.projectDir(id));
  const [summary] = chat.list(project.id, null);
  const imported = chat.get(project.id, summary.id);
  assert.deepEqual(imported.sessions, thread.sessions);
  assert.deepEqual(imported.messages.map(m => m.id), [first.id, second.id]);
  assert.equal(imported.messages[1].diagramId, null);
  assert.equal(imported.messages[1].liveText, '');
  assert.equal(imported.messages[1].status, 'error');
  assert.match(imported.messages[1].error, /Interrupted/);
  assert.equal(store.db.threadMessages(summary.id)[1].status, 'error');
});

check('SQLite enforces project ownership and cascades without losing chat history', ({ root, open }) => {
  const store = open(); store.load();
  const first = store.createProject({ name: 'First' });
  const other = store.createProject({ name: 'Other' });
  const a = store.createDiagram(first.id, { name: 'A', scene });
  const b = store.createDiagram(first.id, { name: 'B' });
  const foreign = store.createDiagram(other.id, { name: 'Foreign' });
  const v = store.createVersion(a.id, scene, {});
  const pinned = store.createNote(first.id, { body: 'Pinned', diagramId: a.id });
  const unpinned = store.createNote(first.id, { body: 'Project note' });
  store.createLink(first.id, { from: { diagramId: a.id }, to: { diagramId: b.id } });
  assert.throws(() => store.db.put('notes', { ...pinned, id: 'n_bad', diagramId: foreign.id }), /FOREIGN KEY/i);
  assert.throws(() => store.db.put('versions', { ...store.getVersion(v.id), id: 'v_bad', projectId: other.id }), /FOREIGN KEY|UNIQUE/i);
  assert.throws(() => store.createLink(first.id, { from: { diagramId: a.id }, to: { diagramId: foreign.id } }), /another project/);
  const chat = new ChatStore(store.db, id => store.projectDir(id));
  const t = chat.create(first.id);
  t.messages.push({ ...message, id: 'live-message', projectId: first.id, threadId: t.id, diagramId: a.id, status: 'running' });
  chat.save(first.id, t);
  assert.throws(() => store.db.run('UPDATE chat_messages SET diagram_id = ? WHERE id = ?', foreign.id, 'live-message'), /another project/);
  store.setActiveDiagram(a.id);
  store.deleteDiagram(a.id);
  assert.equal(store.getState().activeDiagramId, null);
  assert.equal(store.listLinks(first.id).length, 0);
  assert.equal(store.listNotes(first.id)[0].id, unpinned.id);
  assert.throws(() => store.getVersion(v.id), /not found/);
  t.messages[0].status = 'done';
  chat.save(first.id, t);
  assert.equal(chat.get(first.id, t.id).messages[0].diagramId, null);
  store.deleteProject(first.id);
  assert.equal(store.db.all('SELECT * FROM chat_threads').length, 0);
  assert.equal(store.db.all('SELECT * FROM chat_messages').length, 0);
  assert.equal(store.getProject(other.id).diagramCount, 1);
  assert.deepEqual(store.db.all('PRAGMA foreign_key_check'), []);
});

check('a failed related write rolls back; fresh reads observe another connection', ({ root, open }) => {
  const store = open(); store.load();
  const p = store.createProject({ name: 'Atomic' });
  store.db.run("CREATE TRIGGER reject_touch BEFORE UPDATE ON projects BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END");
  assert.throws(() => store.createDiagram(p.id, { name: 'Rolled back' }), /synthetic write failure/);
  assert.equal(store.getProject(p.id).diagramCount, 0);
  store.db.run('DROP TRIGGER reject_touch');
  const d = store.createDiagram(p.id, { name: 'Durable', scene });
  const second = open(); second.load();
  second.updateDiagram(d.id, { name: 'Updated elsewhere' });
  assert.equal(store.getDiagram(d.id).name, 'Updated elsewhere');
  const v1 = store.createVersion(d.id, scene, { confirm: true });
  const v2 = second.createVersion(d.id, scene, {});
  assert.deepEqual([v1.number, v2.number], [1, 2]);
  assert.equal(store.getDiagram(d.id).versionCount, 2);
  assert.equal(store.getDiagram(d.id).latestConfirmedVersion, 1);
});

check('imported run logs remain readable and are preserved when deleting a chat', ({ root, open }) => {
  const { source, dir } = fixture(root);
  const originalLog = path.join(dir, 'runs', `${message.id}.log`);
  fs.mkdirSync(path.dirname(originalLog), { recursive: true });
  fs.writeFileSync(originalLog, 'synthetic original log');
  const store = open(path.join(root, 'local'), source); store.load();
  const chat = new ChatStore(store.db, id => store.projectDir(id), id => path.join(source, 'projects', id));
  assert.equal(chat.runLogPath(project.id, message.id), originalLog);
  chat.delete(project.id, thread.id);
  assert.equal(fs.readFileSync(originalLog, 'utf8'), 'synthetic original log');
  assert.equal(chat.list(project.id, null).length, 0);
});

check('database versions newer than this app are refused', ({ root, open }) => {
  const store = open(); store.load();
  store.db.run('PRAGMA user_version = 999');
  assert.throws(() => new LocalDatabase(path.join(root, 'local')), /newer Linemap/);
});

console.log(`All ${passed} SQLite storage checks passed`);
