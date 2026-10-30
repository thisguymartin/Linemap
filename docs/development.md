# Development

## Build

Bun installs the dependencies, bundles the server and runs it.

```bash
bun install
bun run build        # about 2.5 s
bun run type-check   # tsc, no output files
```

| Part | Built by | Output |
|------|----------|--------|
| CLI, MCP server, canvas server, PNG worker | `bun build`, in `scripts/build.ts` | `dist/bin.js`, `dist/index.js`, `dist/server.js`, `dist/png-worker.js` |
| Excalidraw's exporter for headless renders | the same script, with Mermaid swapped for a stub | `dist/render/excalidraw-node.mjs` |
| Browser app | Vite, run by Bun | `dist/frontend/` |
| Exports the test scripts import | `bun build` | `dist/testing.js` |

The browser app stays on Vite because Excalidraw loads its font subsets by file name, and Vite's chunk naming keeps those names stable.

Bun runs the bundle, and so does Node 22.13 or newer: `node dist/bin.js …`, `up --node`, or `bun run test:node`. The SQLite drivers are built into both runtimes (`bun:sqlite` and `node:sqlite`); no native addon install is needed. Node 20 is no longer supported. That matters for MCP clients that can only launch `node`. Child processes (the canvas server, the PNG worker, the MCP server handed to chat runs) use whichever runtime started their parent.

## Working on it

```bash
bun run dev
```

This runs the canvas server straight from `src/` with `bun --watch`, and the Vite dev server on port 5173, which forwards API calls to the canvas on port 3000. `bun src/bin.ts <command>` runs the CLI from source.

Code that needs a file path (the server entry, fonts, the data folder, the skill) must go through `src/core/paths.ts`. It finds the package root by walking up to `package.json`, so the same code works from `src/` and from the bundle.

## Tests

```bash
bun run test           # every server suite, on Bun
bun run test:node      # MCP, workspace and agent suites on Node
bun run test:canvas    # Playwright, in Chromium (bunx playwright install chromium first)
```

| Suite | Checks |
|-------|--------|
| `check-storage` | SQLite import/retry, relationships, rollback, chat history, cross-connection reads and schema versions |
| `check-mcp-stdio` | MCP over stdio, old and new protocol versions |
| `check-local-bind` | The server binds to loopback only and refuses duplicate starts |
| `check-render` | Headless SVG and PNG rendering, fonts, frames, determinism |
| `check-state-integrity` | Imports and snapshot restores replace the scene atomically |
| `check-workspace` | Projects, diagrams, versions, notes, links, tags, the project context, switching diagrams, restart persistence, MCP tools, CLI |
| `check-agent` | The request guard, folder linking, chat streaming, resume, switching agents, cancel, run logs, and the exact flags each CLI is started with |
| `tests/browser` | Scene loading and syncing in a real browser |

`check-agent` swaps the real CLIs for `scripts/fixtures/fake-agent.mjs`, which prints the same event formats, so it costs nothing and runs offline. It also asserts that neither agent is ever given write tools or bypass flags.

## Screenshots

```bash
node scripts/capture-docs.mjs                # the images in docs/images, with real agents (a few cents)
node scripts/capture-docs.mjs --fake-agents  # same screens, stand-in agents, no cost
bun run capture:review                       # review captures in .impeccable/review
```

`capture-docs.mjs` starts a throwaway server, builds a demo workspace, types two messages into the Chat tab (one for Claude Code, one for Codex) and photographs each screen. It also draws `architecture.png` through the REST API and exports it with the headless renderer.

## Docker

```bash
docker compose up --build
```

The image runs the canvas server on Bun, listening on all interfaces with its data in a volume. Because it is not bound to loopback, the Chat tab and folder browser are off inside the container.
