# How it works

![One canvas server, three ways in](images/architecture.png)

This diagram was drawn through the tool's own REST API and exported by its headless renderer (see `scripts/capture-docs.mjs`).

## The processes

The canvas server (`dist/server.js`) is the only process that holds state. It serves the browser app, a REST API and a WebSocket, keeps the diagram that is currently on the canvas in memory, and writes everything else to `data/`.

Three kinds of client talk to it:

- The browser tab loads the Excalidraw editor and a side panel. It receives every change over the WebSocket and sends your edits back over REST, about 1.2 seconds after you stop drawing.
- The MCP server (`bun dist/bin.js` with no arguments) speaks MCP over stdio to Claude Code, Codex, Cursor or Claude Desktop, and turns each tool call into HTTP requests to the canvas server.
- The CLI (`bun dist/bin.js <command>`) does the same for your shell. Its results are JSON on stdout.

If the MCP server or the CLI finds nothing listening on the canvas port, it starts the canvas server in the background. Set `EXCALIDRAW_NO_AUTOSTART=1` to turn that off.

When you send a message in the Chat tab, the canvas server starts the `claude` or `codex` CLI as a child process. That CLI gets its own copy of the MCP server, pointed back at this canvas, so whatever it draws shows up in your tab. [chat.md](chat.md) has the details.

## One live diagram

A project holds diagrams, but only one diagram is on the canvas at any moment. Every open tab shows it, and every drawing tool acts on it. When an agent calls `open_diagram`, every tab moves to that diagram. If you open another one in the browser, agents see that one.

Before switching, the server saves the outgoing diagram. A tab still holding the old diagram cannot overwrite the new one: its sync is refused with HTTP 409 and the tab reloads.

## Autosave and versions

Every change to the live diagram is written to `diagram.json` shortly after it happens. You never press save to keep your work.

A version is a separate, deliberate copy: numbered, labelled, and immutable until you delete it. Agents save versions after meaningful progress and never confirm them. You confirm a version in the Versions tab once you have looked at it. Restoring a version replaces the live diagram, and the Chat and MCP paths can save the current state as a version first.

Snapshots (`snapshot_scene`, `snapshot save`) are different again. They are scratch undo points kept in memory and lost when the server stops.

## Data on disk

```
data/
  workspace.json                       which diagram is on the canvas
  projects/<project>/
    project.json                       name, description, tags, colour, linked folder
    notes.json                         the conversation
    links.json                         links between diagrams and shapes
    chat.json                          chats with Claude Code and Codex
    runs/<message>.log                 raw output of each chat run
    diagrams/<diagram>/
      diagram.json                     the working copy
      versions/0003-<version>.json     saved versions
```

Each write goes to a temporary file that is then renamed over the old one, so a crash cannot leave a half-written file. `data/` is committed by default so diagrams travel with the repo; uncomment the line in `.gitignore` to keep it local, or point `EXCALIDRAW_DATA_DIR` somewhere else.

Tags and the note on a shape are stored in that Excalidraw element's `customData`. They survive export to `.excalidraw`, `.excalidraw.md` (Obsidian) and excalidraw.com.

## The project context

`get_project_context` (or `bun dist/bin.js context`, or Copy context in the browser) builds one markdown document from what is on disk:

- the project's description and tags, and its linked folder with git branch, remote and top-level files
- every diagram with its element count, latest version and whether that version is confirmed
- links between diagrams, including which shape each link starts from
- every element tag and shape note across the project
- the conversation, with the newest notes last

An agent reads it once at the start of a session instead of opening every diagram.

## Screenshots without a browser

`get_canvas_screenshot`, `export_to_image` and the CLI's `screenshot` render inside the canvas server. Excalidraw's own exporter runs under jsdom to produce SVG, and resvg rasterizes it to PNG in a separate worker process. Agents can check their work with no browser open. Only Mermaid conversion and viewport control need a tab, because they run in Excalidraw's browser code.

## Security

The server listens on 127.0.0.1 by default. Because it can start coding agents with read access to your folders, it also rejects:

- requests whose `Origin` header names another website, so a page you visit cannot call it;
- requests whose `Host` header is not localhost, which blocks DNS-rebinding tricks.

The CLI, the MCP server and curl send no `Origin` header and are not affected. If you bind the server to another address (`HOST=0.0.0.0`, as the Docker image does), the Chat tab and the folder browser switch off entirely.

Agents never get write access to your code. Claude Code runs with only the drawing tools and `Read`, `Grep` and `Glob` allowed, and anything else is refused without a prompt. Codex runs in its read-only sandbox. Files an agent exports land in the project's data folder, not in your repo.
