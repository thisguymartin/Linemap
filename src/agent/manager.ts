import { spawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';
import type { Workspace } from '../domain/workspace.js';
import { ConflictError, ValidationError } from '../domain/errors.js';
import { broadcast } from '../server/broadcast.js';
import { ChatStore, titleFrom } from './chat-store.js';
import { AGENT_RULES, buildTurnPrompt } from './prompt.js';
import { codexConfiguredModel, codexUserMcpServers, isValidEffort, resolveBinary, runnerEnv } from './runners.js';
import type { ChatActivity, ChatMessage, ChatPart, ChatThread, RunnerId } from './types.js';

export interface AgentManagerOptions {
  // Absolute path of dist/bin.js: the MCP server handed to the CLI.
  mcpEntry: string;
  // Where the spawned MCP server finds this canvas server.
  canvasUrl: string;
  timeoutMs?: number;
}

export interface StartRunInput {
  projectId: string;
  threadId?: string | null;
  runner: RunnerId;
  message: string;
  diagramId?: string | null;
  selectedIds?: string[];
  model?: string | null;
  effort?: string | null;
}

interface ActiveRun {
  child: ChildProcess;
  threadId: string;
  message: ChatMessage;
  cancelled: boolean;
  timer: NodeJS.Timeout;
  log: fs.WriteStream | null;
  logBytes: number;
  // Claude streaming state: the content block being written right now.
  block: { type: string; tool?: string; bytes: number } | null;
}

const MAX_CONCURRENT = 3;
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const MAX_THINKING_CHARS = 6000;
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead']);
const HIDDEN_TOOLS = new Set(['ToolSearch', 'TodoWrite']);

function nowIso(): string {
  return new Date().toISOString();
}

function compact(value: unknown, max = 90): string {
  if (value === undefined || value === null) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function kb(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} kB`;
}

// One readable line per tool call, for the chat transcript.
function describeToolInput(name: string, input: Record<string, unknown> | undefined): string {
  if (!input) return '';
  const elements = input.elements;
  if (Array.isArray(elements)) return `${elements.length} element${elements.length === 1 ? '' : 's'}`;
  if (typeof input.file_path === 'string') return input.file_path;
  if (typeof input.pattern === 'string') return `${input.pattern}${typeof input.path === 'string' ? ` in ${input.path}` : ''}`;
  if (name === 'create_element') return compact(`${input.type ?? ''} ${input.text ?? ''}`.trim());
  if (typeof input.id === 'string') return input.id;
  if (Array.isArray(input.elementIds)) return `${input.elementIds.length} element(s)`;
  for (const key of ['diagram', 'name', 'label', 'body', 'project', 'version', 'tag', 'query']) {
    if (typeof input[key] === 'string') return compact(input[key]);
  }
  return compact(input, 60);
}

function stripShell(command: string): string {
  const single = command.match(/^\S*(?:zsh|bash|sh) -l?c '([\s\S]*)'$/);
  if (single) return single[1]!;
  const double = command.match(/^\S*(?:zsh|bash|sh) -l?c "([\s\S]*)"$/);
  return double ? double[1]!.replace(/\\(["\\$`])/g, '$1') : command;
}

function mcpToolName(raw: string): string {
  return raw.startsWith('mcp__') ? raw.split('__').slice(2).join('__') : raw;
}

export class AgentManager {
  readonly chat: ChatStore;
  private runs = new Map<string, ActiveRun>();
  private emitTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly workspace: Workspace, private readonly options: AgentManagerOptions) {
    this.chat = new ChatStore(projectId => workspace.store.projectDir(projectId));
  }

  runningThread(projectId: string): string | null {
    return this.runs.get(projectId)?.threadId ?? null;
  }

  // ---- threads --------------------------------------------------------------

  createThread(projectId: string, title?: string): ChatThread {
    this.workspace.store.getProject(projectId);
    const thread = this.chat.create(projectId, title);
    broadcast({ type: 'chat_event', projectId, threadsChanged: true });
    return thread;
  }

  renameThread(projectId: string, threadId: string, title: string): ChatThread {
    const thread = this.chat.rename(projectId, threadId, title);
    broadcast({ type: 'chat_event', projectId, threadsChanged: true });
    return thread;
  }

  deleteThread(projectId: string, threadId: string): void {
    if (this.runs.get(projectId)?.threadId === threadId) throw new ConflictError('Stop the running agent before deleting this chat.');
    this.chat.delete(projectId, threadId);
    broadcast({ type: 'chat_event', projectId, threadsChanged: true, deletedThreadId: threadId });
  }

  // ---- lifecycle ------------------------------------------------------------

  start(input: StartRunInput): { thread: ChatThread; user: ChatMessage; assistant: ChatMessage } {
    const { store } = this.workspace;
    const project = store.getProject(input.projectId);
    const text = input.message.trim();
    if (!text) throw new ValidationError('Message is empty');
    if (this.runs.has(project.id)) throw new ConflictError('An agent is already working in this project. Wait for it or stop it.');
    if (this.runs.size >= MAX_CONCURRENT) throw new ConflictError('Too many agents running. Try again when one finishes.');
    const effort = input.effort || null;
    if (effort && !isValidEffort(input.runner, effort)) throw new ValidationError(`Unknown effort "${effort}" for ${input.runner}`);
    const bin = resolveBinary(input.runner);
    if (!bin) throw new ValidationError(`${input.runner} CLI not found on this machine`);

    const thread = input.threadId && input.threadId !== 'new'
      ? this.chat.get(project.id, input.threadId)
      : this.chat.create(project.id);
    const diagramId = input.diagramId && project.diagrams.some(d => d.id === input.diagramId)
      ? input.diagramId
      : this.workspace.activeDiagram()?.projectId === project.id ? this.workspace.activeDiagramId : project.diagrams[0]?.id ?? null;
    const sessionId = thread.sessions[input.runner];
    const history = sessionId ? [] : thread.messages.slice();
    const selectedIds = (input.selectedIds ?? []).filter(id => typeof id === 'string').slice(0, 50);
    const createdAt = nowIso();
    const base = {
      threadId: thread.id, projectId: project.id, diagramId, runner: input.runner, model: input.model || null, effort,
      costUsd: null, thinking: '', liveText: '', error: null
    };
    const user: ChatMessage = {
      ...base, id: randomUUID(), role: 'user', text, parts: [{ type: 'text', text }], selectedIds,
      status: 'done', createdAt, finishedAt: createdAt, durationMs: null, activity: null
    };
    const assistant: ChatMessage = {
      ...base, model: input.model || (input.runner === 'codex' ? codexConfiguredModel() : null),
      id: randomUUID(), role: 'assistant', text: '', parts: [], selectedIds: [],
      status: 'running', createdAt, finishedAt: null, durationMs: null,
      activity: { phase: 'starting', label: `Starting ${input.runner === 'claude' ? 'Claude Code' : 'Codex'}`, since: createdAt }
    };

    const prompt = buildTurnPrompt(this.workspace, {
      projectId: project.id,
      diagramId,
      selectedIds,
      includeBrain: !sessionId,
      includeRules: input.runner === 'codex' && !sessionId,
      history
    }, text);
    const cwd = project.rootPath && fs.existsSync(project.rootPath) ? project.rootPath : store.projectDir(project.id);
    const args = input.runner === 'claude'
      ? this.claudeArgs(prompt, project.id, sessionId, input.model || null, effort)
      : this.codexArgs(prompt, project.id, cwd, sessionId, input.model || null, effort);

    thread.messages.push(user, assistant);
    if (thread.title === 'New chat') thread.title = titleFrom(thread.messages);
    thread.updatedAt = createdAt;
    this.chat.save(project.id);
    broadcast({ type: 'chat_event', projectId: project.id, threadsChanged: true });

    const logPath = this.chat.runLogPath(project.id, assistant.id);
    let log: fs.WriteStream | null = null;
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      log = fs.createWriteStream(logPath, { flags: 'w' });
      log.write(`# ${createdAt} ${input.runner} ${sessionId ? `resume ${sessionId}` : 'new session'}\n# bin: ${bin}\n# cwd: ${cwd}\n# args: ${args.map(a => (a === prompt ? '<prompt>' : a.length > 200 ? `${a.slice(0, 200)}…` : a)).join(' ')}\n# prompt:\n${prompt}\n# ---- output ----\n`);
    } catch (error) {
      logger.warn('Could not open agent run log', { error: (error as Error).message });
    }

    const child = spawn(bin, args, { cwd, env: runnerEnv(), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const run: ActiveRun = {
      child, threadId: thread.id, message: assistant, cancelled: false, log, logBytes: 0, block: null,
      timer: setTimeout(() => {
        assistant.error = `Stopped after ${Math.round((this.options.timeoutMs ?? 0) / 60000)} minutes`;
        this.kill(run);
      }, this.options.timeoutMs ?? 15 * 60_000)
    };
    run.timer.unref();
    this.runs.set(project.id, run);
    logger.info('Agent run started', { projectId: project.id, threadId: thread.id, runner: input.runner, model: input.model || 'default', effort: effort ?? 'default', resumed: !!sessionId, cwd, log: logPath });

    let buffer = '';
    let stderr = '';
    child.stdout!.setEncoding('utf-8');
    child.stdout!.on('data', (chunk: string) => {
      this.writeLog(run, chunk);
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let event: Record<string, unknown>;
        try { event = JSON.parse(line); } catch { continue; }
        try {
          if (input.runner === 'claude') this.onClaudeEvent(thread, run, event);
          else this.onCodexEvent(thread, assistant, event);
        } catch (error) {
          logger.warn('Could not handle agent event', { error: (error as Error).message });
        }
        this.emit(assistant);
      }
    });
    child.stderr!.setEncoding('utf-8');
    child.stderr!.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-8000);
      this.writeLog(run, chunk.split('\n').map(l => (l ? `[stderr] ${l}` : l)).join('\n'));
    });

    const finish = (code: number | null, spawnError?: Error): void => {
      if (this.runs.get(project.id) !== run) return;
      clearTimeout(run.timer);
      this.runs.delete(project.id);
      assistant.finishedAt = nowIso();
      assistant.durationMs ??= Date.parse(assistant.finishedAt) - Date.parse(assistant.createdAt);
      assistant.activity = null;
      if (assistant.liveText.trim() && !assistant.parts.some(p => p.type === 'text')) this.appendText(assistant, assistant.liveText);
      assistant.liveText = '';
      for (const part of assistant.parts) if (part.type === 'tool' && part.status === 'running') part.status = run.cancelled ? 'error' : 'done';
      if (run.cancelled) {
        assistant.status = 'cancelled';
      } else if (spawnError) {
        assistant.status = 'error';
        assistant.error = spawnError.message;
      } else if (assistant.status === 'running') {
        if (code === 0 && !assistant.error) assistant.status = 'done';
        else {
          assistant.status = 'error';
          assistant.error ??= this.stderrSummary(stderr) || `${input.runner} exited with code ${code}`;
        }
      }
      if (!assistant.text && assistant.status === 'done') assistant.text = '(no reply)';
      thread.updatedAt = assistant.finishedAt;
      this.chat.save(project.id);
      run.log?.end(`\n# ---- exit ${code ?? 'signal'} · ${assistant.status}${assistant.error ? ` · ${assistant.error}` : ''} · ${assistant.durationMs} ms ----\n`);
      this.emit(assistant, true);
      broadcast({ type: 'chat_event', projectId: project.id, threadsChanged: true });
      const meta = { projectId: project.id, threadId: thread.id, status: assistant.status, code, ms: assistant.durationMs, cost: assistant.costUsd };
      if (assistant.status === 'error') logger.warn(`Agent run failed: ${assistant.error}`, meta);
      else logger.info('Agent run finished', meta);
    };
    child.on('error', error => finish(null, error));
    child.on('close', code => finish(code));

    this.emit(user, true);
    this.emit(assistant, true);
    return { thread, user, assistant };
  }

  cancel(projectId: string): boolean {
    const run = this.runs.get(projectId);
    if (!run) return false;
    run.cancelled = true;
    this.kill(run);
    return true;
  }

  stopAll(): void {
    for (const run of this.runs.values()) {
      run.cancelled = true;
      this.kill(run);
    }
  }

  private kill(run: ActiveRun): void {
    const pid = run.child.pid;
    if (!pid) return;
    try { process.kill(-pid, 'SIGTERM'); } catch { try { run.child.kill('SIGTERM'); } catch { /* gone */ } }
    setTimeout(() => {
      try { process.kill(-pid, 'SIGKILL'); } catch { /* exited */ }
    }, 3000).unref();
  }

  private writeLog(run: ActiveRun, chunk: string): void {
    if (!run.log || run.logBytes > MAX_LOG_BYTES) return;
    run.logBytes += chunk.length;
    run.log.write(run.logBytes > MAX_LOG_BYTES ? `${chunk}\n# ---- log truncated at 5 MB ----\n` : chunk);
  }

  // ---- CLI argument builders ------------------------------------------------

  private mcpServer(projectId: string): { command: string; args: string[]; env: Record<string, string> } {
    return {
      command: process.execPath,
      args: [this.options.mcpEntry],
      env: {
        EXPRESS_SERVER_URL: this.options.canvasUrl,
        EXCALIDRAW_NO_AUTOSTART: '1',
        // File exports from the agent land in the project's data folder, never in the user's repo.
        EXCALIDRAW_EXPORT_DIR: this.workspace.store.projectDir(projectId),
        LOG_LEVEL: 'warn'
      }
    };
  }

  private claudeArgs(prompt: string, projectId: string, sessionId: string | undefined, model: string | null, effort: string | null): string[] {
    return [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
      // Token-level events: live thinking, reply text and tool-input progress.
      '--include-partial-messages',
      '--mcp-config', JSON.stringify({ mcpServers: { excalidraw: this.mcpServer(projectId) } }),
      '--strict-mcp-config',
      // Drawing tools plus read-only file access; anything else is denied without a prompt.
      '--allowedTools', 'mcp__excalidraw', 'Read', 'Grep', 'Glob',
      '--permission-mode', 'dontAsk',
      '--append-system-prompt', AGENT_RULES,
      ...(sessionId ? ['--resume', sessionId] : []),
      ...(model ? ['--model', model] : []),
      ...(effort ? ['--effort', effort] : [])
    ];
  }

  private codexArgs(prompt: string, projectId: string, cwd: string, sessionId: string | undefined, model: string | null, effort: string | null): string[] {
    const server = this.mcpServer(projectId);
    const toml = (value: string): string => JSON.stringify(value);
    const env = `{${Object.entries(server.env).map(([k, v]) => `${k}=${toml(v)}`).join(',')}}`;
    const config = [
      '-c', 'sandbox_mode="read-only"',
      '-c', `mcp_servers.excalidraw.command=${toml(server.command)}`,
      '-c', `mcp_servers.excalidraw.args=[${server.args.map(toml).join(',')}]`,
      '-c', `mcp_servers.excalidraw.env=${env}`,
      // Headless runs cannot answer approval prompts; the workbench tools are the point.
      '-c', 'mcp_servers.excalidraw.default_tools_approval_mode="approve"',
      // The user's other MCP servers are not needed here and slow every start.
      ...codexUserMcpServers().flatMap(name => ['-c', `mcp_servers.${name}.enabled=false`]),
      ...(effort ? ['-c', `model_reasoning_effort=${toml(effort)}`] : []),
      ...(model ? ['-m', model] : [])
    ];
    return sessionId
      ? ['exec', 'resume', sessionId, '--json', '--skip-git-repo-check', ...config, prompt]
      : ['exec', '--json', '--skip-git-repo-check', '-C', cwd, ...config, prompt];
  }

  // ---- event parsing ----------------------------------------------------------

  private setActivity(message: ChatMessage, phase: ChatActivity['phase'], label: string): void {
    if (message.activity?.phase === phase && message.activity.label === label) return;
    const keepSince = message.activity?.phase === phase;
    message.activity = { phase, label, since: keepSince ? message.activity!.since : nowIso() };
  }

  private appendText(message: ChatMessage, text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    const last = message.parts[message.parts.length - 1];
    if (last?.type === 'text') last.text = `${last.text}\n\n${trimmed}`;
    else message.parts.push({ type: 'text', text: trimmed });
    message.text = message.parts.filter((p): p is Extract<ChatPart, { type: 'text' }> => p.type === 'text').map(p => p.text).join('\n\n');
  }

  private appendThinking(message: ChatMessage, text: string): void {
    if (!text) return;
    message.thinking = (message.thinking + text).slice(-MAX_THINKING_CHARS);
  }

  private onClaudeEvent(thread: ChatThread, run: ActiveRun, event: Record<string, unknown>): void {
    const message = run.message;
    const type = event.type;
    if (type === 'system' && event.subtype === 'init') {
      if (typeof event.session_id === 'string') this.rememberSession(thread, 'claude', event.session_id);
      if (typeof event.model === 'string') message.model = event.model;
      this.setActivity(message, 'thinking', 'Thinking');
      return;
    }
    if (type === 'stream_event') {
      const ev = (event.event ?? {}) as Record<string, unknown>;
      if (ev.type === 'message_start') {
        this.setActivity(message, 'thinking', 'Thinking');
      } else if (ev.type === 'content_block_start') {
        const block = (ev.content_block ?? {}) as Record<string, unknown>;
        const blockType = String(block.type);
        run.block = { type: blockType, tool: typeof block.name === 'string' ? mcpToolName(block.name) : undefined, bytes: 0 };
        if (blockType === 'thinking' || blockType === 'redacted_thinking') {
          if (message.thinking && !message.thinking.endsWith('\n\n')) this.appendThinking(message, '\n\n');
          this.setActivity(message, 'thinking', 'Thinking');
        } else if (blockType === 'text') {
          this.setActivity(message, 'replying', 'Writing a reply');
        } else if (blockType === 'tool_use' && run.block.tool && !HIDDEN_TOOLS.has(run.block.tool)) {
          this.setActivity(message, 'writing', `Preparing ${run.block.tool}`);
        }
      } else if (ev.type === 'content_block_delta') {
        const delta = (ev.delta ?? {}) as Record<string, unknown>;
        if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') this.appendThinking(message, delta.thinking);
        else if (delta.type === 'text_delta' && typeof delta.text === 'string') message.liveText += delta.text;
        else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string' && run.block?.tool && !HIDDEN_TOOLS.has(run.block.tool)) {
          run.block.bytes += delta.partial_json.length;
          this.setActivity(message, 'writing', `Writing ${run.block.tool} · ${kb(run.block.bytes)}`);
        }
      } else if (ev.type === 'content_block_stop') {
        run.block = null;
      }
      return;
    }
    if (type === 'assistant') {
      const content = ((event.message as { content?: unknown[] })?.content ?? []) as Array<Record<string, unknown>>;
      for (const block of content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          this.appendText(message, block.text);
          message.liveText = '';
        }
        if (block.type === 'thinking' && typeof block.thinking === 'string' && !message.thinking.includes(block.thinking.slice(0, 40))) {
          this.appendThinking(message, block.thinking);
        }
        if (block.type === 'tool_use' && typeof block.name === 'string') {
          const name = mcpToolName(block.name);
          if (HIDDEN_TOOLS.has(name)) continue;
          message.parts.push({
            type: 'tool',
            id: String(block.id ?? randomUUID()),
            name,
            kind: block.name.startsWith('mcp__') ? 'mcp' : READ_TOOLS.has(block.name) ? 'read' : 'other',
            detail: describeToolInput(name, block.input as Record<string, unknown> | undefined),
            status: 'running'
          });
          this.setActivity(message, 'tool', `Running ${name}`);
        }
      }
      return;
    }
    if (type === 'user') {
      const content = ((event.message as { content?: unknown[] })?.content ?? []) as Array<Record<string, unknown>>;
      for (const block of content) {
        if (block.type !== 'tool_result') continue;
        const part = message.parts.find(p => p.type === 'tool' && p.id === block.tool_use_id);
        if (part?.type !== 'tool') continue;
        if (block.is_error) {
          part.status = 'error';
          const text = Array.isArray(block.content)
            ? (block.content as Array<{ text?: string }>).map(c => c.text ?? '').join(' ')
            : String(block.content ?? '');
          part.error = compact(text, 160);
        } else {
          part.status = 'done';
        }
        this.setActivity(message, 'thinking', 'Thinking');
      }
      return;
    }
    if (type === 'result') {
      if (typeof event.session_id === 'string') this.rememberSession(thread, 'claude', event.session_id);
      if (typeof event.total_cost_usd === 'number') message.costUsd = event.total_cost_usd;
      if (typeof event.duration_ms === 'number') message.durationMs = event.duration_ms;
      if (event.is_error || (typeof event.subtype === 'string' && event.subtype !== 'success')) {
        message.error = typeof event.result === 'string' && event.result ? event.result : `Claude Code ended with ${String(event.subtype)}`;
        message.status = 'error';
      } else if (!message.text && typeof event.result === 'string') {
        this.appendText(message, event.result);
      }
    }
  }

  private onCodexEvent(thread: ChatThread, message: ChatMessage, event: Record<string, unknown>): void {
    const type = event.type;
    if (type === 'thread.started' && typeof event.thread_id === 'string') {
      this.rememberSession(thread, 'codex', event.thread_id);
      return;
    }
    if (type === 'turn.started') {
      this.setActivity(message, 'thinking', 'Thinking');
      return;
    }
    if (type === 'turn.failed') {
      message.error = String((event.error as { message?: string })?.message ?? 'Codex turn failed');
      message.status = 'error';
      return;
    }
    if (type === 'error') {
      message.error = String(event.message ?? 'Codex error');
      return;
    }
    if (type !== 'item.started' && type !== 'item.updated' && type !== 'item.completed') return;
    const item = (event.item ?? {}) as Record<string, unknown>;
    const id = String(item.id ?? randomUUID());
    const completed = type === 'item.completed';
    switch (item.type) {
      case 'reasoning':
        if (completed && typeof item.text === 'string') {
          if (message.thinking) this.appendThinking(message, '\n\n');
          this.appendThinking(message, item.text);
        }
        this.setActivity(message, 'thinking', 'Thinking');
        return;
      case 'agent_message':
        if (completed && typeof item.text === 'string') this.appendText(message, item.text);
        this.setActivity(message, 'thinking', 'Thinking');
        return;
      case 'mcp_tool_call':
      case 'command_execution':
      case 'web_search':
      case 'file_change': {
        let part = message.parts.find((p): p is Extract<ChatPart, { type: 'tool' }> => p.type === 'tool' && p.id === id);
        if (!part) {
          const isMcp = item.type === 'mcp_tool_call';
          let args: Record<string, unknown> | undefined;
          if (isMcp) {
            try { args = typeof item.arguments === 'string' ? JSON.parse(item.arguments) : item.arguments as Record<string, unknown>; } catch { args = undefined; }
          }
          const name = isMcp ? String(item.tool ?? 'tool') : item.type === 'command_execution' ? 'shell' : String(item.type);
          part = {
            type: 'tool',
            id,
            name,
            kind: isMcp ? (item.server === 'excalidraw' ? 'mcp' : 'other') : item.type === 'command_execution' ? 'command' : 'other',
            detail: isMcp ? describeToolInput(name, args) : item.type === 'command_execution' ? compact(stripShell(String(item.command ?? '')), 100) : compact(item.query ?? item.changes ?? '', 80),
            status: 'running'
          };
          message.parts.push(part);
        }
        this.setActivity(message, 'tool', `Running ${part.name === 'shell' ? compact(part.detail, 40) : part.name}`);
        const error = item.error as { message?: string } | null | undefined;
        if (item.status === 'failed' || error?.message || (typeof item.exit_code === 'number' && item.exit_code !== 0)) {
          part.status = 'error';
          part.error = compact(error?.message ?? (typeof item.exit_code === 'number' ? `exit ${item.exit_code}` : 'failed'), 160);
        } else if (completed || item.status === 'completed') {
          part.status = 'done';
        }
        if (completed) this.setActivity(message, 'thinking', 'Thinking');
        return;
      }
      default:
        return; // todo_list, warnings
    }
  }

  private rememberSession(thread: ChatThread, runner: RunnerId, sessionId: string): void {
    if (thread.sessions[runner] === sessionId) return;
    thread.sessions[runner] = sessionId;
    this.chat.save(thread.projectId);
  }

  private stderrSummary(stderr: string): string {
    const lines = stderr.split('\n').map(l => l.trim()).filter(Boolean)
      .filter(l => !/rmcp::|worker quit|Reading additional input|no stdin data/i.test(l));
    return lines.slice(-3).join(' ').slice(0, 400);
  }

  // Stream the assistant message to tabs, at most ~8 times a second.
  private emit(message: ChatMessage, immediate = false): void {
    const send = (): void => {
      this.emitTimers.delete(message.id);
      broadcast({ type: 'chat_event', projectId: message.projectId, threadId: message.threadId, message });
    };
    if (immediate) {
      const pending = this.emitTimers.get(message.id);
      if (pending) clearTimeout(pending);
      send();
      return;
    }
    if (this.emitTimers.has(message.id)) return;
    this.emitTimers.set(message.id, setTimeout(send, 120));
  }
}
