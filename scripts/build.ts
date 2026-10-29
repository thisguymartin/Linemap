#!/usr/bin/env bun
// Bundle the server side with Bun:
//   dist/bin.js         CLI + MCP stdio server (no arguments)
//   dist/server.js      canvas server (HTTP + WebSocket + browser UI)
//   dist/index.js       MCP stdio server, for configs that point here
//   dist/png-worker.js  PNG rasterizer child process
//   dist/testing.js     what scripts/check-*.mjs import
//   dist/render/excalidraw-node.mjs  Excalidraw's exporter for headless renders
// The browser app (dist/frontend) is built by Vite; this script leaves it alone.
//
//   bun scripts/build.ts            bundle
//   bun scripts/build.ts --watch    rebuild on change (dev)

import fs from 'node:fs';
import path from 'node:path';
import type { BunPlugin } from 'bun';

const root = path.resolve(import.meta.dir, '..');
const dist = path.join(root, 'dist');
const started = performance.now();

// Clear everything except the Vite build, so no stale module lingers.
fs.mkdirSync(dist, { recursive: true });
for (const entry of fs.readdirSync(dist)) {
  if (entry !== 'frontend') fs.rmSync(path.join(dist, entry), { recursive: true, force: true });
}

function report(label: string, result: Awaited<ReturnType<typeof Bun.build>>): void {
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`${label} build failed`);
  }
  for (const log of result.logs) if (log.level === 'warning') console.warn(`${label}: ${log.message}`);
  const size = result.outputs.reduce((sum, o) => sum + o.size, 0);
  console.log(`  ${label.padEnd(10)} ${result.outputs.filter(o => o.kind === 'entry-point').map(o => path.relative(root, o.path)).join(', ')}  (${(size / 1024).toFixed(0)} kB)`);
}

const app = await Bun.build({
  entrypoints: ['src/bin.ts', 'src/server.ts', 'src/index.ts', 'src/core/render/png-worker.ts', 'src/testing.ts'].map(p => path.join(root, p)),
  outdir: dist,
  naming: '[name].[ext]',
  target: 'node',
  format: 'esm',
  // Dependencies stay in node_modules: jsdom reads its own files at runtime
  // and @resvg/resvg-js is a native addon.
  packages: 'external',
  sourcemap: 'linked'
});
report('server', app);
for (const name of ['bin.js', 'server.js', 'index.js']) fs.chmodSync(path.join(dist, name), 0o755);

// Bun marks some outputs "// @bun" (already transpiled). Bun 1.4 then reads
// that file as Latin-1, garbling every non-ASCII character it prints (an em
// dash becomes "â"). Dropping the marker costs a re-parse and keeps text UTF-8.
function stripBunPragma(files: string[]): void {
  for (const file of files) {
    if (!/\.m?js$/.test(file)) continue;
    const text = fs.readFileSync(file, 'utf-8');
    const fixed = text.replace(/^(#![^\n]*\n)?\/\/ @bun[^\n]*\n/, '$1');
    if (fixed !== text) fs.writeFileSync(file, fixed);
  }
}
stripBunPragma(app.outputs.map(o => o.path));

// Mermaid (and the cytoscape/katex tree behind it) is only reachable from the
// editor's text-to-diagram dialog; the headless exporter never converts
// Mermaid, so a stub keeps this bundle small.
const mermaidStub: BunPlugin = {
  name: 'mermaid-stub',
  setup(build) {
    build.onResolve({ filter: /^(mermaid|@excalidraw\/mermaid-to-excalidraw)$/ }, () => ({
      path: path.join(root, 'scripts/stubs/mermaid-stub.mjs')
    }));
  }
};

const renderer = await Bun.build({
  entrypoints: [path.join(root, 'scripts/excalidraw-node-entry.mjs')],
  outdir: path.join(dist, 'render'),
  naming: 'excalidraw-node.mjs',
  target: 'node',
  format: 'esm',
  minify: true,
  external: ['jsdom', '*.chunk.js'],
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [mermaidStub]
});
report('renderer', renderer);
stripBunPragma(renderer.outputs.map(o => o.path));

console.log(`  bundled in ${Math.round(performance.now() - started)} ms`);
