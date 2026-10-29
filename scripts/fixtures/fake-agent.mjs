#!/usr/bin/env node
// Stand-in for the `claude` and `codex` CLIs in tests. Emits the same event
// shapes the real CLIs print (stream-json / codex --json), draws one element
// through the canvas URL from the MCP config it was handed, and logs its argv
// and cwd so the test can check what the server passed.
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const flavor = process.env.FAKE_AGENT_FLAVOR || (path.basename(process.argv[1]).includes('codex') ? 'codex' : 'claude');
const log = process.env.FAKE_AGENT_LOG;
if (argv[0] === '--version') { console.log(`fake-${flavor} 0.0.1`); process.exit(0); }
if (log) fs.appendFileSync(log, JSON.stringify({ flavor, argv, cwd: process.cwd() }) + '\n');

const out = event => process.stdout.write(JSON.stringify(event) + '\n');
let canvasUrl = 'http://127.0.0.1:3000';
let prompt = '';
let resumeId = null;
if (flavor === 'claude') {
  const cfg = argv[argv.indexOf('--mcp-config') + 1];
  canvasUrl = JSON.parse(cfg).mcpServers.excalidraw.env.EXPRESS_SERVER_URL;
  prompt = argv[argv.indexOf('-p') + 1];
  if (argv.includes('--resume')) resumeId = argv[argv.indexOf('--resume') + 1];
} else {
  const envArg = argv.find(a => a.startsWith('mcp_servers.excalidraw.env='));
  canvasUrl = envArg.match(/EXPRESS_SERVER_URL="([^"]+)"/)[1];
  prompt = argv[argv.length - 1];
  if (argv[1] === 'resume') resumeId = argv[2];
}
const userText = prompt.split('\n\n').pop();
const sessionId = resumeId ?? `sess-${Math.random().toString(36).slice(2, 10)}`;

async function draw() {
  const res = await fetch(`${canvasUrl}/api/elements`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: `agent-${Date.now()}`, type: 'rectangle', x: 0, y: 0, width: 120, height: 60, label: { text: userText.slice(0, 20) } })
  });
  return res.ok;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

if (flavor === 'claude') {
  out({ type: 'system', subtype: 'init', session_id: sessionId, model: 'fake-model', mcp_servers: [{ name: 'excalidraw', status: 'connected' }] });
  if (userText.includes('SLEEP')) { await sleep(30000); }
  if (userText.includes('FAIL')) {
    out({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: sessionId, result: 'fake failure' });
    process.exit(1);
  }
  // Token-level events, as with --include-partial-messages.
  if (argv.includes('--include-partial-messages')) {
    out({ type: 'stream_event', event: { type: 'message_start' } });
    out({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'thinking' } } });
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Planning the tank layout.' } } });
    out({ type: 'stream_event', event: { type: 'content_block_stop' } });
    out({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text' } } });
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'drawing' } } });
    out({ type: 'stream_event', event: { type: 'content_block_stop' } });
    out({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'mcp__excalidraw__batch_create_elements' } } });
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"elements":[{},{}]}' } } });
    out({ type: 'stream_event', event: { type: 'content_block_stop' } });
    if (userText.includes('SLOWDRAW')) await sleep(1500);
  }
  out({ type: 'assistant', message: { content: [{ type: 'text', text: resumeId ? `resumed ${resumeId}` : 'drawing it' }, { type: 'tool_use', id: 't1', name: 'mcp__excalidraw__batch_create_elements', input: { elements: [{}, {}] } }] } });
  const ok = await draw();
  out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'ok' }], is_error: !ok }] } });
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/repo/src/index.ts' } }] } });
  out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'denied', is_error: true }] } });
  out({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] } });
  out({ type: 'result', subtype: 'success', is_error: false, session_id: sessionId, total_cost_usd: 0.0123, duration_ms: 42, result: 'Done.' });
} else {
  out({ type: 'thread.started', thread_id: sessionId });
  out({ type: 'turn.started' });
  if (userText.includes('SLEEP')) { await sleep(30000); }
  out({ type: 'item.completed', item: { id: 'r0', type: 'reasoning', text: 'Looking for the handlers.' } });
  out({ type: 'item.completed', item: { id: 'i0', type: 'agent_message', text: resumeId ? `resumed ${resumeId}` : 'drawing it' } });
  out({ type: 'item.started', item: { id: 'i1', type: 'mcp_tool_call', server: 'excalidraw', tool: 'create_element', arguments: { type: 'rectangle', text: 'x' }, status: 'in_progress' } });
  const ok = await draw();
  out({ type: 'item.completed', item: { id: 'i1', type: 'mcp_tool_call', server: 'excalidraw', tool: 'create_element', arguments: { type: 'rectangle', text: 'x' }, status: ok ? 'completed' : 'failed', error: ok ? null : { message: 'nope' } } });
  out({ type: 'item.completed', item: { id: 'i2', type: 'command_execution', command: "/bin/zsh -lc 'rg -n Lambda src'", exit_code: 0, status: 'completed' } });
  out({ type: 'item.completed', item: { id: 'i3', type: 'agent_message', text: 'Done.' } });
  out({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } });
}
