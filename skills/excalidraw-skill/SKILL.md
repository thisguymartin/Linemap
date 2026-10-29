---
name: excalidraw-skill
description: Linemap, an Excalidraw workbench for AI agents: a live canvas plus persistent projects, diagrams, numbered versions, notes anchored to shapes, element tags and links between diagrams. Use when an agent needs to (1) draw or lay out diagrams on a canvas the user can watch, (2) refine them by describing the scene and screenshotting its own work, (3) keep diagrams in a project and save/confirm/restore versions, (4) read or leave notes and tags so humans and later agents share context, (5) export/import .excalidraw files or PNG/SVG, or (6) convert Mermaid. Primary interface is the MCP server (excalidraw/* tools); the CLI (`bun dist/bin.js <command>` from the repo, or `linemap <command>` after `bun link`) is equivalent.
---

# Linemap Skill

## Step 0: Orient

One canvas server holds many projects; exactly one diagram is **open on the canvas** at a time, and every drawing tool operates on it. Before drawing in a project you have not seen this session:

1. `get_active_diagram` — what is on the canvas right now, and the browser URL to tell the user.
2. `get_project_context` — the project brain: diagrams, versions, element tags, notes (human questions you should answer), and links. Read it; it is cheap.
3. `open_diagram` or `create_diagram` to put the right diagram on the canvas. Creating a diagram opens it by default.

Pick an interface:

- **MCP tools** (preferred when `excalidraw/*` tools are listed): results land in your context and screenshots come back as images.
- **CLI**: from the repo, `bun dist/bin.js <command>`; after `bun link`, `linemap <command>`. Canvas-touching commands auto-start the server on `http://127.0.0.1:3000` (opt out with `EXCALIDRAW_NO_AUTOSTART=1`). JSON on stdout, diagnostics on stderr. Exit codes: 0 ok, 1 error, 2 usage, 3 canvas unreachable, 4 browser tab required.
- **REST**: see `references/cheatsheet.md`.

Tell the user the canvas URL (`/p/<project>/d/<diagram>`); the browser follows whatever diagram you open.

### Workspace quick reference

| Task | MCP tool | CLI |
|------|----------|-----|
| Where am I? | `get_active_diagram`, `list_projects` | `diagram active`, `project list` |
| Read the brain | `get_project_context` | `context [--project ref]` |
| Point at the repo | `link_project_folder` | `project link [ref] <folder>` |
| New project / diagram | `create_project`, `create_diagram` | `project create <name>`, `diagram create <name>` |
| Switch canvas | `open_diagram` | `diagram open <ref>` |
| Save progress | `save_version` (label, note, author) | `version save [label] [--note ...]` |
| Sign-off | `confirm_version` (normally the human does this in the UI) | `version confirm <v>` |
| Roll back | `restore_version` (optionally `saveCurrentAs`) | `version restore <v> [--save-current label]` |
| Talk | `add_note` (with `elementIds`), `list_notes`, `resolve_note` | `note add "..." --elements a,b --agent`, `note list` |
| Tag shapes | `tag_elements`, `find_by_tag` | `tag add --ids a,b --add x`, `tag find x` |
| Connect diagrams | `link_diagrams`, `list_links`, `delete_link` | `link add --to <diagram> [--from-element id]` |

Refs are forgiving: a project is an id, slug or name; a diagram an id or name (scoped to the active project unless you pass `project`); a version an id, number or `v3`.

### Drawing quick reference (acts on the open diagram)

| Task | MCP tool | CLI |
|------|----------|-----|
| Create elements | `batch_create_elements`, `create_element` | `add elements.json` / `add --one '{...}'` / `apply patch.json` |
| Read | `describe_scene`, `get_element`, `query_elements` | `describe`, `get <id>`, `query [--type t] [--filter k=v]` |
| Change | `update_element`, `delete_element` | `update <id> --set '{...}'`, `delete <id>` |
| See it | `get_canvas_screenshot` (headless PNG) | `screenshot [--out f.png]` |
| Layout | `align_elements`, `distribute_elements`, `group_elements`, `lock_elements`, `duplicate_elements` | `arrange align|distribute|group|lock|duplicate --ids ...` |
| Files | `export_scene`, `import_scene`, `export_to_image` | `export`, `import`, `render` |
| Mermaid | `create_from_mermaid` (needs an open tab) | `mermaid diagram.mmd` |
| Camera | `set_viewport` (needs an open tab) | — |
| Scratch undo | `snapshot_scene` / `restore_snapshot` (in-memory) | `snapshot save|restore <name>` |

Element format (CLI and MCP): `text` on a shape becomes a bound label; arrows bind with `startElementId` / `endElementId` and auto-route to edges; `fontFamily` accepts names (`"helvetica"`, `"cascadia"`); `points` accepts `[[x,y]]` or `[{x,y}]`. Raw REST needs `label: {text}` and `start: {id}` / `end: {id}`.

---

## Inside the browser Chat tab

When you are launched from the workbench's Chat tab, your prompt already contains `<project-brain>` (first turn) and `<workbench-now>` (active diagram, selection, scene description). Do not re-fetch what is there. You can read the linked folder but cannot edit it. Keep answers short; the user is watching the canvas.

## Workflow: a session in a project

1. `get_project_context`. Answer open human notes first (`add_note` with `elementIds` on the shapes they asked about, then `resolve_note` once the human's question is dealt with or leave it for them to resolve).
2. `open_diagram` the one you will change (or `create_diagram` with a one-sentence `description`).
3. `describe_scene` → plan the coordinate grid → `batch_create_elements` → `get_canvas_screenshot` → fix → repeat (Quality Checklist below).
4. `tag_elements` the shapes that mean something (`component`, `safety`, `external`, …) and give important ones a short `note`. Tags live in Excalidraw `customData` and survive export.
5. `link_diagrams` when a shape deserves its own diagram (`fromElementId` + `toDiagram`, relation `drills-into`): the shape becomes clickable in the browser.
6. `save_version` with a label and a note saying what changed and why. Do not `confirm`; the human confirms in the UI after checking.
7. `add_note` summarising decisions and open questions for the human.

The live canvas autosaves on its own; versions are the explicit history. Snapshots are scratch undo points that vanish on restart.

## Coordinate system and spacing

(0, 0) is the origin, x grows rightward, y grows downward. Plan tiers before writing JSON.

- Vertical gap between tiers 80–120px; horizontal gap 40–60px (120px+ for labeled arrows).
- Shape width `max(160, labelChars * 12)`; height 60 (one line) or 80 (two lines).
- Background zones: 50px padding around their children.
- `"fillStyle": "solid"` for flat fills; pastel `backgroundColor` with its darker `strokeColor` (palette in the cheatsheet); `"strokeStyle": "dashed"` for zone borders and async arrows.

## Layout anti-patterns

1. **No `text`/`label` on large background zone rectangles.** The bound label centres itself over everything inside. Use a free-standing `text` element anchored at the zone's top-left instead.
2. **Avoid cross-zone arrows** in dense diagrams; keep arrows within a tier, or route elbowed arrows along the perimeter.
3. **Arrow labels sparingly**, ≤ 12 characters, only when the relationship name is essential.

## Quality checklist (after every batch)

Screenshot, then check: text truncation (widen the shape), overlap, arrows crossing unrelated shapes (add waypoints: `"points": [[0,0],[50,-40],[200,0]], "roundness": {"type": 2}` for curves, `"elbowed": true` for right angles), arrow-label overlap, ≥ 40px gaps, font ≥ 16 (titles ≥ 20), zone labels free-standing. Fix, re-screenshot, then continue. Say what you saw and fixed.

## Workflow: refine an existing diagram

`describe_scene` for ids and positions (tags and element notes show there too) → `update_element` / `delete_element` / `apply` → `get_canvas_screenshot`. Bound arrows re-route when their endpoints move. Locked elements need `unlock_elements` first.

## Workflow: versions

- `list_versions` to see history and which versions a human confirmed.
- `save_version` before risky restructuring, and after reaching a state worth returning to. Label like a commit subject; put the why in `note`.
- `restore_version` with `saveCurrentAs: "before restoring vN"` when the current state is worth keeping. The browser updates live.
- `delete_version` only when asked.

## Workflow: conversation

Humans leave notes in the browser, anchored to shapes. `list_notes` (default: unresolved only) shows them; `elementIds` tells you which shapes. Reply with `add_note` on the same shapes, `author` set to your model name. Use `tags` like `question`, `decision`, `todo`. Project-level notes (`projectLevel: true`) are for goals and constraints.

## Workflow: Mermaid

`create_from_mermaid` (or `mermaid` on the CLI) converts in the browser tab, so the canvas must be open there (exit code 4 otherwise). Afterwards `describe_scene` + `get_canvas_screenshot` and fix crowded nodes with `update_element`.

## Workflow: file I/O

- `export_scene` → `.excalidraw` (or `.excalidraw.md` for Obsidian vaults: use it whenever an ancestor directory contains `.obsidian/`).
- `import_scene` with `mode: "replace"` or `"merge"`; `render` (CLI) renders a file to PNG/SVG without the server.
- `export_to_image` for PNG/SVG; `export_to_excalidraw_url` uploads an encrypted scene to excalidraw.com (ask before sharing).

## Error recovery

- **Canvas unreachable (exit 3)**: auto-start is disabled or the URL is not loopback; run `start` or fix `EXPRESS_SERVER_URL`.
- **Browser tab required (exit 4)**: only Mermaid, `set_viewport` and `renderer: browser` need a tab; open the canvas URL.
- **"No diagram is active"**: `list_projects` → `open_diagram`.
- **Elements not visible**: `describe_scene` for positions; `set_viewport` with `scrollToContent: true`.
- **Stale sync (HTTP 409)**: the canvas switched diagrams; reload with `describe_scene`.
- **Bad state**: `snapshot_scene`, then `clear_canvas` and rebuild, or `restore_version`.

## References

- `references/cheatsheet.md`: CLI reference, every MCP tool with required params, REST endpoints, and the design guide (colours, sizing). MCP mode also has `read_diagram_guide`.
