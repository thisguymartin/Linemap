#!/usr/bin/env node
// Screenshots for README.md and docs/. Starts a throwaway canvas server on
// Bun, seeds a demo workspace, asks the real Claude Code and Codex CLIs to
// work in a project linked to this repo, then photographs each screen.
//
//   node scripts/capture-docs.mjs               real agents (costs a few cents)
//   node scripts/capture-docs.mjs --fake-agents stand-in CLIs, no cost
//
// Output: docs/images/*.png

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs', 'images');
const fake = process.argv.includes('--fake-agents');
const port = 39000 + Math.floor(Math.random() * 900);
const base = `http://127.0.0.1:${port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'excalidraw-docs-'));
fs.mkdirSync(out, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(method, p, body) {
  const res = await fetch(base + p, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

let bun = 'bun';
try { bun = execFileSync('which', ['bun'], { encoding: 'utf-8' }).trim(); } catch { bun = path.join(os.homedir(), '.bun', 'bin', 'bun'); }
const server = spawn(bun, [path.join(root, 'dist/server.js')], {
  env: {
    ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_LEVEL: 'warn', EXCALIDRAW_DATA_DIR: dataDir,
    ...(fake ? { EXCALIDRAW_CLAUDE_BIN: path.join(root, 'scripts/fixtures/claude'), EXCALIDRAW_CODEX_BIN: path.join(root, 'scripts/fixtures/codex') } : {})
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverOut = '';
server.stdout.on('data', c => { serverOut += c; });
server.stderr.on('data', c => { serverOut += c; });

async function waitForRun(pid, tid, label) {
  const deadline = Date.now() + 6 * 60_000;
  while (Date.now() < deadline) {
    const { thread } = await api('GET', `/api/projects/${pid}/chats/${tid}`);
    const last = thread.messages.at(-1);
    if (last?.role === 'assistant' && last.status !== 'running') {
      console.log(`  ${label}: ${last.status} in ${Math.round((last.durationMs ?? 0) / 1000)}s${last.error ? ` (${last.error})` : ''}`);
      return last;
    }
    await sleep(1000);
  }
  throw new Error(`${label} did not finish`);
}

try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch { /* booting */ } await sleep(100); }

  // ---- demo project 1: a domain being learned (no folder) -----------------
  const { project: heater } = await api('POST', '/api/projects', {
    name: 'Water Heater (demo)', description: 'How a 50-gallon gas water heater works, from gas valve to hot tap.', tags: ['demo', 'hvac', 'plumbing'], color: '#d97706'
  });
  const overview = (await api('POST', `/api/projects/${heater.id}/diagrams`, { name: 'Overview', description: 'Whole-unit view: tank, burner, flue, controls.', tags: ['system'] })).diagram;
  await api('POST', '/api/elements/batch', { elements: [
    { id: 'cold-in', type: 'rectangle', x: 80, y: 60, width: 170, height: 60, label: { text: 'Cold water inlet' }, backgroundColor: '#a5d8ff', fillStyle: 'solid' },
    { id: 'tank', type: 'rectangle', x: 340, y: 40, width: 220, height: 300, label: { text: '50 gal tank' }, backgroundColor: '#ffec99', fillStyle: 'solid' },
    { id: 'hot-out', type: 'rectangle', x: 660, y: 60, width: 170, height: 60, label: { text: 'Hot water outlet' }, backgroundColor: '#ffc9c9', fillStyle: 'solid' },
    { id: 'tpr', type: 'rectangle', x: 660, y: 180, width: 170, height: 60, label: { text: 'T&P relief valve' }, backgroundColor: '#ffc9c9', fillStyle: 'solid' },
    { id: 'burner', type: 'ellipse', x: 360, y: 420, width: 180, height: 90, label: { text: 'Burner 40k BTU' }, backgroundColor: '#ffd8a8', fillStyle: 'solid', customData: { tags: ['component', 'gas'], note: 'Atmospheric burner, standing pilot' } },
    { id: 'gas-valve', type: 'diamond', x: 80, y: 425, width: 170, height: 80, label: { text: 'Gas valve' }, backgroundColor: '#d8f5a2', fillStyle: 'solid', customData: { tags: ['safety', 'gas'] } },
    { id: 'thermostat', type: 'rectangle', x: 660, y: 435, width: 170, height: 60, label: { text: 'Thermostat 120°F' }, backgroundColor: '#eebefa', fillStyle: 'solid' },
    { id: 'flue', type: 'rectangle', x: 400, y: -120, width: 100, height: 110, label: { text: 'Flue' }, backgroundColor: '#dee2e6', fillStyle: 'solid' },
    { id: 'a1', type: 'arrow', x: 0, y: 0, start: { id: 'cold-in' }, end: { id: 'tank' } },
    { id: 'a2', type: 'arrow', x: 0, y: 0, start: { id: 'tank' }, end: { id: 'hot-out' } },
    { id: 'a3', type: 'arrow', x: 0, y: 0, start: { id: 'burner' }, end: { id: 'tank' } },
    { id: 'a4', type: 'arrow', x: 0, y: 0, start: { id: 'gas-valve' }, end: { id: 'burner' } },
    { id: 'a5', type: 'arrow', x: 0, y: 0, start: { id: 'thermostat' }, end: { id: 'gas-valve' }, strokeStyle: 'dashed' },
    { id: 'a6', type: 'arrow', x: 0, y: 0, start: { id: 'tank' }, end: { id: 'flue' } },
    { id: 'a7', type: 'arrow', x: 0, y: 0, start: { id: 'tank' }, end: { id: 'tpr' } }
  ] });
  await sleep(700);
  await api('POST', `/api/diagrams/${overview.id}/versions`, { label: 'first pass', note: 'Tank, burner and the water path.', author: 'claude-sonnet' });
  await api('POST', `/api/diagrams/${overview.id}/versions`, { label: 'thermostat loop', author: 'human', confirm: true });
  await api('PUT', '/api/elements/tpr', { y: 170 });
  await sleep(700);
  await api('POST', `/api/diagrams/${overview.id}/versions`, { label: 'relief valve', note: 'T&P valve near the top of the tank.', author: 'gpt-6.1-sol' });
  const burnerDiagram = (await api('POST', `/api/projects/${heater.id}/diagrams`, { name: 'Burner assembly', description: 'Pilot, thermocouple, main burner and gas train.', tags: ['gas'], open: false })).diagram;
  const controls = (await api('POST', `/api/projects/${heater.id}/diagrams`, { name: 'Control loop', description: 'Thermostat, gas valve, burner, tank temperature.', tags: ['controls'], open: false })).diagram;
  const maintenance = (await api('POST', `/api/projects/${heater.id}/diagrams`, { name: 'Maintenance', description: 'Anode rod, flushing, relief valve test.', open: false })).diagram;
  await api('POST', `/api/projects/${heater.id}/links`, { from: { diagramId: overview.id, elementId: 'burner' }, to: { diagramId: burnerDiagram.id }, relation: 'drills-into' });
  await api('POST', `/api/projects/${heater.id}/links`, { from: { diagramId: overview.id }, to: { diagramId: controls.id }, relation: 'see-also' });
  await api('POST', `/api/projects/${heater.id}/links`, { from: { diagramId: controls.id }, to: { diagramId: burnerDiagram.id }, relation: 'feeds' });
  await api('POST', `/api/projects/${heater.id}/links`, { from: { diagramId: overview.id, elementId: 'tank' }, to: { diagramId: maintenance.id }, relation: 'maintained-by' });
  await api('PUT', '/api/elements/burner', { link: `/p/${heater.id}/d/${burnerDiagram.id}` });
  await api('POST', `/api/projects/${heater.id}/notes`, { diagramId: overview.id, body: 'Is 40k BTU right for a 50 gal tank? Feels low for a family of four.', elementIds: ['burner'], tags: ['question'] });
  await api('POST', `/api/projects/${heater.id}/notes`, { diagramId: overview.id, body: '40k BTU is the usual rating for a 50 gal atmospheric unit (about 41 gal first-hour). High-recovery models go to 50k and up, which also changes the flue size.', elementIds: ['burner', 'flue'], author: 'claude-sonnet', role: 'agent' });
  await api('POST', `/api/projects/${heater.id}/notes`, { diagramId: overview.id, body: 'Add the anode rod next; it belongs in the maintenance diagram.', elementIds: ['tank'] });

  // ---- demo project 2: this repo, worked on by the real agents -------------
  const { project: repo } = await api('POST', '/api/projects', {
    name: 'Linemap', description: 'This repo: the canvas server, MCP server, CLI and the agent chat.', tags: ['typescript', 'bun'], color: '#0f766e', rootPath: root
  });
  const flow = (await api('POST', `/api/projects/${repo.id}/diagrams`, { name: 'Chat turn', description: 'What happens when you send a message in the Chat tab.' })).diagram;
  await api('POST', `/api/projects/${repo.id}/diagrams`, { name: 'How it works', description: 'The processes and where data lives.', open: false });

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light' });
  await context.addInitScript(() => { try { localStorage.setItem('excalidraw-canvas-theme', 'light'); localStorage.setItem('excalidraw-panel-open', 'true'); } catch {} });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const shot = async name => { await page.screenshot({ path: path.join(out, `${name}.png`) }); console.log(`  docs/images/${name}.png`); };
  const fit = async (zoom = 0.75) => { await sleep(500); await api('POST', '/api/viewport', { scrollToContent: true, viewportZoomFactor: zoom }).catch(() => {}); await sleep(700); };

  // Real Claude Code turn, typed into the Chat tab like a person would.
  console.log(fake ? 'agents: stand-ins' : 'agents: real Claude Code and Codex');
  await page.goto(`${base}/p/${repo.id}/d/${flow.id}`, { waitUntil: 'networkidle' });
  await page.click('#tab-chat');
  await page.getByRole('radio', { name: 'Claude Code' }).click();
  await page.selectOption('select[aria-label="Model"]', 'sonnet');
  await page.fill('textarea[aria-label="Message to the agent"]',
    'Read src/agent/manager.ts and src/server/routes/agent.ts, then draw how one chat message travels: Chat tab, canvas server, the spawned CLI, its MCP server, back to the canvas. Left to right, at most 6 boxes, short labels. Tag the shapes, take one screenshot to check, and save a version.');
  await page.click('button:has-text("Send")');
  await sleep(fake ? 300 : 9000);
  await shot('chat-live');
  const chats = await api('GET', `/api/projects/${repo.id}/chats`);
  const tid = chats.threads[0].id;
  await waitForRun(repo.id, tid, 'Claude Code');

  // Codex in the same chat: it gets the conversation handed over.
  await page.getByRole('radio', { name: 'Codex' }).click();
  await page.selectOption('select[aria-label="Effort"]', 'low');
  await page.fill('textarea[aria-label="Message to the agent"]',
    'Find the shape for the spawned CLI and add a note on it naming the flags that keep the agent read-only, with the file they are in. Do not change the drawing. Reply in one sentence.');
  await page.click('button:has-text("Send")');
  await waitForRun(repo.id, tid, 'Codex');
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('#tab-chat');
  await fit(0.7);
  await page.evaluate(() => { const b = document.querySelector('.panel-body'); if (b) b.scrollTop = b.scrollHeight; });
  await sleep(300);
  await shot('chat');

  // Folder picker, opened from the Chat tab.
  await page.locator('.chat-folder .linkish').click();
  await sleep(800);
  await shot('folder-picker');

  // ---- "How it works" diagram, drawn through the API and rendered headless --
  await api('POST', `/api/diagrams/${(await api('GET', `/api/projects/${repo.id}/diagrams`)).diagrams.find(d => d.name === 'How it works').id}/open`);
  const C = { blue: ['#1971c2', '#a5d8ff'], green: ['#2f9e44', '#b2f2bb'], purple: ['#9c36b5', '#eebefa'], orange: ['#e8590c', '#ffd8a8'], gray: ['#495057', '#e9ecef'], teal: ['#0c8599', '#99e9f2'], yellow: ['#e67700', '#ffec99'] };
  // Raw REST takes label/start/end (the CLI and MCP tools also accept text/startElementId/endElementId).
  const box = (id, x, y, w, h, text, [stroke, fill], extra = {}) => ({ id, type: 'rectangle', x, y, width: w, height: h, label: { text }, strokeColor: stroke, backgroundColor: fill, fillStyle: 'solid', roundness: { type: 3 }, fontSize: 18, ...extra });
  const arrow = (from, to, label, extra = {}) => ({ type: 'arrow', x: 0, y: 0, start: { id: from }, end: { id: to }, ...(label ? { label: { text: label } } : {}), fontSize: 14, ...extra });
  await api('POST', '/api/elements/batch', { elements: [
    { id: 'title', type: 'text', x: 40, y: -60, text: 'Linemap: one canvas server, three ways in', fontSize: 26 },
    box('term', 40, 40, 280, 90, 'Claude Code / Codex / Cursor\n(in your terminal)', C.purple),
    box('cli', 420, 40, 240, 90, 'CLI\nlinemap <command>', C.gray),
    box('tab', 760, 40, 280, 90, 'Browser tab\nExcalidraw + side panel', C.blue),
    box('mcp', 40, 220, 280, 80, 'MCP stdio server\nlinemap (no arguments)', C.purple),
    box('canvas', 300, 400, 480, 110, 'Canvas server  (dist/server.js)\nREST + WebSocket, one live diagram', C.teal, { fontSize: 20 }),
    box('data', 40, 620, 300, 100, '.local/linemap.db  (SQLite)\nprojects, diagrams, versions,\nnotes, links, chats', C.yellow),
    box('render', 420, 620, 260, 100, 'Headless renderer\njsdom + resvg → PNG/SVG', C.gray),
    box('agents', 760, 620, 300, 110, 'Chat runs\nclaude -p  /  codex exec\none per message, each with\nits own MCP server', C.orange),
    box('repo', 760, 820, 300, 70, 'Your repo (read-only)', C.green),
    arrow('term', 'mcp', 'stdio'),
    arrow('mcp', 'canvas', 'HTTP'),
    arrow('cli', 'canvas', 'HTTP'),
    arrow('tab', 'canvas', 'WebSocket + REST'),
    arrow('canvas', 'data', 'autosave'),
    arrow('canvas', 'render', 'screenshots'),
    arrow('canvas', 'agents', 'spawns, then draws back'),
    arrow('agents', 'repo', 'reads'),
  ] });
  await sleep(800);
  const img = await api('POST', '/api/export/image', { format: 'png', scale: 2, padding: 40 });
  fs.writeFileSync(path.join(out, 'architecture.png'), Buffer.from(img.data, 'base64'));
  console.log('  docs/images/architecture.png (headless renderer)');

  // ---- water heater screens --------------------------------------------------
  await api('POST', `/api/diagrams/${overview.id}/open`);
  await page.goto(`${base}/p/${heater.id}/d/${overview.id}`, { waitUntil: 'networkidle' });
  await page.click('#tab-versions');
  await fit();
  await shot('versions');
  await page.click('#tab-notes');
  await sleep(500);
  await shot('notes');
  await page.click('#tab-context');
  // Selecting through the open-question chip picks exactly the burner.
  await page.locator('.panel .chip', { hasText: 'Burner 40k BTU' }).first().click();
  await sleep(900);
  await shot('context');

  await page.goto(`${base}/p/${heater.id}`, { waitUntil: 'networkidle' });
  await sleep(1800);
  await shot('project-map');
  await page.goto(`${base}/projects`, { waitUntil: 'networkidle' });
  await sleep(600);
  await shot('projects');

  // Night theme on the repo project's chat.
  const dark = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  await dark.addInitScript(() => { try { localStorage.setItem('excalidraw-canvas-theme', 'dark'); localStorage.setItem('excalidraw-panel-open', 'true'); localStorage.setItem('excalidraw-panel-tab', 'versions'); } catch {} });
  const darkPage = await dark.newPage();
  await darkPage.goto(`${base}/p/${heater.id}/d/${overview.id}`, { waitUntil: 'networkidle' });
  await fit();
  await darkPage.screenshot({ path: path.join(out, 'dark.png') });
  console.log('  docs/images/dark.png');

  await browser.close();
  console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
} catch (error) {
  console.error('capture failed:', error);
  console.error(serverOut.slice(-2000));
  process.exitCode = 1;
} finally {
  server.kill('SIGTERM');
  await sleep(300);
  fs.rmSync(dataDir, { recursive: true, force: true });
}
