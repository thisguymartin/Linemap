# Excalidraw Skill Cheatsheet

## Defaults

- Canvas base URL: `EXPRESS_SERVER_URL` (default `http://127.0.0.1:3000`); CLI also accepts `--url <canvasUrl>`
- Canvas health: `GET /health` or `linemap status`
- Auto-start: any canvas-touching CLI command starts the server if it's down (opt out with `EXCALIDRAW_NO_AUTOSTART=1`)

## CLI Reference

`bun dist/bin.js <command>` from the repo, or `linemap <command>` after `bun link`.
JSON results on stdout — except `describe` (plain text) and raw-content output when `--out` is omitted (`export` scene JSON, `screenshot --format svg`). Diagnostics on stderr. Exit codes: 0 ok, 1 error, 2 usage, 3 canvas unreachable, 4 browser tab required (only `mermaid` and `screenshot --renderer browser`). Explicit `start` overrides `EXCALIDRAW_NO_AUTOSTART=1`.

### Server

| Command | Description |
|---------|-------------|
| `start` | Start the canvas server (detached); prints URL + pid |
| `stop` | Stop the canvas server (identity-checked via `/health` — never signals foreign services) |
| `status` | Health, element count, renderers (`node` headless + browser tabs) |

### Elements

| Command | Description |
|---------|-------------|
| `add [file\|-]` | Batch create from a JSON array (file, `-`, or piped stdin); `--one '{...}'` for a single element |
| `apply [file\|-]` | Multi-op patch `{"create":[...],"update":[{"id":"a","set":{...}}],"delete":["id",...]}` in one call |
| `get <id>` | Get one element |
| `query` | `--type rectangle` `--bbox x0,y0,x1,y1` `--filter locked=true` (typed; nested keys like `label.text=API` work) `--filter-json '{...}'` |
| `update <id> --set '{...}'` | Update one element |
| `delete <id> [...]` | Delete elements |

### Scene

| Command | Description |
|---------|-------------|
| `describe` | AI-readable scene summary (ids, positions, labels, connections) — plain text |
| `screenshot` | Headless PNG/SVG render of the canvas (no browser tab); `--out f.png\|f.svg`, `--format png\|svg`, `--scale 1-4`, `--dark`, `--padding N`, `--no-background`, `--ids a,b`, `--frame <id>`, `--no-embed-fonts`, `--renderer browser` (use an open tab instead); PNG without `--out` → temp file path in JSON, SVG without `--out` → raw SVG |
| `render [file\|-]` | Render a `.excalidraw` / `.excalidraw.md` file to PNG/SVG offline — no canvas server; same flags as `screenshot` |
| `export [--out f.excalidraw] [--format json\|obsidian]` | Scene as .excalidraw JSON (stdout without `--out`); a `.md` out path writes Obsidian's .excalidraw.md format |
| `import [file\|-] [--replace]` | Import .excalidraw JSON or Obsidian .excalidraw.md (merge by default) |
| `mermaid [file\|-]` | Render Mermaid onto the canvas (**browser tab required**) |
| `share` | Encrypted upload → shareable excalidraw.com URL |
| `clear --yes` | Wipe the canvas |
| `snapshot save\|list\|restore [name]` | Named canvas snapshots |

### Arrange

| Command | Description |
|---------|-------------|
| `arrange align --ids a,b,c --to left\|center\|right\|top\|middle\|bottom` | Align (≥2 ids) |
| `arrange distribute --ids a,b,c --to horizontal\|vertical` | Even spacing (≥3 ids) |
| `arrange group --ids a,b` / `arrange ungroup --group <groupId>` | Group membership lives on element `groupIds` |
| `arrange lock\|unlock --ids a,b` | Toggle edit lock |
| `arrange duplicate --ids a,b [--offset 20,20]` | Clone with offset |

### Meta

| Command | Description |
|---------|-------------|
| `install-skill --dir <skills-root>` | Install this skill into an agent-chosen project/global skills root (replaces any existing copy) |
| `help [command]`, `--version` | Usage and version |

### Workspace

| Command | Description |
|---------|-------------|
| `project list\|create <name>\|show <ref>\|update <ref>\|link [ref] <folder>\|unlink [ref]\|delete <ref> --yes` | Projects (`--description`, `--tags a,b`, `--color #hex`, `--folder path`) |
| `diagram list\|create <name>\|open <ref>\|show <ref>\|active\|update <ref>\|delete <ref> --yes` | Diagrams (`--project ref`, `--no-open`, `--description`, `--tags`) |
| `version list\|save [label]\|confirm <v>\|restore <v>\|show <v>\|delete <v>` | Numbered versions of a diagram (`--diagram ref`, `--note`, `--author`, `--confirm`, `--unconfirm`, `--save-current label`) |
| `note list\|add "text"\|resolve <id>\|reopen <id>\|delete <id>` | Conversation notes (`--diagram ref`, `--elements a,b`, `--tags x`, `--agent`, `--author`, `--project-level`, `--all`) |
| `link list\|add --to <diagram>\|delete <id>` | Links between diagrams (`--from <diagram>`, `--from-element id`, `--to-element id`, `--relation r`) |
| `tag set\|add\|remove --ids a,b [--set x,y\|--add x\|--remove y] [--note ...]`, `tag find <tag>` | Element tags stored in `customData` |
| `context [--project ref]` | Markdown digest of a project for an agent |

## MCP Tools (52 total)

### Workspace: projects, diagrams, versions, notes, links, tags

| Tool | Description | Required params |
|------|-------------|-----------------|
| `list_projects` | All projects with counts | (none) |
| `create_project` | New project (domain) | `name`; optional `description`, `tags`, `color` |
| `get_project` | Project with diagrams and links | optional `project` |
| `update_project` / `delete_project` | Edit / delete (`confirm: true`) | `project` for delete |
| `get_project_context` | Markdown brain dump: diagrams, versions, tags, notes, links, linked folder | optional `project` |
| `link_project_folder` | Point a project at a local folder/repo (empty path unlinks) | `path` |
| `list_diagrams` / `create_diagram` / `update_diagram` / `delete_diagram` | Diagrams in a project; create opens on the canvas unless `open: false` | `name` for create |
| `open_diagram` | Put a diagram on the canvas | `diagram` |
| `get_active_diagram` | What the canvas shows + browser URL | (none) |
| `save_version` | Immutable numbered version | optional `diagram`, `label`, `note`, `author`, `confirm` |
| `list_versions` / `confirm_version` / `restore_version` / `delete_version` | Version history | `version` (id, number or `v3`) |
| `add_note` / `list_notes` / `resolve_note` | Conversation anchored to `elementIds` | `body` for add |
| `tag_elements` / `find_by_tag` | Semantic tags + element note in `customData` | `elementIds` / `tag` |
| `link_diagrams` / `list_links` / `delete_link` | Diagram↔diagram or shape→diagram links | `toDiagram` for link |

### Drawing (operates on the open diagram)


### Element CRUD

| Tool | Description | Required params |
|------|-------------|-----------------|
| `create_element` | Create shape/text/arrow/line | `type`, `x`, `y` |
| `get_element` | Get single element by ID | `id` |
| `update_element` | Update element properties | `id` |
| `delete_element` | Delete element | `id` |
| `query_elements` | Query by type/filters | (optional) `type`, `filter`, `bbox` |
| `batch_create_elements` | Create many at once | `elements[]` |
| `duplicate_elements` | Clone with offset | `elementIds[]`, (optional) `offsetX`, `offsetY` |

### Layout & Organization

| Tool | Description | Required params |
|------|-------------|-----------------|
| `align_elements` | Align to left/center/right/top/middle/bottom | `elementIds[]`, `alignment` |
| `distribute_elements` | Even spacing horizontal/vertical | `elementIds[]`, `direction` |
| `group_elements` | Group elements | `elementIds[]` |
| `ungroup_elements` | Ungroup | `groupId` |
| `lock_elements` | Lock elements | `elementIds[]` |
| `unlock_elements` | Unlock elements | `elementIds[]` |

### Scene Awareness (Iterative Refinement)

| Tool | Description | Required params |
|------|-------------|-----------------|
| `describe_scene` | AI-readable scene description (types, positions, labels, connections, bounding box) | (none) |
| `get_canvas_screenshot` | Returns a PNG of the canvas for visual verification (headless, no browser needed) | (optional) `background`, `dark`, `scale` (1-4), `padding`, `elementIds`, `frameId`, `renderer` ("auto"\|"node"\|"browser") |
| `get_resource` | Get scene/library/theme/elements | `resource` |

### File I/O & Export

| Tool | Description | Required params |
|------|-------------|-----------------|
| `export_scene` | Export to .excalidraw JSON (a `.md` filePath → Obsidian .excalidraw.md) | (optional) `filePath` |
| `import_scene` | Import from .excalidraw JSON or Obsidian .excalidraw.md | `mode` ("replace"\|"merge"), `filePath` or `data` |
| `export_to_image` | Export to PNG/SVG (headless, no browser needed; SVG embeds fonts) | `format` ("png"\|"svg"), (optional) `filePath`, `background`, `dark`, `scale` (1-4), `padding`, `elementIds`, `frameId`, `renderer` ("auto"\|"node"\|"browser") |
| `export_to_excalidraw_url` | Upload & get shareable excalidraw.com URL | (none) |

### State Management

| Tool | Description | Required params |
|------|-------------|-----------------|
| `clear_canvas` | Remove all elements | (none) |
| `snapshot_scene` | Save named snapshot | `name` |
| `restore_snapshot` | Restore from snapshot | `name` |

### Viewport & Camera

| Tool | Description | Required params |
|------|-------------|-----------------|
| `set_viewport` | Control camera: zoom-to-fit all/selected elements, center one element without changing zoom, or manual zoom/scroll (needs browser); specify one mode per request | (optional) `scrollToContent`, `scrollToElementIds`, `viewportZoomFactor` (0, 1], `scrollToElementId`, `zoom`, `offsetX`, `offsetY` |

### Design Guide

| Tool | Description | Required params |
|------|-------------|-----------------|
| `read_diagram_guide` | Get design best practices (colors, sizing, layout, anti-patterns) | (none) |

### Conversion

| Tool | Description | Required params |
|------|-------------|-----------------|
| `create_from_mermaid` | Mermaid diagram to Excalidraw | `mermaidDiagram` |

Notes:
- **CLI + MCP**: Set `text` on shapes to label them (auto-converts to `label.text`). Use `startElementId`/`endElementId` on arrows.
- **CLI `apply.update`**: Update entries can use either direct fields (`{"id":"a","x":120}`) or a `set` object (`{"id":"a","set":{"x":120}}`). Do not mix both forms in one update entry.
- **Raw REST**: Use `"label": {"text": "..."}` for shape labels. Use `"start": {"id": "..."}` / `"end": {"id": "..."}` for arrow binding. (Different format!)
- `fontFamily` must be a string (e.g. `"1"`, `"helvetica"`) or omitted — do NOT pass a number.
- `points` accepts both `[[x,y]]` tuples and `[{x,y}]` objects.
- **Curved arrows**: Use `"roundness": {"type": 2}` with 3+ points for smooth curves. Use `"elbowed": true` for right-angle routing.
- Prefer creating shapes first, then arrows, then alignment/grouping.

## Canvas REST API (HTTP)

### Elements

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/elements` | List all elements |
| `GET` | `/api/elements/:id` | Get element by ID |
| `POST` | `/api/elements` | Create element |
| `PUT` | `/api/elements/:id` | Update element |
| `DELETE` | `/api/elements/:id` | Delete element |
| `DELETE` | `/api/elements/clear` | Clear all elements |
| `GET` | `/api/elements/search?type=...` | Search with filters (exact string match + bbox) |
| `POST` | `/api/elements/batch` | Batch create |
| `POST` | `/api/elements/sync` | Overwrite import (clear + write) |
| `POST` | `/api/elements/from-mermaid` | Mermaid conversion via frontend |

### Export

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/export/image` | Render PNG/SVG headless: `{format, background?, renderer?: "auto"\|"node"\|"browser", dark?, scale?, padding?, elementIds?, frameId?, embedFonts?}` → `{data, renderer, width, height, warnings?}` |
| `POST` | `/api/export/image/result` | Frontend posts export result back |

### Viewport

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/viewport` | Set viewport/camera; body may include `scrollToContent`, `scrollToElementIds`, `viewportZoomFactor`, `scrollToElementId`, `zoom`, `offsetX`, `offsetY` (needs frontend) |
| `POST` | `/api/viewport/result` | Frontend posts viewport result back |

### Snapshots

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/snapshots` | Save snapshot `{name}` |
| `GET` | `/api/snapshots` | List snapshots |
| `GET` | `/api/snapshots/:name` | Get snapshot by name |

### Workspace

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/workspace` | Active diagram/project, data dir |
| `GET/POST` | `/api/projects` | List / create projects |
| `GET/PATCH/DELETE` | `/api/projects/:pid` | Project detail (diagrams + links) / edit / delete |
| `GET` | `/api/projects/:pid/context` | Markdown digest |
| `GET/POST` | `/api/projects/:pid/diagrams` | List / create (`open`, `scene`) |
| `GET/PATCH/DELETE` | `/api/diagrams/:did` | Diagram meta (`?scene=1` for elements) / edit / delete |
| `POST` | `/api/diagrams/:did/open` | Put on canvas |
| `PUT` | `/api/diagrams/:did/scene` | Replace a diagram's scene |
| `GET/POST` | `/api/diagrams/:did/versions` | List / save version |
| `GET/PATCH/DELETE` | `/api/versions/:vid` | Version (+scene) / confirm, relabel / delete |
| `POST` | `/api/versions/:vid/restore` | Restore (`saveCurrentAs`) |
| `GET/POST` | `/api/projects/:pid/notes` | Notes (`?diagramId=&elementId=`) / add |
| `PATCH/DELETE` | `/api/notes/:nid` | Resolve, edit / delete |
| `GET/POST` | `/api/projects/:pid/links`, `DELETE /api/links/:lid` | Links |
| `POST` | `/api/elements/tags` | `{elementIds, tags|addTags|removeTags, note, diagramId}` |
| `GET` | `/api/tags/:tag` | Elements carrying a tag |
| `GET` | `/api/agents` | Detected agent CLIs |
| `GET/POST` | `/api/projects/:pid/chats` | List chats / create one |
| `GET/PATCH/DELETE` | `/api/projects/:pid/chats/:tid` | Chat with messages / rename / delete |
| `POST` | `/api/projects/:pid/chats/:tid/messages` | Send `{message, runner, model, effort, diagramId, selectedIds}`; `:tid` = `new` starts a chat |
| `GET` | `/api/projects/:pid/chats/:tid/messages/:mid/log` | Raw CLI output of one run |
| `POST` | `/api/projects/:pid/chat/cancel` | Stop the running agent |
| `GET` | `/api/fs/dirs?path=` | Folder browser (loopback only) |
| `GET` | `/api/projects/:pid/folder`, `POST /api/projects/:pid/reveal` | Linked folder info / open in Finder |

### System

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check (`websocket_clients` = open browser tabs, `renderers` = `{node, browser}`, `activeDiagramId`) |
| `GET` | `/api/sync/status` | Memory/WebSocket stats |

## Design Guide (quick version)

Stroke/fill pairs: `#e03131`/`#ffc9c9` red, `#2f9e44`/`#b2f2bb` green, `#1971c2`/`#a5d8ff` blue, `#9c36b5`/`#eebefa` purple, `#e8590c`/`#ffd8a8` orange, `#0c8599`/`#99e9f2` cyan, `#868e96`/`#e9ecef` gray.
Styling: `"fillStyle": "solid"` for crisp flat fills (default is sketchy hachure); `"strokeStyle": "dashed"` for zone borders / async arrows.
Sizing: shapes ≥ 120×60 with width ≥ `labelChars * 12`, fonts ≥ 16 (titles ≥ 20), gaps 40–80px (120px+ for labeled arrows), align to a 20px grid.
Order of work: background zones → primary shapes (with `text`) → arrows (bound via ids) → annotations → refine (align/distribute/screenshot).
MCP mode has the full guide behind the `read_diagram_guide` tool.
