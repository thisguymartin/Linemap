# Linemap product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary user: a solo developer (terminal-first, TypeScript/Go) who thinks through how systems work by drawing them, with an AI coding agent (Claude Code, Codex, Cursor) drawing on the same canvas through MCP or the CLI. Situation: a laptop or desk setup, browser tab beside a terminal, often in the evening while reasoning out loud about one domain ("how does a water heater work", "the order pipeline"). Job: build and keep a visual understanding of a domain over weeks, not a one-off sketch. *(inferred from the brief; not confirmed by interview)*

## Product Purpose

Linemap is a self-hosted Excalidraw workbench that an AI agent and a human share. It keeps every diagram in a project on disk, snapshots manual versions the human can confirm or delete, and stores a conversation (notes anchored to shapes, element tags, links between diagrams) that lets any agent pick the project up cold. Success: the user opens the browser and is immediately on the live canvas; an agent can read the project "brain" and continue the work; nothing is lost between sessions.

## Positioning

Unlike the official Excalidraw MCP (prompt in, picture out) or a bare canvas server (one scene in memory), this is a persistent, versioned, conversational workbench: projects group diagrams into a domain, versions are explicit and confirmable, and the conversation lives next to the shapes it is about. Runs locally on Bun or Node with SQLite on disk; no cloud, no account, no Cloudflare.

## Operating Context

- Local Node server (Express + WebSocket) on 127.0.0.1:3000 serving the browser UI and the REST API; MCP stdio server and CLI drive the same server.
- Data lives in `<repo>/.local/linemap.db` (projects/diagrams/versions/notes/links/chats), ignored by git.
- The agent draws programmatically (batch create, update, align, screenshot) while the human watches the tab and annotates; the human saves/confirms versions and leaves notes; the agent reads notes and the project context.
- Excalidraw itself (0.18) is the editor; its own toolbar, library, theme, and shortcuts stay as they are.

## Capabilities and Constraints

- Entities: Project (domain), Diagram (live working copy, autosaved), Version (immutable, numbered, confirmable, deletable), Note (human or agent, markdown, anchored to element ids, resolvable), Link (diagram→diagram or shape→diagram drill-down), element tags/notes in Excalidraw `customData`.
- One diagram is "active" on the canvas at a time; switching diagrams switches it for every tab.
- Real-time: WebSocket pushes element changes and workspace events; tabs auto-sync edits back after 1.2 s.
- Terminology: project, diagram, version, confirm, note, tag, link, context ("the brain").
- Constraint: React 19 + Vite 8, no UI framework, no external font CDN requirement for the chrome (Excalidraw loads its own fonts).
- Undecided: multi-user access control (none; single local user assumed).

## Brand Commitments

Name: Linemap (chosen by the owner, 2026-10-29; package `linemap`, CLI `linemap`). The name comes from the transit-map world: a project is a line, its diagrams are stations. Excalidraw's hand-drawn canvas is the product's heart and must stay full-bleed and untouched. No other brand assets exist. *(inferred)*

## Evidence on Hand

- Working server, MCP tools, CLI and tests in this repo (`scripts/check-*.mjs`).
- No logo, screenshots, testimonials, or customer data; do not fabricate any.

## Product Principles

1. The canvas is the product; chrome recedes and never covers the drawing.
2. Everything an agent needs to continue is written down next to the shapes (notes, tags, links, versions).
3. Manual versions are deliberate acts; autosave is invisible.
4. Switching context (project → diagram → shape) should take one click and one glance.
5. Local, inspectable, cheap: JSON files, no services.

## Accessibility & Inclusion

Keyboard-reachable panels and controls; visible focus; respects prefers-reduced-motion and the Excalidraw light/dark theme. No product-specific standard established.
