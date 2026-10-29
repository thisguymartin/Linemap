import fs from 'fs';
import path from 'path';
import { CliUsageError, readStdin } from './args.js';
import { getHealth } from '../core/canvas-client.js';
import { EXPRESS_SERVER_URL } from '../core/config.js';

// Results go to stdout as JSON; diagnostics belong on stderr.
export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

export function note(message: string): void {
  process.stderr.write(message + '\n');
}

// Mermaid conversion and `--renderer browser` need a browser tab rendering
// the canvas; screenshots and image exports render headless by default.
export async function requireBrowserClient(what: string): Promise<void> {
  const health = await getHealth();
  if (health.websocket_clients === 0) {
    const error = new Error(
      `${what} requires the canvas to be open in a browser. Open ${EXPRESS_SERVER_URL} and retry.`
    );
    (error as any).code = 'BROWSER_REQUIRED';
    throw error;
  }
}

// Read JSON input from a positional file argument or stdin ("-" = stdin).
export async function readJsonInput(file: string | undefined, what: string): Promise<any> {
  const raw = file !== undefined && file !== '-' ? fs.readFileSync(file, 'utf-8') : await readStdin();
  if (!raw.trim()) {
    throw new CliUsageError(`No ${what} provided (pass a file argument or pipe JSON to stdin)`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new CliUsageError(`Invalid JSON ${what}: ${(error as Error).message}`);
  }
}

// How the user invoked us, for messages that tell them what to run next:
// "linemap" after `bun link`, otherwise e.g. "bun dist/bin.js".
export function cliName(): string {
  const script = process.argv[1] ?? '';
  const base = path.basename(script);
  if (base !== 'bin.js' && base !== 'bin.ts') return base.replace(/\.(js|ts)$/, '') || 'linemap';
  const runtime = path.basename(process.execPath).startsWith('bun') ? 'bun' : 'node';
  return `${runtime} ${path.relative(process.cwd(), script) || script}`;
}
