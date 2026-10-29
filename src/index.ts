#!/usr/bin/env bun
// Entry: the MCP stdio server (kept for configs that point at dist/index.js).
// `dist/bin.js` with no arguments does the same thing.
import { runServer } from './mcp-stdio.js';

export { runServer, createExcalidrawMcpServer, excalidrawMcpServerFactory } from './mcp-stdio.js';

await runServer();
