import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { RunnerId, RunnerInfo, RunnerOption } from './types.js';

// Find the local `claude` and `codex` binaries. The canvas server may have
// been started by an MCP client with a thin PATH, so look in the usual
// install locations too. EXCALIDRAW_CLAUDE_BIN / EXCALIDRAW_CODEX_BIN win.

const LABELS: Record<RunnerId, string> = { claude: 'Claude Code', codex: 'Codex' };
const ENV_OVERRIDE: Record<RunnerId, string> = { claude: 'EXCALIDRAW_CLAUDE_BIN', codex: 'EXCALIDRAW_CODEX_BIN' };

function candidateDirs(): string[] {
  const home = os.homedir();
  const fromPath = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  return [...new Set([
    ...fromPath,
    path.join(home, '.local', 'bin'),
    path.join(home, '.claude', 'local'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.volta', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin'
  ])];
}

function isExecutable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

export function resolveBinary(id: RunnerId): string | null {
  const override = process.env[ENV_OVERRIDE[id]];
  if (override) return isExecutable(override) ? override : null;
  for (const dir of candidateDirs()) {
    const file = path.join(dir, id);
    if (isExecutable(file)) return file;
  }
  return null;
}

function version(bin: string): Promise<string | null> {
  return new Promise(resolve => {
    execFile(bin, ['--version'], { timeout: 8000, env: runnerEnv() }, (error, stdout) => {
      resolve(error ? null : stdout.trim().split('\n')[0]?.slice(0, 80) ?? null);
    });
  });
}

// PATH for spawned CLIs: theirs plus the dirs we searched, so their own
// helpers (node, git, rg) resolve when we were launched with a thin PATH.
export function runnerEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...process.env, PATH: candidateDirs().join(path.delimiter), NO_COLOR: '1', ...extra };
}

// Model aliases each CLI accepts. "default" means: whatever the CLI is
// configured to use. Anything else can be typed as a custom model.
const MODELS: Record<RunnerId, RunnerOption[]> = {
  claude: [
    { value: '', label: 'Default' },
    { value: 'sonnet', label: 'Sonnet' },
    { value: 'haiku', label: 'Haiku (fastest)' },
    { value: 'opus', label: 'Opus' }
  ],
  codex: [{ value: '', label: 'Default' }]
};

const EFFORTS: Record<RunnerId, RunnerOption[]> = {
  claude: [
    { value: '', label: 'Default effort' },
    { value: 'low', label: 'Low effort (fast)' },
    { value: 'medium', label: 'Medium effort' },
    { value: 'high', label: 'High effort' },
    { value: 'xhigh', label: 'Extra-high effort' },
    { value: 'max', label: 'Max effort' }
  ],
  codex: [
    { value: '', label: 'Default effort' },
    { value: 'low', label: 'Low effort (fast)' },
    { value: 'medium', label: 'Medium effort' },
    { value: 'high', label: 'High effort' }
  ]
};

export function isValidEffort(runner: RunnerId, effort: string): boolean {
  return EFFORTS[runner].some(e => e.value === effort);
}

// Codex model shown as "Default" is read from its config so the picker can say which.
export function codexConfiguredModel(): string | null {
  try {
    const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    const toml = fs.readFileSync(path.join(home, 'config.toml'), 'utf-8');
    return toml.match(/^model\s*=\s*"([^"]+)"/m)?.[1] ?? null;
  } catch {
    return null;
  }
}

// Names of the user's own Codex MCP servers. Chat runs switch them off: the
// agent only needs the workbench, and servers that wait on auth add seconds
// to every start.
export function codexUserMcpServers(): string[] {
  try {
    const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    const toml = fs.readFileSync(path.join(home, 'config.toml'), 'utf-8');
    return [...new Set([...toml.matchAll(/^\[mcp_servers\.("?)([A-Za-z0-9_-]+)\1\]/gm)].map(m => m[2]!))].filter(n => n !== 'excalidraw');
  } catch {
    return [];
  }
}

let cache: { at: number; value: RunnerInfo[] } | null = null;

export async function detectRunners(force = false): Promise<RunnerInfo[]> {
  if (!force && cache && Date.now() - cache.at < 60_000) return cache.value;
  const value = await Promise.all((['claude', 'codex'] as RunnerId[]).map(async id => {
    const bin = resolveBinary(id);
    const models = id === 'codex'
      ? [{ value: '', label: `Default${codexConfiguredModel() ? ` (${codexConfiguredModel()})` : ''}` }]
      : MODELS[id];
    if (!bin) {
      return { id, label: LABELS[id], available: false, path: null, version: null, reason: `${id} not found on PATH (set ${ENV_OVERRIDE[id]} to its path)`, models, efforts: EFFORTS[id] };
    }
    const v = await version(bin);
    return { id, label: LABELS[id], available: v !== null, path: bin, version: v, reason: v === null ? `${bin} --version failed` : null, models, efforts: EFFORTS[id] };
  }));
  cache = { at: Date.now(), value };
  return value;
}
