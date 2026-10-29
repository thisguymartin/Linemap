# Linemap

Linemap (package `linemap`, repo folder `excalidraw_mcp`) is a self-hosted Excalidraw workbench for AI agents: canvas server (Express 5 + WebSocket) + MCP stdio server + CLI, with a file-backed workspace (projects → diagrams → versions, notes, links). Started from yctimlin/mcp_excalidraw; the workspace layer and the browser UI are ours.

## Commands

- Bun is the toolchain: `bun install` · `bun run build` (Vite frontend → `dist/frontend`; `scripts/build.ts` = `Bun.build` → `dist/{bin,server,index,png-worker,testing}.js` + `dist/render/excalidraw-node.mjs`) · `bun run type-check` (tsc --noEmit only, never emits)
- `bun dist/bin.js up [--open] [--quiet|--verbose]` runs the canvas in the terminal with its log; `start|stop|status` background; no args = MCP stdio server
- `bun run dev` (`bun --watch src/server.ts` + Vite on :5173 proxying :3000); `bun src/bin.ts <cmd>` runs the CLI from source
- `bun run test` (all server suites on Bun) · `bun run test:node` (bundle on Node) · `bun run test:canvas` (Playwright)
- `bun dist/bin.js logs -f --agent` follows agent runs; server log is `~/Library/Logs/linemap.log`
- `bun run capture:review` seeds a throwaway workspace and screenshots the UI into `.impeccable/review/`

## Layout

- `src/server.ts` entry → `src/server/app.ts` (routes, WebSocket) · `src/server/live-scene.ts` is the one live canvas (elements/files maps; `markSceneDirty()` after every mutation)
- `src/domain/` model, `store.ts` (atomic JSON writes under `data/`), `workspace.ts` (active diagram, autosave, versions, tags), `context.ts` (the markdown "brain")
- `src/core/` drawing toolkit from upstream + `workspace-client.ts`, `mcp-workspace-tools.ts`, `mcp-workspace-dispatch.ts`
- `src/cli/commands/workspace.ts` project/diagram/version/note/link/tag/context subcommands
- `src/agent/` chat with local CLIs: `runners.ts` (find claude/codex), `prompt.ts` (rules + per-turn context), `manager.ts` (spawn, parse stream-json / codex --json, resume, cancel), `chat-store.ts` (`chat.json`: threads, each with per-CLI session ids; run logs in `runs/`)
- `src/server/guard.ts` rejects foreign Origin/Host; agents and `/api/fs` only exist on a loopback bind
- `frontend/src/` React 19: `workspace.tsx` (socket + active diagram store), `pages/CanvasPage.tsx` (Excalidraw + sync; the sync/scene-protection logic is ported from upstream and covered by `tests/browser`), `components/` panel tabs, station line, transit map; `styles.css` holds every token

## Rules

- Never locate files by counting `../` from `import.meta.url`: bundles flatten paths. Use `src/core/paths.ts` (`packageRoot()`, `assetPath()`, `entryPath('server'|'bin'|'png-worker')`, which picks `src/*.ts` when running from source and `dist/*.js` otherwise). Child processes use `process.execPath` so they inherit Bun or Node.
- Check scripts import from `dist/testing.js` only; add exports there instead of reaching into the bundle.
- `scripts/build.ts` strips the `// @bun` marker from outputs: Bun 1.4 decodes marked files as Latin-1 and garbles non-ASCII text.
- Drawing tools always act on the active diagram; never add a second live scene.
- Every live-scene mutation calls `markSceneDirty()`; versions are explicit, autosave is implicit.
- Element tags/notes live in Excalidraw `customData` (`tags`, `note`); keep it that way so exports carry them.
- Tests must point servers at a temp `EXCALIDRAW_DATA_DIR`; never write to `./data` from tests.
- Agents stay read-only on user code: Claude `--allowedTools mcp__excalidraw Read Grep Glob --permission-mode dontAsk`, Codex `sandbox_mode="read-only"`. Never add Bash/Edit/Write or a bypass flag. `scripts/check-agent.mjs` asserts this.
- CLI name collision: `version` is a subcommand; the package version is `--version`/`-v` only.
- UI: one route colour per project is the only accent; derive ink/button/text through `frontend/src/color.ts`; icons are the inline SVG set in `icons.tsx`, no emoji glyphs. Design context: PRODUCT.md, DESIGN.md, `.impeccable/surfaces/frontend-src-app-tsx.md`.
- Naming: the product is Linemap. The MCP server key stays `excalidraw` (tools are `mcp__excalidraw__*`, agents are allowed `mcp__excalidraw`); the bin has a legacy `excalidraw-mcp` alias and the CLI still recognises the old `excalidraw-mcp-canvas` health identity.
- Commits: no AI attribution lines (see global CLAUDE.md).
