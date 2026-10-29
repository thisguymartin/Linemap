import { spawn as spawnProcess, execFileSync } from 'child_process';
import fsSync from 'fs';
import os from 'os';
import pathMod from 'path';
import { entryPath } from '../../core/paths.js';
import { RESOLVED_LOG_FILE_PATH } from '../../utils/logger.js';
import { logs as followLogs } from './logs.js';
import { parseArgs } from '../args.js';
import { printJson, note, cliName } from '../util.js';
import { ensureCanvasRunning, stopCanvas, canvasPort, isCanvasHealth, foreignServiceError } from '../../core/spawn.js';
import { getHealth, getSyncStatus } from '../../core/canvas-client.js';
import { EXPRESS_SERVER_URL } from '../../core/config.js';
import { readPidFile } from '../../core/pidfile.js';

export async function start(argv: string[]): Promise<void> {
  parseArgs(argv, {});

  // Explicit start is user intent — it overrides the auto-start opt-outs
  const result = await ensureCanvasRunning({ force: true });
  if (!result.spawned) {
    note(`Canvas server already running at ${result.url}`);
  }
  printJson({
    running: true,
    url: result.url,
    spawned: result.spawned,
    pid: readPidFile(canvasPort()) ?? undefined
  });
}

export async function stop(argv: string[]): Promise<void> {
  parseArgs(argv, {});
  const result = await stopCanvas();
  printJson(result);
}

export async function status(argv: string[]): Promise<void> {
  parseArgs(argv, {});

  let health;
  try {
    health = await getHealth();
  } catch {
    printJson({ running: false, url: EXPRESS_SERVER_URL });
    const error = new Error(`Canvas server is not running at ${EXPRESS_SERVER_URL}`);
    (error as any).code = 'CANVAS_UNREACHABLE';
    (error as any).quiet = true; // JSON above already tells the story
    throw error;
  }

  if (!isCanvasHealth(health)) {
    printJson({
      running: false,
      url: EXPRESS_SERVER_URL,
      conflict: 'another service (or a pre-1.1 canvas build) is answering at this URL'
    });
    const error = foreignServiceError();
    (error as any).quiet = true;
    throw error;
  }

  let sync: Record<string, unknown> = {};
  try {
    sync = await getSyncStatus();
  } catch { /* health is enough */ }

  printJson({
    running: true,
    url: EXPRESS_SERVER_URL,
    // Prefer the pid the server reports about itself; the pidfile can be stale
    pid: health.pid ?? readPidFile(canvasPort()) ?? undefined,
    elements: health.elements_count,
    browserClients: health.websocket_clients,
    // Older servers predate the headless renderer and only report tabs
    renderers: health.renderers ?? { node: false, browser: health.websocket_clients },
    ...sync
  });
}

// ---- up: run the canvas in this terminal -----------------------------------


function findBun(): string | null {
  const candidates = [process.env.BUN_INSTALL ? pathMod.join(process.env.BUN_INSTALL, 'bin', 'bun') : '', pathMod.join(os.homedir(), '.bun', 'bin', 'bun'), '/opt/homebrew/bin/bun', '/usr/local/bin/bun'];
  for (const file of candidates) if (file && fsSync.existsSync(file)) return file;
  try { return execFileSync('which', ['bun'], { encoding: 'utf-8' }).trim() || null; } catch { return null; }
}

function openBrowser(url: string): void {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  const child = spawnProcess(cmd, args as string[], { detached: true, stdio: 'ignore' });
  child.on('error', () => note(`Open ${url} in your browser.`));
  child.unref();
}

/**
 * Run the canvas server in the foreground with its log in this terminal.
 *   up                 info-level log (agent runs, saves, errors)
 *   up --quiet         errors only
 *   up --verbose       everything (debug)
 *   up --open          also open the browser
 *   up --bun / --node  pick the server's runtime (default: whatever runs this command)
 *   up --port 3100     pick the port (or set EXPRESS_SERVER_URL)
 * Ctrl-C stops it. If one is already running on that port, `up` attaches to
 * its log instead (or just prints the URL with --quiet).
 */
export async function up(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv, {
    port: { takesValue: true }, quiet: { takesValue: false }, q: { takesValue: false },
    verbose: { takesValue: false }, v: { takesValue: false }, open: { takesValue: false },
    bun: { takesValue: false }, node: { takesValue: false }
  });
  const port = flags.port ? Number(flags.port) : canvasPort();
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port: ${String(flags.port)}`);
  const url = `http://127.0.0.1:${port}`;
  const quiet = !!(flags.quiet || flags.q);
  const verbose = !!(flags.verbose || flags.v);
  const consoleLevel = quiet ? 'error' : verbose ? 'debug' : 'info';

  const existing = await fetch(`${url}/health`, { signal: AbortSignal.timeout(800) }).then(r => r.json() as Promise<{ service?: string; pid?: number }>).catch(() => null);
  if (existing) {
    if (!isCanvasHealth(existing as never)) throw foreignServiceError();
    note(`Already running at ${url} (pid ${existing.pid}). Stop it with: ${cliName()} stop${port !== 3000 ? ` --url ${url}` : ''}`);
    if (flags.open) openBrowser(url);
    if (quiet) return;
    note('Showing its log instead. Ctrl-C detaches; the server keeps running.');
    await followLogs(['-f', '--lines', '20']);
    return;
  }

  // Default: the runtime running this command (bun dist/bin.js -> Bun).
  let runtime = process.execPath;
  if (flags.bun && flags.node) throw new Error('Pick one of --bun or --node.');
  if (flags.bun) {
    const bun = findBun();
    if (!bun) throw new Error('Bun not found. Install it (curl -fsSL https://bun.sh/install | bash) or drop --bun.');
    runtime = bun;
  } else if (flags.node) {
    try { runtime = execFileSync('which', ['node'], { encoding: 'utf-8' }).trim(); } catch { throw new Error('Node not found on PATH. Drop --node.'); }
  }
  const serverJs = entryPath('server');
  const child = spawnProcess(runtime, [serverJs], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_CONSOLE_LEVEL: consoleLevel, LOG_LEVEL: verbose ? 'debug' : (process.env.LOG_LEVEL ?? 'info'), NO_COLOR: '1' }
  });

  const stop = (signal: NodeJS.Signals): void => { if (child.exitCode === null) child.kill(signal); };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  const deadline = Date.now() + 10_000;
  let ready = false;
  while (Date.now() < deadline && child.exitCode === null) {
    const health = await fetch(`${url}/health`, { signal: AbortSignal.timeout(400) }).then(r => r.json() as Promise<Record<string, unknown>>).catch(() => null);
    if (health) {
      ready = true;
      const agents = await fetch(`${url}/api/agents`).then(r => r.json() as Promise<{ runners?: Array<{ label: string; available: boolean; version: string | null }> }>).catch(() => null);
      const runners = (agents?.runners ?? []).map(r => `${r.label} ${r.available ? (r.version?.match(/\d+\.\d+\.\d+/)?.[0] ?? 'ok') : 'not found'}`).join(' · ');
      const runtimeName = pathMod.basename(runtime).startsWith('bun') ? `Bun ${execFileSync(runtime, ['--version'], { encoding: 'utf-8' }).trim()}` : `Node ${process.versions.node}`;
      process.stderr.write([
        '',
        `  Linemap   ${url}`,
        `  runtime   ${runtimeName}`,
        `  data      ${health.dataDir}`,
        `  log file  ${RESOLVED_LOG_FILE_PATH}`,
        `  agents    ${runners || 'none found'}`,
        `  logging   ${quiet ? 'errors only (--quiet)' : verbose ? 'everything (--verbose)' : 'info (use --quiet or --verbose)'}`,
        '  Ctrl-C to stop',
        '',
        ''
      ].join('\n'));
      if (flags.open) openBrowser(url);
      break;
    }
    await new Promise(r => setTimeout(r, 150));
  }
  if (!ready && child.exitCode === null) note(`Server did not answer at ${url} within 10s; still waiting on it.`);

  const code = await new Promise<number>(resolve => child.on('exit', c => resolve(c ?? 0)));
  if (!ready) {
    const error = new Error(`Canvas server exited (code ${code}) before it was ready. See the output above or ${RESOLVED_LOG_FILE_PATH}.`);
    (error as Error & { quiet?: boolean }).quiet = false;
    throw error;
  }
  process.exitCode = code;
}
