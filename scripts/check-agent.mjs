#!/usr/bin/env node
// Agent chat + folder linking checks against a real dist/server.js, with the
// claude / codex CLIs replaced by scripts/fixtures/fake-agent.mjs.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import WebSocket from 'ws';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = 37000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
const dataDir = fs.mkdtempSync(join(os.tmpdir(), 'excalidraw-agent-'));
const repoParent = fs.mkdtempSync(join(os.tmpdir(), 'excalidraw-agent-repos-'));
const repoDir = join(repoParent, 'heater');
fs.mkdirSync(repoDir);
fs.mkdirSync(join(repoParent, 'notes'));
const logFile = join(dataDir, 'fake-agent.log');
const codexHome = fs.mkdtempSync(join(os.tmpdir(), 'excalidraw-agent-codex-'));
fs.writeFileSync(join(codexHome, 'config.toml'), 'model = "gpt-test"\n\n[mcp_servers.slowserver]\ncommand = "false"\n\n[mcp_servers.excalidraw]\ncommand = "x"\n');
fs.mkdirSync(join(repoDir, '.git'));
fs.writeFileSync(join(repoDir, '.git', 'HEAD'), 'ref: refs/heads/feature/maps\n');
fs.writeFileSync(join(repoDir, '.git', 'config'), '[remote "origin"]\n\turl = https://user:secret@github.com/acme/heater.git\n');
fs.mkdirSync(join(repoDir, 'src'));
fs.writeFileSync(join(repoDir, 'README.md'), '# heater\n');

const assert = (c, m) => { if (!c) throw new Error(m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(method, path, body, headers = {}) {
  const res = await fetch(base + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function ok(method, path, body) {
  const r = await api(method, path, body);
  assert(r.status < 400, `${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}
async function waitFor(fn, label, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(100); }
  throw new Error(`timed out: ${label}`);
}
const logLines = () => fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf-8').trim().split('\n').map(l => JSON.parse(l)) : [];

const server = spawn(process.execPath, [join(repoRoot, 'dist/server.js')], {
  env: {
    ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_LEVEL: 'error', EXCALIDRAW_DATA_DIR: dataDir,
    EXCALIDRAW_CLAUDE_BIN: join(repoRoot, 'scripts/fixtures/claude'),
    EXCALIDRAW_CODEX_BIN: join(repoRoot, 'scripts/fixtures/codex'),
    FAKE_AGENT_LOG: logFile,
    CODEX_HOME: codexHome
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverOut = '';
server.stdout.on('data', c => { serverOut += c; });
server.stderr.on('data', c => { serverOut += c; });

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(true); console.log(`ok - ${name}`); }
  catch (error) { results.push(false); console.error(`not ok - ${name}\n  ${error.message}`); }
}

const state = {};
try {
  await waitFor(async () => { try { return (await fetch(base + '/health')).ok; } catch { return false; } }, 'health');

  await check('request guard rejects foreign origins and hosts, allows local and header-less clients', async () => {
    assert((await api('GET', '/api/projects', undefined, { origin: 'https://evil.example' })).status === 403, 'foreign origin allowed');
    assert((await api('POST', '/api/projects', { name: 'x' }, { origin: 'http://evil.example:3000' })).status === 403, 'foreign POST allowed');
    assert((await api('POST', `/api/projects`, { name: 'x' }, { origin: 'null' })).status === 403, 'Origin: null (sandboxed iframe) allowed');
    assert((await api('GET', '/api/projects', undefined, { origin: `http://localhost:5173` })).status === 200, 'vite dev origin blocked');
    assert((await api('GET', '/api/projects', undefined, { origin: base })).status === 200, 'same origin blocked');
    const rebound = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: '/api/projects', headers: { host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject);
    });
    assert(rebound === 403, `rebinding host allowed (${rebound})`);
    assert((await api('GET', '/api/projects')).status === 200, 'header-less client blocked');
  });

  await check('runners are detected through the env overrides', async () => {
    const { enabled, runners } = await ok('GET', '/api/agents?refresh=1');
    assert(enabled === true, 'agents disabled on loopback');
    assert(runners.every(r => r.available && r.version?.startsWith('fake-')), JSON.stringify(runners));
    const claude = runners.find(r => r.id === 'claude');
    const codex = runners.find(r => r.id === 'codex');
    assert(claude.models.some(m => m.value === 'haiku') && claude.efforts.some(e => e.value === 'max'), 'claude options');
    assert(codex.models[0].label === 'Default (gpt-test)', `codex default model label ${codex.models[0].label}`);
  });

  await check('a project links to a folder; git info is read and credentials stripped', async () => {
    const { project } = await ok('POST', '/api/projects', { name: 'Heater', rootPath: repoDir });
    state.pid = project.id;
    assert(project.rootPath === fs.realpathSync(repoDir), `rootPath ${project.rootPath}`);
    assert(project.folder.git.branch === 'feature/maps', `branch ${project.folder.git.branch}`);
    assert(project.folder.git.remote === 'https://github.com/acme/heater.git', `remote ${project.folder.git.remote}`);
    const { markdown } = await ok('GET', `/api/projects/${project.id}/context`);
    assert(markdown.includes('Linked folder:') && markdown.includes('feature/maps') && markdown.includes('src/') && !markdown.includes('secret'), 'context lacks folder or leaks credentials');
    const bad = await api('PATCH', `/api/projects/${project.id}`, { rootPath: join(repoDir, 'nope') });
    assert(bad.status === 400, 'missing folder accepted');
    const rel = await api('PATCH', `/api/projects/${project.id}`, { rootPath: 'relative/path' });
    assert(rel.status === 400, 'relative folder accepted');
    const { diagram } = await ok('POST', `/api/projects/${project.id}/diagrams`, { name: 'Flow' });
    state.did = diagram.id;
  });

  await check('folder browser lists directories and marks repos', async () => {
    const listing = await ok('GET', `/api/fs/dirs?path=${encodeURIComponent(dirname(repoDir))}`);
    const entry = listing.entries.find(e => e.path === fs.realpathSync(repoDir));
    assert(entry?.isGitRepo === true, 'repo not listed as git');
    const inside = await ok('GET', `/api/fs/dirs?path=${encodeURIComponent(repoDir)}`);
    assert(inside.isGitRepo && inside.entries.some(e => e.name === 'src') && !inside.entries.some(e => e.name === '.git'), 'listing wrong');
    assert((await api('GET', '/api/fs/dirs?path=relative')).status === 400, 'relative listing allowed');
  });

  const send = (tid, body) => api('POST', `/api/projects/${state.pid}/chats/${tid}/messages`, body);
  const thread = tid => ok('GET', `/api/projects/${state.pid}/chats/${tid}`).then(r => r.thread);
  const lastAssistant = async tid => (await thread(tid)).messages.filter(m => m.role === 'assistant').at(-1);
  const settle = async (tid, label, pred = m => m?.status !== 'running') => waitFor(async () => { const m = await lastAssistant(tid); return pred(m) && m; }, label);

  await check('claude chat: new thread, live thinking/activity over WebSocket, draws, logs, resumes', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const events = [];
    socket.on('message', raw => { const m = JSON.parse(String(raw)); if (m.type === 'chat_event') events.push(m); });
    await new Promise(r => socket.once('open', r));
    await ok('POST', '/api/elements', { id: 'sel', type: 'rectangle', x: 300, y: 0, width: 100, height: 50, label: { text: 'Burner' } });
    const start = await send('new', { message: 'draw the tank SLOWDRAW', runner: 'claude', diagramId: state.did, selectedIds: ['sel'], model: 'sonnet', effort: 'low' });
    assert(start.status === 202 && start.body.threadId, `start ${start.status} ${JSON.stringify(start.body)}`);
    state.tid = start.body.threadId;
    const busy = await send(state.tid, { message: 'again', runner: 'claude' });
    assert(busy.status === 409, `second run while busy returned ${busy.status}`);
    const done = await settle(state.tid, 'claude run');
    assert(done.status === 'done', `status ${done.status} ${done.error}`);
    assert(done.text.includes('drawing it') && done.text.includes('Done.'), `text ${done.text}`);
    assert(done.thinking.includes('Planning the tank layout.'), `thinking ${JSON.stringify(done.thinking)}`);
    assert(done.activity === null && done.liveText === '', 'live fields not cleared');
    const tools = done.parts.filter(p => p.type === 'tool');
    assert(tools[0]?.name === 'batch_create_elements' && tools[0].kind === 'mcp' && tools[0].status === 'done' && tools[0].detail === '2 elements', JSON.stringify(tools[0]));
    assert(tools[1]?.kind === 'read' && tools[1].status === 'error', JSON.stringify(tools[1]));
    assert(done.costUsd === 0.0123 && done.model === 'fake-model', `cost/model ${done.costUsd} ${done.model}`);
    const { elements } = await ok('GET', '/api/elements');
    assert(elements.some(e => e.id.startsWith('agent-')), 'agent did not draw on the canvas');
    const mine = events.filter(e => e.message?.id === done.id).map(e => e.message);
    assert(mine.some(m => m.activity?.phase === 'writing' && /Writing batch_create_elements · \d/.test(m.activity.label)), `no writing activity: ${JSON.stringify(mine.map(m => m.activity))}`);
    assert(mine.some(m => m.liveText === 'drawing'), 'no live text streamed');
    assert(events.some(e => e.threadsChanged), 'no thread list event');
    socket.close();

    const { threads } = await ok('GET', `/api/projects/${state.pid}/chats`);
    assert(threads.length === 1 && threads[0].title === 'draw the tank SLOWDRAW' && threads[0].runners.includes('claude'), JSON.stringify(threads));

    const logRes = await fetch(`${base}/api/projects/${state.pid}/chats/${state.tid}/messages/${done.id}/log`);
    const logText = await logRes.text();
    assert(logRes.ok && logText.includes('# ---- output ----') && logText.includes('"type":"result"') && logText.includes('# ---- exit 0 · done'), `log ${logRes.status} ${logText.slice(0, 200)}`);

    const first = logLines().find(l => l.flavor === 'claude');
    assert(first.cwd === fs.realpathSync(repoDir), `cwd ${first.cwd}`);
    const prompt = first.argv[first.argv.indexOf('-p') + 1];
    assert(prompt.includes('<project-brain>') && prompt.includes('"Burner" [sel]') && prompt.endsWith('draw the tank SLOWDRAW'), 'first prompt missing brain/selection');
    assert(!prompt.includes('<earlier-in-this-chat>'), 'new chat carried history');
    const has = (flag, value) => first.argv[first.argv.indexOf(flag) + 1] === value;
    assert(first.argv.includes('--strict-mcp-config') && has('--permission-mode', 'dontAsk') && first.argv.includes('--include-partial-messages'), 'claude flags');
    assert(has('--model', 'sonnet') && has('--effort', 'low'), 'model/effort not passed');
    assert(!['Bash', 'Edit', 'Write', '--dangerously-skip-permissions'].some(f => first.argv.includes(f)), 'unsafe claude flags');
    const mcp = JSON.parse(first.argv[first.argv.indexOf('--mcp-config') + 1]).mcpServers.excalidraw;
    assert(mcp.env.EXPRESS_SERVER_URL === base && mcp.env.EXCALIDRAW_EXPORT_DIR === join(dataDir, 'projects', state.pid), JSON.stringify(mcp.env));

    assert((await send(state.tid, { message: 'and the flue', runner: 'claude' })).status === 202, 'second turn');
    const second = await settle(state.tid, 'resumed run', m => m?.status === 'done' && m.text.includes('resumed') );
    const resumedCall = logLines().filter(l => l.flavor === 'claude').at(-1);
    assert(resumedCall.argv.includes('--resume'), 'second turn did not resume');
    const resumedPrompt = resumedCall.argv[resumedCall.argv.indexOf('-p') + 1];
    assert(!resumedPrompt.includes('<project-brain>') && !resumedPrompt.includes('<earlier-in-this-chat>'), 'resumed turn resent brain/history');
    assert(second.text.startsWith('resumed sess-'), second.text);
    assert((await send(state.tid, { message: 'x', runner: 'claude', effort: 'turbo' })).status === 400, 'bad effort accepted');
  });

  await check('switching to codex mid-chat hands over the conversation; codex flags are safe', async () => {
    assert((await send(state.tid, { message: 'map the lambdas', runner: 'codex', effort: 'low' })).status === 202, 'codex start');
    const done = await settle(state.tid, 'codex run', m => m?.runner === 'codex' && m.status !== 'running');
    assert(done.status === 'done', `status ${done.status} ${done.error}`);
    assert(done.thinking.includes('Looking for the handlers.'), 'codex reasoning not captured');
    const tools = done.parts.filter(p => p.type === 'tool');
    assert(tools.some(t => t.kind === 'mcp' && t.name === 'create_element' && t.status === 'done'), JSON.stringify(tools));
    assert(tools.some(t => t.kind === 'command' && t.detail === 'rg -n Lambda src'), 'shell command not unwrapped');
    const call = logLines().filter(l => l.flavor === 'codex').at(-1);
    assert(call.argv.includes('sandbox_mode="read-only"') && call.argv.includes('mcp_servers.excalidraw.default_tools_approval_mode="approve"'), 'codex config flags missing');
    assert(call.argv.includes('model_reasoning_effort="low"'), 'codex effort missing');
    assert(call.argv.includes('mcp_servers.slowserver.enabled=false') && !call.argv.includes('mcp_servers.excalidraw.enabled=false'), 'user codex MCP servers not switched off');
    assert(!call.argv.some(a => a.includes('danger')), 'dangerous codex flag');
    const prompt = call.argv.at(-1);
    assert(prompt.includes('<instructions>') && prompt.includes('<project-brain>'), 'codex first turn lacks rules/brain');
    assert(prompt.includes('<earlier-in-this-chat>') && prompt.includes('User: draw the tank SLOWDRAW') && prompt.includes('Agent (Claude Code): resumed'), 'codex did not get the earlier conversation');
    await send(state.tid, { message: 'more', runner: 'codex' });
    await settle(state.tid, 'codex resume', m => m?.status === 'done' && m.text.startsWith('resumed'));
    const resumed = logLines().filter(l => l.flavor === 'codex').at(-1);
    assert(resumed.argv[1] === 'resume' && !resumed.argv.at(-1).includes('<instructions>') && !resumed.argv.at(-1).includes('<earlier-in-this-chat>'), 'codex did not resume cleanly');
  });

  await check('chats are separate sessions: a second chat starts fresh', async () => {
    const before = logLines().length;
    const start = await send('new', { message: 'separate topic', runner: 'claude' });
    state.tid2 = start.body.threadId;
    assert(state.tid2 && state.tid2 !== state.tid, 'no new thread');
    await settle(state.tid2, 'second chat');
    const call = logLines().slice(before).find(l => l.flavor === 'claude');
    assert(!call.argv.includes('--resume'), 'new chat resumed an old session');
    const { threads } = await ok('GET', `/api/projects/${state.pid}/chats`);
    assert(threads.length === 2 && threads[0].id === state.tid2, `threads ${JSON.stringify(threads.map(t => t.title))}`);
    const renamed = await ok('PATCH', `/api/projects/${state.pid}/chats/${state.tid2}`, { title: 'Side quest' });
    assert(renamed.thread.title === 'Side quest', 'rename failed');
  });

  await check('cancel stops a running agent; failures surface as errors', async () => {
    await send(state.tid2, { message: 'SLEEP please', runner: 'claude' });
    await waitFor(async () => (await ok('GET', `/api/projects/${state.pid}/chats`)).runningThreadId === state.tid2, 'running');
    assert((await api('DELETE', `/api/projects/${state.pid}/chats/${state.tid2}`)).status === 409, 'deleted a running chat');
    const { cancelled } = await ok('POST', `/api/projects/${state.pid}/chat/cancel`);
    assert(cancelled, 'cancel returned false');
    const m = await settle(state.tid2, 'cancelled', x => x?.status === 'cancelled');
    assert(m.finishedAt && m.activity === null, 'cancelled message not finalised');
    await send(state.tid2, { message: 'FAIL now', runner: 'claude' });
    const failed = await settle(state.tid2, 'error', x => x?.status === 'error');
    assert(failed.error === 'fake failure', `error ${failed.error}`);
  });

  await check('deleting a chat removes it and its run logs; chats persist on disk', async () => {
    const t2 = await thread(state.tid2);
    const logPath = join(dataDir, 'projects', state.pid, 'runs', `${t2.messages.find(m => m.role === 'assistant').id}.log`);
    assert(fs.existsSync(logPath), 'run log missing');
    await ok('DELETE', `/api/projects/${state.pid}/chats/${state.tid2}`);
    assert(!fs.existsSync(logPath), 'run log not removed');
    const saved = JSON.parse(fs.readFileSync(join(dataDir, 'projects', state.pid, 'chat.json'), 'utf-8'));
    assert(saved.threads.length === 1 && saved.threads[0].sessions.claude && saved.threads[0].sessions.codex, 'chat.json shape');
  });

  await check('MCP link_project_folder, CLI project link/unlink, CLI short flags', async () => {
    process.env.EXPRESS_SERVER_URL = base;
    process.env.EXCALIDRAW_NO_AUTOSTART = '1';
    const { callExcalidrawTool } = await import('../dist/testing.js');
    const r = await callExcalidrawTool('link_project_folder', { project: 'heater', path: '' });
    assert(!r.isError && r.content[0].text.includes('no linked folder'), r.content[0].text);
    const cli = await new Promise(resolve => {
      const p = spawn(process.execPath, [join(repoRoot, 'dist/bin.js'), 'project', 'link', 'heater', repoDir], { env: { ...process.env, LOG_LEVEL: 'error' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = ''; p.stdout.on('data', c => { out += c; }); p.on('exit', code => resolve({ code, out }));
    });
    assert(cli.code === 0 && JSON.parse(cli.out).rootPath === fs.realpathSync(repoDir), `cli ${cli.code} ${cli.out}`);
    const runCli = args => new Promise(resolve => {
      const p = spawn(process.execPath, [join(repoRoot, 'dist/bin.js'), ...args], { env: { ...process.env, LOG_LEVEL: 'error' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = ''; p.stdout.on('data', c => { out += c; }); p.stderr.on('data', c => { out += c; }); p.on('exit', code => resolve({ code, out }));
    });
    const shortFlag = await runCli(['logs', '-n', '1', '--agent']);
    assert(shortFlag.code === 0 && shortFlag.out.trim().split('\n').filter(l => !l.startsWith('#')).length <= 1, `-n not honoured: ${shortFlag.code} ${shortFlag.out.slice(0, 200)}`);
    const unknownShort = await runCli(['status', '-q']);
    assert(unknownShort.code === 2 && unknownShort.out.includes('Unknown flag -q'), `unknown short flag not rejected: ${unknownShort.code} ${unknownShort.out.slice(0, 120)}`);
  });
} finally {
  server.kill('SIGTERM');
  await sleep(300);
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(repoParent, { recursive: true, force: true });
  fs.rmSync(codexHome, { recursive: true, force: true });
}

const failed = results.filter(r => !r).length;
if (failed) { console.error(serverOut.slice(-1500)); console.error(`${failed} agent check(s) failed`); process.exit(1); }
console.log(`All ${results.length} agent checks passed`);
