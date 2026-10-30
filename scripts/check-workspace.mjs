#!/usr/bin/env node
// Workspace checks: projects, diagrams, versions, notes, links, tags, the
// project context digest, and persistence across a server restart. Drives
// a real `dist/server.js` over HTTP against a throwaway data directory.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const serverPath = join(repoRoot, 'dist', 'server.js');
const port = Number(process.env.PORT || 36000 + Math.floor(Math.random() * 1000));
const baseUrl = `http://127.0.0.1:${port}`;
process.env.EXPRESS_SERVER_URL = baseUrl;
process.env.EXCALIDRAW_NO_AUTOSTART = '1';
const { LocalDatabase } = await import('../dist/testing.js');
const dataDir = fs.mkdtempSync(join(os.tmpdir(), 'excalidraw-workspace-'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function api(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, body: json };
}

async function ok(method, path, body) {
  const result = await api(method, path, body);
  assert(result.status < 400, `${method} ${path} -> HTTP ${result.status}: ${JSON.stringify(result.body)}`);
  return result.body;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function startServer() {
  const child = spawn(process.execPath, [serverPath], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_LEVEL: 'error', EXCALIDRAW_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  return { child, output: () => output.trim() };
}

async function waitForHealth(child, getOutput) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Canvas server exited before health check.\n${getOutput()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return response.json();
    } catch { /* booting */ }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${baseUrl}/health`);
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await new Promise(resolve => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(true);
    console.log(`ok - ${name}`);
  } catch (error) {
    results.push(false);
    console.error(`not ok - ${name}`);
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
  }
}

const state = {};

let server = startServer();
try {
  const health = await waitForHealth(server.child, server.output);

  await check('first run lands on a default project and diagram', async () => {
    assert(health.service === 'linemap-canvas', 'health identity');
    assert(health.activeDiagramId, 'no active diagram after first start');
    const { projects } = await ok('GET', '/api/projects');
    assert(projects.length === 1 && projects[0].name === 'Scratchpad', 'default project missing');
    const ws = await ok('GET', '/api/workspace');
    assert(ws.activeDiagram?.name === 'Untitled', 'default diagram missing');
    state.scratchProject = projects[0].id;
    state.scratchDiagram = ws.activeDiagramId;
  });

  await check('create a project and a diagram, which becomes active', async () => {
    const { project } = await ok('POST', '/api/projects', { name: 'Water Heater', description: 'How a gas water heater works', tags: ['HVAC', 'plumbing'] });
    assert(project.slug === 'water-heater', `slug was ${project.slug}`);
    assert(JSON.stringify(project.tags) === '["hvac","plumbing"]', 'tags not normalized');
    state.project = project.id;
    const { diagram, active } = await ok('POST', `/api/projects/${project.id}/diagrams`, { name: 'Overview', tags: ['system'] });
    assert(active === true, 'new diagram should be active');
    state.overview = diagram.id;
    const ws = await ok('GET', '/api/workspace');
    assert(ws.activeDiagramId === diagram.id, 'workspace active mismatch');
    const { elements } = await ok('GET', '/api/elements');
    assert(elements.length === 0, 'fresh diagram should be empty');
  });

  await check('live edits autosave into the active diagram', async () => {
    await ok('POST', '/api/elements/batch', { elements: [
      { id: 'tank', type: 'rectangle', x: 100, y: 100, width: 200, height: 120, label: { text: 'Tank' } },
      { id: 'burner', type: 'ellipse', x: 100, y: 320, width: 160, height: 80, label: { text: 'Burner' } },
      { id: 'heat', type: 'arrow', x: 0, y: 0, start: { id: 'burner' }, end: { id: 'tank' } }
    ] });
    await sleep(900);
    const { diagram } = await ok('GET', `/api/diagrams/${state.overview}`);
    assert(diagram.elementCount === 3, `autosave stored ${diagram.elementCount} elements`);
    const db = new LocalDatabase(dataDir);
    try {
      const [saved] = db.records('diagrams', 'WHERE id = ?', state.overview);
      assert(saved.scene.elements.length === 3, 'scene not persisted in SQLite');
    } finally { db.close(); }
  });

  await check('save, confirm, restore and delete versions', async () => {
    const { version: v1 } = await ok('POST', `/api/diagrams/${state.overview}/versions`, { label: 'first pass', author: 'claude', note: 'tank + burner' });
    assert(v1.number === 1 && v1.confirmed === false, 'v1 shape');
    state.v1 = v1.id;
    await ok('PUT', '/api/elements/tank', { x: 500 });
    await ok('POST', '/api/elements', { id: 'valve', type: 'diamond', x: 400, y: 400, width: 80, height: 80, label: { text: 'Valve' } });
    const { version: v2 } = await ok('POST', `/api/diagrams/${state.overview}/versions`, { label: 'moved tank', confirm: true });
    assert(v2.number === 2 && v2.confirmed === true && v2.confirmedAt, 'v2 should be confirmed');
    state.v2 = v2.id;
    const { diagram } = await ok('GET', `/api/diagrams/${state.overview}`);
    assert(diagram.versionCount === 2 && diagram.latestVersion === 2 && diagram.latestConfirmedVersion === 2, `version stats ${JSON.stringify(diagram)}`);

    const restored = await ok('POST', `/api/versions/${state.v1}/restore`, {});
    assert(restored.version.number === 1, 'restore returned wrong version');
    const { elements } = await ok('GET', '/api/elements');
    const tank = elements.find(e => e.id === 'tank');
    assert(elements.length === 3 && tank.x === 100, 'restore did not bring back v1 scene');

    const full = await ok('GET', `/api/versions/${state.v2}`);
    assert(full.version.scene.elements.length === 4, 'v2 scene should still have 4 elements');
    const unconfirmed = await ok('PATCH', `/api/versions/${state.v2}`, { confirmed: false });
    assert(unconfirmed.version.confirmed === false, 'unconfirm failed');
    await ok('DELETE', `/api/versions/${state.v2}`);
    const { versions } = await ok('GET', `/api/diagrams/${state.overview}/versions`);
    assert(versions.length === 1 && versions[0].id === state.v1, 'delete version failed');
    const empty = await api('POST', `/api/diagrams/${state.scratchDiagram}/versions`, {});
    assert(empty.status === 400, 'saving a version of an empty diagram should fail');
  });

  await check('notes form a conversation anchored to elements', async () => {
    const { note } = await ok('POST', `/api/projects/${state.project}/notes`, {
      diagramId: state.overview, body: 'Is the burner sized right for a 50 gal tank?', elementIds: ['burner'], tags: ['question']
    });
    state.note = note.id;
    assert(note.role === 'human' && note.author === 'human', 'default note role');
    const { note: reply } = await ok('POST', `/api/projects/${state.project}/notes`, {
      diagramId: state.overview, body: '40k BTU is typical for 50 gal.', author: 'claude', role: 'agent', elementIds: ['burner']
    });
    assert(reply.role === 'agent', 'agent role');
    const byElement = await ok('GET', `/api/projects/${state.project}/notes?diagramId=${state.overview}&elementId=burner`);
    assert(byElement.notes.length === 2, `expected 2 burner notes, got ${byElement.notes.length}`);
    const resolved = await ok('PATCH', `/api/notes/${state.note}`, { resolved: true });
    assert(resolved.note.resolved === true, 'resolve failed');
    const blank = await api('POST', `/api/projects/${state.project}/notes`, { body: '   ' });
    assert(blank.status === 400, 'blank note should be rejected');
  });

  await check('element tags live in customData and are searchable', async () => {
    const tagged = await ok('POST', '/api/elements/tags', { elementIds: ['burner', 'tank'], addTags: ['Component', 'gas'], note: 'core parts' });
    assert(tagged.count === 2, 'tag count');
    const { element } = await ok('GET', '/api/elements/burner');
    assert(JSON.stringify(element.customData.tags) === '["component","gas"]', `tags ${JSON.stringify(element.customData)}`);
    assert(element.customData.note === 'core parts', 'element note');
    await ok('POST', '/api/elements/tags', { elementIds: ['tank'], removeTags: ['gas'] });
    const found = await ok('GET', '/api/tags/gas');
    assert(found.count === 1 && found.results[0].element.id === 'burner', 'find by tag');
    const missing = await api('POST', '/api/elements/tags', { elementIds: ['nope'], addTags: ['x'] });
    assert(missing.status === 404, 'unknown element should 404');
  });

  await check('links connect diagrams and drill into elements', async () => {
    const { diagram } = await ok('POST', `/api/projects/${state.project}/diagrams`, { name: 'Burner Assembly', open: false });
    state.burnerDiagram = diagram.id;
    const ws = await ok('GET', '/api/workspace');
    assert(ws.activeDiagramId === state.overview, 'open:false must not switch the canvas');
    const { link } = await ok('POST', `/api/projects/${state.project}/links`, {
      from: { diagramId: state.overview, elementId: 'burner' }, to: { diagramId: state.burnerDiagram }, relation: 'drills-into'
    });
    state.link = link.id;
    const { links } = await ok('GET', `/api/projects/${state.project}/links?diagramId=${state.burnerDiagram}`);
    assert(links.length === 1, 'link listing by diagram');
    const self = await api('POST', `/api/projects/${state.project}/links`, { from: { diagramId: state.overview }, to: { diagramId: state.overview } });
    assert(self.status === 400, 'self link should be rejected');
    const foreign = await api('POST', `/api/projects/${state.project}/links`, { from: { diagramId: state.overview }, to: { diagramId: state.scratchDiagram } });
    assert(foreign.status === 400, 'cross-project link should be rejected');
  });

  await check('project context digest covers diagrams, tags, notes and links', async () => {
    const { markdown } = await ok('GET', `/api/projects/${state.project}/context`);
    for (const needle of ['# Project: Water Heater', '#hvac', 'Overview', 'Burner Assembly', 'drills-into', '#component', '🤖 claude', '40k BTU', '(active on canvas)']) {
      assert(markdown.includes(needle), `context missing "${needle}"`);
    }
  });

  await check('switching diagrams swaps the live canvas and rejects stale syncs', async () => {
    await ok('POST', `/api/diagrams/${state.burnerDiagram}/open`);
    const { elements, diagramId } = await ok('GET', '/api/elements');
    assert(diagramId === state.burnerDiagram && elements.length === 0, 'burner diagram should be empty and active');
    const stale = await api('POST', '/api/elements/sync', { elements: [{ id: 'ghost', type: 'rectangle', x: 0, y: 0 }], diagramId: state.overview });
    assert(stale.status === 409, `stale sync returned ${stale.status}`);
    const after = await ok('GET', '/api/elements');
    assert(after.elements.length === 0, 'stale sync must not write');
    await ok('POST', '/api/elements', { id: 'igniter', type: 'rectangle', x: 0, y: 0, width: 100, height: 40, label: { text: 'Igniter' } });
    await sleep(900);
    await ok('POST', `/api/diagrams/${state.overview}/open`);
    const back = await ok('GET', '/api/elements');
    assert(back.elements.length === 3 && back.elements.some(e => e.id === 'tank'), 'overview scene lost after switch');
    const burner = await ok('GET', `/api/diagrams/${state.burnerDiagram}?scene=1`);
    assert(burner.scene.elements.length === 1 && burner.scene.elements[0].id === 'igniter', 'burner scene not persisted before switch');
  });

  await check('everything survives a server restart', async () => {
    await stop(server.child);
    server = startServer();
    const health2 = await waitForHealth(server.child, server.output);
    assert(health2.activeDiagramId === state.overview, 'active diagram not remembered');
    const { elements } = await ok('GET', '/api/elements');
    assert(elements.length === 3, `live scene after restart has ${elements.length} elements`);
    const { project } = await ok('GET', `/api/projects/${state.project}`);
    assert(project.diagrams.length === 2 && project.links.length === 1 && project.noteCount === 2, `project detail ${JSON.stringify({ d: project.diagrams.length, l: project.links.length, n: project.noteCount })}`);
    const { versions } = await ok('GET', `/api/diagrams/${state.overview}/versions`);
    assert(versions.length === 1, 'versions not reloaded');
    const { element } = await ok('GET', '/api/elements/burner');
    assert(element.customData?.tags?.includes('gas'), 'element tags lost on restart');
  });

  await check('MCP workspace tools resolve refs and drive the canvas', async () => {
    process.env.EXPRESS_SERVER_URL = baseUrl;
    process.env.EXCALIDRAW_NO_AUTOSTART = '1';
    const { callExcalidrawTool } = await import('../dist/testing.js');
    const call = async (name, args) => {
      const result = await callExcalidrawTool(name, args);
      assert(!result.isError, `${name} failed: ${result.content[0]?.text}`);
      return result.content.map(c => c.text ?? '').join('\n');
    };
    const tail = out => JSON.parse(out.slice(out.indexOf('\n\n') + 2));

    const project = tail(await call('create_project', { name: 'MCP Project', tags: ['mcp'] }));
    const diagram = tail(await call('create_diagram', { name: 'Flow', project: 'mcp-project', description: 'request flow' }));
    assert(diagram.projectId === project.id, 'diagram should land in the named project');
    const active = tail(await call('get_active_diagram', {}));
    assert(active.diagram.id === diagram.id, 'create_diagram should open on canvas');
    await call('batch_create_elements', { elements: [
      { id: 'api', type: 'rectangle', x: 0, y: 0, width: 160, height: 60, text: 'API' },
      { id: 'db', type: 'rectangle', x: 300, y: 0, width: 160, height: 60, text: 'DB' },
      { type: 'arrow', x: 0, y: 0, startElementId: 'api', endElementId: 'db' }
    ] });
    await call('tag_elements', { elementIds: ['db'], addTags: ['storage'], note: 'postgres 16' });
    const described = await call('describe_scene', {});
    assert(described.includes('#storage') && described.includes('postgres 16'), 'describe_scene should show tags and notes');
    const version = tail(await call('save_version', { label: 'mcp v1', author: 'claude' }));
    assert(version.number === 1 && version.author === 'claude', 'save_version via MCP');
    const confirmed = tail(await call('confirm_version', { version: 'v1' }));
    assert(confirmed.confirmed === true, 'confirm_version by number');
    const noteOut = tail(await call('add_note', { body: 'DB is the bottleneck', elementIds: ['db'], author: 'claude' }));
    assert(noteOut.role === 'agent' && noteOut.diagramId === diagram.id, 'add_note defaults');
    const second = tail(await call('create_diagram', { name: 'DB Internals', open: false }));
    const link = tail(await call('link_diagrams', { fromElementId: 'db', toDiagram: 'DB Internals', relation: 'drills-into' }));
    assert(link.to.diagramId === second.id, 'link_diagrams by name');
    const { element } = await ok('GET', '/api/elements/db');
    assert(element.link === `/p/${project.id}/d/${second.id}`, `element link not set: ${element.link}`);
    const found = tail(await call('find_by_tag', { tag: 'storage' }));
    assert(found.length === 1 && found[0].id === 'db', 'find_by_tag via MCP');
    const ctx = await call('get_project_context', { project: 'MCP Project' });
    assert(ctx.includes('DB is the bottleneck') && ctx.includes('drills-into'), 'context via MCP');
    const notesOut = tail(await call('list_notes', { diagram: 'Flow' }));
    assert(notesOut.length === 1, 'list_notes by diagram name');
    const opened = tail(await call('open_diagram', { diagram: 'Overview', project: 'water-heater' }));
    assert(opened.id === state.overview, 'open_diagram across projects by name');
    const denied = await callExcalidrawTool('delete_project', { project: 'MCP Project', confirm: false });
    assert(denied.isError, 'delete_project without confirm must fail');
    await call('delete_project', { project: 'MCP Project', confirm: true });
  });

  await check('CLI workspace commands work end to end', async () => {
    const run = args => new Promise(resolve => {
      const cli = spawn(process.execPath, [join(repoRoot, 'dist', 'bin.js'), ...args], {
        cwd: repoRoot,
        env: { ...process.env, EXPRESS_SERVER_URL: baseUrl, EXCALIDRAW_NO_AUTOSTART: '1', LOG_LEVEL: 'error' },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let out = '';
      let err = '';
      cli.stdout.on('data', chunk => { out += chunk.toString(); });
      cli.stderr.on('data', chunk => { err += chunk.toString(); });
      cli.on('exit', code => resolve({ code, out, err }));
    });
    const parse = (result, label) => {
      try { return JSON.parse(result.out); }
      catch (error) { throw new Error(`${label}: could not parse CLI stdout: ${JSON.stringify(result.out.slice(0, 200))} stderr=${JSON.stringify(result.err.slice(0, 200))}`); }
    };
    const created = await run(['project', 'create', 'CLI Project', '--tags', 'cli,test']);
    assert(created.code === 0, `project create failed: ${created.err}`);
    const projectId = parse(created, 'project create').id;
    const diag = await run(['diagram', 'create', 'CLI Diagram', '--project', 'cli-project']);
    assert(diag.code === 0 && parse(diag, 'diagram create').active === true, `diagram create failed: ${diag.err}`);
    await ok('POST', '/api/elements', { id: 'cli-box', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 });
    const saved = await run(['version', 'save', 'cli v1', '--confirm']);
    assert(saved.code === 0 && parse(saved, 'version save').confirmed === true, `version save failed: ${saved.err}`);
    const noted = await run(['note', 'add', 'from the cli', '--elements', 'cli-box']);
    assert(noted.code === 0 && parse(noted, 'note add').role === 'human', `note add failed: ${noted.err}`);
    const ctx = await run(['context']);
    assert(ctx.code === 0 && ctx.out.includes('# Project: CLI Project') && ctx.out.includes('from the cli'), `context failed: ${ctx.err}`);
    const list = await run(['project', 'list']);
    assert(list.code === 0 && parse(list, 'project list').some(p => p.id === projectId), 'project list');
    const refused = await run(['project', 'delete', 'cli-project']);
    assert(refused.code === 2, 'project delete without --yes should be a usage error');
    const deleted = await run(['project', 'delete', 'cli-project', '--yes']);
    assert(deleted.code === 0, `project delete failed: ${deleted.err}`);
    await ok('POST', `/api/diagrams/${state.overview}/open`);
  });

  await check('deleting the active diagram and project falls back gracefully', async () => {
    const deleted = await ok('DELETE', `/api/diagrams/${state.overview}`);
    assert(deleted.activeDiagramId === state.burnerDiagram, `fallback picked ${deleted.activeDiagramId}`);
    const { links } = await ok('GET', `/api/projects/${state.project}/links`);
    assert(links.length === 0, 'links to a deleted diagram should be removed');
    const gone = await api('GET', `/api/versions/${state.v1}`);
    assert(gone.status === 404, 'versions of a deleted diagram should be gone');
    const afterProject = await ok('DELETE', `/api/projects/${state.project}`);
    assert(afterProject.activeDiagramId === state.scratchDiagram, 'should fall back to the scratch diagram');
    const db = new LocalDatabase(dataDir);
    try {
      assert(!db.get('SELECT id FROM projects WHERE id = ?', state.project), 'project still in SQLite');
      assert(!db.get('SELECT id FROM diagrams WHERE project_id = ?', state.project), 'owned diagrams still in SQLite');
    } finally { db.close(); }
    const everything = await ok('DELETE', `/api/projects/${state.scratchProject}`);
    assert(everything.activeDiagramId, 'deleting the last project must recreate a default');
    const ws = await ok('GET', '/api/workspace');
    assert(ws.activeDiagram?.name === 'Untitled', 'default diagram should be recreated');
  });
} finally {
  await stop(server.child);
  fs.rmSync(dataDir, { recursive: true, force: true });
}

const failed = results.filter(r => !r).length;
if (failed > 0) {
  console.error(`${failed} workspace check(s) failed`);
  process.exit(1);
}
console.log(`All ${results.length} workspace checks passed`);
