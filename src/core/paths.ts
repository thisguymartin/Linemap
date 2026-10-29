import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Where things live, independent of how the code runs: bundled into a few
// files under dist/ (bun build), or straight from src/ (`bun src/bin.ts`,
// `bun --watch src/server.ts`). Every file lookup goes through here instead
// of counting "../" from the current module, which a bundle would break.

const PACKAGE_NAME = 'linemap';

let cachedRoot: string | null = null;

export function packageRoot(): string {
  if (cachedRoot) return cachedRoot;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const manifest = path.join(dir, 'package.json');
    try {
      if (JSON.parse(fs.readFileSync(manifest, 'utf-8')).name === PACKAGE_NAME) {
        cachedRoot = dir;
        return dir;
      }
    } catch { /* keep walking */ }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`Could not find the ${PACKAGE_NAME} package root above ${fileURLToPath(import.meta.url)}`);
    dir = parent;
  }
}

// True when this process runs the TypeScript sources directly (Bun).
export function runningFromSource(): boolean {
  return fileURLToPath(import.meta.url).endsWith('.ts');
}

export type Entry = 'bin' | 'server' | 'png-worker';

const ENTRY_SOURCES: Record<Entry, string> = {
  bin: 'src/bin.ts',
  server: 'src/server.ts',
  'png-worker': 'src/core/render/png-worker.ts'
};

const ENTRY_BUNDLES: Record<Entry, string> = {
  bin: 'dist/bin.js',
  server: 'dist/server.js',
  'png-worker': 'dist/png-worker.js'
};

// Script to hand to a child process for one of our entry points. Running
// from source spawns the source (Bun runs it); otherwise the bundle.
export function entryPath(entry: Entry): string {
  return path.join(packageRoot(), runningFromSource() ? ENTRY_SOURCES[entry] : ENTRY_BUNDLES[entry]);
}

export function assetPath(...parts: string[]): string {
  return path.join(packageRoot(), ...parts);
}
