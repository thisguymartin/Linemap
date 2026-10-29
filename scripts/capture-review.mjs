#!/usr/bin/env node
// Capture review screenshots of the built UI against a seeded throwaway
// workspace: desktop + mobile for the canvas, the project map and the
// projects list. Writes into .impeccable/review/ (or --out <dir>).
//
//   node scripts/capture-review.mjs [--out dir] [--keep]

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outDir = path.resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(repoRoot, '.impeccable', 'review'));
const keep = args.includes('--keep');
const port = 38000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'excalidraw-review-'));
fs.mkdirSync(outDir, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(method, p, body) {
  const res = await fetch(base + p, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

const server = spawn(process.execPath, [path.join(repoRoot, 'dist/server.js')], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_LEVEL: 'error', EXCALIDRAW_DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverOut = '';
server.stdout.on('data', c => { serverOut += c; });
server.stderr.on('data', c => { serverOut += c; });

const errors = [];
try {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base + '/health')).ok) break; } catch { /* booting */ }
    await sleep(100);
  }

  // ---- seed: a water heater project with three diagrams -------------------
  const { project } = await api('POST', '/api/projects', {
    name: 'Water Heater (demo)', description: 'How a 50-gallon gas water heater works, from gas valve to hot tap.', tags: ['demo', 'hvac', 'plumbing', 'gas'], color: '#d97706'
  });
  const overview = (await api('POST', `/api/projects/${project.id}/diagrams`, { name: 'Overview', description: 'Whole-unit view: tank, burner, flue, controls.', tags: ['system'] })).diagram;
  await api('POST', '/api/elements/batch', { elements: [
    { id: 'cold-in', type: 'rectangle', x: 80, y: 60, width: 170, height: 60, label: { text: 'Cold water inlet' }, backgroundColor: '#a5d8ff', fillStyle: 'solid' },
    { id: 'tank', type: 'rectangle', x: 340, y: 40, width: 220, height: 300, label: { text: '50 gal tank' }, backgroundColor: '#ffec99', fillStyle: 'solid' },
    { id: 'hot-out', type: 'rectangle', x: 660, y: 60, width: 170, height: 60, label: { text: 'Hot water outlet' }, backgroundColor: '#ffc9c9', fillStyle: 'solid' },
    { id: 'burner', type: 'ellipse', x: 360, y: 400, width: 180, height: 90, label: { text: 'Burner 40k BTU' }, backgroundColor: '#ffd8a8', fillStyle: 'solid', customData: { tags: ['component', 'gas'], note: 'Atmospheric burner, standing pilot' } },
    { id: 'gas-valve', type: 'diamond', x: 80, y: 410, width: 170, height: 80, label: { text: 'Gas valve' }, backgroundColor: '#d8f5a2', fillStyle: 'solid', customData: { tags: ['safety', 'gas'] } },
    { id: 'thermostat', type: 'rectangle', x: 660, y: 410, width: 170, height: 60, label: { text: 'Thermostat 120°F' }, backgroundColor: '#eebefa', fillStyle: 'solid' },
    { id: 'flue', type: 'rectangle', x: 400, y: -120, width: 100, height: 120, label: { text: 'Flue' }, backgroundColor: '#dee2e6', fillStyle: 'solid' },
    { id: 'a1', type: 'arrow', x: 0, y: 0, start: { id: 'cold-in' }, end: { id: 'tank' } },
    { id: 'a2', type: 'arrow', x: 0, y: 0, start: { id: 'tank' }, end: { id: 'hot-out' } },
    { id: 'a3', type: 'arrow', x: 0, y: 0, start: { id: 'burner' }, end: { id: 'tank' }, label: { text: 'heat' } },
    { id: 'a4', type: 'arrow', x: 0, y: 0, start: { id: 'gas-valve' }, end: { id: 'burner' } },
    { id: 'a5', type: 'arrow', x: 0, y: 0, start: { id: 'thermostat' }, end: { id: 'gas-valve' }, strokeStyle: 'dashed' },
    { id: 'a6', type: 'arrow', x: 0, y: 0, start: { id: 'tank' }, end: { id: 'flue' } }
  ] });
  await sleep(700);
  await api('POST', `/api/diagrams/${overview.id}/versions`, { label: 'first pass', note: 'Tank, burner and water path.', author: 'claude' });
  await api('PUT', '/api/elements/thermostat', { x: 640 });
  await api('POST', `/api/diagrams/${overview.id}/versions`, { label: 'added thermostat loop', author: 'human', confirm: true });
  await api('POST', '/api/elements', { id: 'tpr', type: 'rectangle', x: 580, y: 160, width: 150, height: 50, label: { text: 'T&P relief valve' }, backgroundColor: '#ffc9c9', fillStyle: 'solid' });
  await sleep(700);
  await api('POST', `/api/diagrams/${overview.id}/versions`, { label: 'relief valve', note: 'Added the T&P valve near the top of the tank.', author: 'claude' });

  const burnerDiagram = (await api('POST', `/api/projects/${project.id}/diagrams`, { name: 'Burner assembly', description: 'Pilot, thermocouple, main burner and the gas train.', tags: ['gas'], open: false })).diagram;
  const controls = (await api('POST', `/api/projects/${project.id}/diagrams`, { name: 'Control loop', description: 'Thermostat → gas valve → burner → tank temperature.', tags: ['controls'], open: false })).diagram;
  await api('POST', `/api/projects/${project.id}/links`, { from: { diagramId: overview.id, elementId: 'burner' }, to: { diagramId: burnerDiagram.id }, relation: 'drills-into' });
  await api('POST', `/api/projects/${project.id}/links`, { from: { diagramId: overview.id }, to: { diagramId: controls.id }, relation: 'see-also' });
  await api('POST', `/api/projects/${project.id}/links`, { from: { diagramId: controls.id }, to: { diagramId: burnerDiagram.id }, relation: 'feeds' });
  await api('PUT', '/api/elements/burner', { link: `/p/${project.id}/d/${burnerDiagram.id}` });
  await api('POST', `/api/projects/${project.id}/notes`, { diagramId: overview.id, body: 'Is 40k BTU right for a 50 gal tank? Feels low for a family of four.', elementIds: ['burner'], tags: ['question'] });
  await api('POST', `/api/projects/${project.id}/notes`, { diagramId: overview.id, body: '40k BTU is the standard rating for 50 gal atmospheric units (≈41 gal first-hour). High-recovery models go to 50k+. Worth noting the flue sizing changes above 50k.', elementIds: ['burner', 'flue'], author: 'claude', role: 'agent' });
  await api('POST', `/api/projects/${project.id}/notes`, { diagramId: overview.id, body: 'Add the anode rod next; it matters for the maintenance diagram.', author: 'human', role: 'human', elementIds: ['tank'] });
  await api('POST', `/api/projects/${project.id}/notes`, { body: 'Project goal: understand failure modes before buying a replacement.', author: 'human', role: 'human' });
  await api('POST', '/api/projects', { name: 'Order Pipeline (demo)', description: 'SQS → Lambda → webhook fan-out for order events.', tags: ['demo', 'backend', 'aws'], color: '#2563eb' });
  await api('POST', `/api/diagrams/${overview.id}/open`);

  // ---- capture -------------------------------------------------------------
  const browser = await chromium.launch();
  const shots = [];
  const capture = async (name, url, viewport, options = {}) => {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: options.dark ? 'dark' : 'light', reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('console', msg => { if (msg.type() === 'error') errors.push(`[${name}] ${msg.text()}`); });
    page.on('pageerror', err => errors.push(`[${name}] ${err.message}`));
    await page.addInitScript(theme => { try { localStorage.setItem('excalidraw-canvas-theme', theme); } catch {} }, options.dark ? 'dark' : 'light');
    await page.goto(base + url, { waitUntil: 'networkidle' });
    if (options.prepare) await options.prepare(page);
    await sleep(options.settle ?? 1200);
    const file = path.join(outDir, `${name}.png`);
    await page.screenshot({ path: file, fullPage: options.fullPage ?? false });
    shots.push(file);
    await context.close();
  };

  const canvasUrl = `/p/${project.id}/d/${overview.id}`;
  const fitScene = async page => {
    await page.waitForSelector('.excalidraw', { timeout: 15000 });
    await sleep(800);
    await api('POST', '/api/viewport', { scrollToContent: true, viewportZoomFactor: 0.8 });
  };
  await capture('desktop', canvasUrl, { width: 1440, height: 900 }, { prepare: fitScene });
  await capture('desktop-notes', canvasUrl, { width: 1440, height: 900 }, { prepare: async page => {
    await fitScene(page);
    await page.click('#tab-notes');
  } });
  await capture('desktop-context', canvasUrl, { width: 1440, height: 900 }, { prepare: async page => {
    await fitScene(page);
    await page.click('#tab-context');
  } });
  await capture('desktop-dark', canvasUrl, { width: 1440, height: 900 }, { dark: true, prepare: fitScene });
  await capture('desktop-project', `/p/${project.id}`, { width: 1440, height: 900 }, { fullPage: true });
  await capture('desktop-projects', '/projects', { width: 1440, height: 900 }, { fullPage: true });
  await capture('mobile', canvasUrl, { width: 390, height: 844 }, { prepare: async page => {
    await fitScene(page);
  } });
  await capture('mobile-project', `/p/${project.id}`, { width: 390, height: 844 }, { fullPage: true });
  await browser.close();

  console.log(`Captured ${shots.length} screenshots into ${outDir}`);
  for (const s of shots) console.log(`  ${s}`);
  if (errors.length) {
    console.log(`\nBrowser errors (${errors.length}):`);
    for (const e of [...new Set(errors)].slice(0, 20)) console.log(`  ${e}`);
  } else {
    console.log('\nNo browser console errors.');
  }
} catch (error) {
  console.error('capture failed:', error);
  console.error(serverOut.slice(-2000));
  process.exitCode = 1;
} finally {
  server.kill('SIGTERM');
  if (!keep) fs.rmSync(dataDir, { recursive: true, force: true });
  else console.log(`data kept at ${dataDir}`);
}
