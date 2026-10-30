#!/usr/bin/env bun

// Single entry for Linemap and the legacy excalidraw-mcp alias:
//
//   no arguments  -> MCP stdio server (backward compatible with MCP clients)
//   <subcommand>  -> CLI
//
// IMPORTANT: never import ./server.js here. The CLI and MCP server reach the
// canvas only by spawning it as a child process (see core/spawn.ts), and the
// MCP module graph loads lazily so CLI commands start fast.

// Disable colors to prevent ANSI color codes from breaking JSON parsing
process.env.NODE_DISABLE_COLORS = '1';
process.env.NO_COLOR = '1';

const argv = process.argv.slice(2);

// Global --url flag: must land in the environment before any core module
// (which reads EXPRESS_SERVER_URL at import time) is loaded.
for (let i = 0; i < argv.length; i++) {
  const token = argv[i]!;
  if (token === '--url' && argv[i + 1]) {
    process.env.EXPRESS_SERVER_URL = argv[i + 1];
    argv.splice(i, 2);
    break;
  }
  if (token.startsWith('--url=')) {
    process.env.EXPRESS_SERVER_URL = token.slice('--url='.length);
    argv.splice(i, 1);
    break;
  }
}

if (argv.length === 0) {
  // MCP mode: stdout belongs to the JSON-RPC transport from here on
  const { runServer } = await import('./mcp-stdio.js');
  await runServer();
} else {
  const { runCli } = await import('./cli/run.js');
  await runCli(argv);
}

export {};
