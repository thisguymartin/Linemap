# Surface: the workbench (canvas, project map, project list)

Scope: the whole browser UI at `/`, `/p/:projectId`, `/p/:projectId/d/:diagramId`. Visitor mode: Operate. Build path: code-led (operate surface).

Audience and job: a solo developer with an AI agent drawing on the shared canvas. Tasks: land on the live diagram; see where it sits in its project; save and confirm versions; leave and read notes anchored to shapes; tag shapes; link diagrams and transfer between them; see the whole project as one map.

Content: real workspace data from the REST API (projects, diagrams, versions, notes, links, element tags) plus the live Excalidraw scene over WebSocket. No fabricated content.

Constraints: Excalidraw stays full-bleed and untouched (its toolbar, menus, shortcuts, theme). Standard web controls only. No UI framework, no icon font, no external font CDN; icons are authored inline SVG at one stroke weight. Respect prefers-reduced-motion and the Excalidraw light/dark theme.

Decision round: unattended run; the decision page was not served because this harness cannot hold a blocking wait with nobody to answer. The assigned direction (candidate 4) was built as rolled. Challenger verdicts: variable-font specimen declined (kept: numeric readouts in tabular figures on a strict baseline); star atlas declined (kept: station dot diameter on a fixed ramp by element count, one reserved ring colour for the object under the eye); Japanese high-density web declined (kept: hairline-ruled sections with small header tabs instead of cards); boarding pass + gate board competitive on clarity (kept: rows rerank in place and a newly arrived agent note or version holds its alert tint until read); vertical feed declined (kept: the canvas owns the viewport, chrome is a thin rail, nothing in the centre); factory records sleeve declined (kept: the version number is the headline and nothing is labelled twice).

## Direction contract

THESIS: The workbench is a transit system. A project is a coloured route, each diagram a station on it, links are interchanges, saved versions are the stops behind you. It refuses the category default (grey doc-tree sidebar, cards, a modal for every action): the shell is a standard editor shell and the world shows only as type, route colour, legend density, and the station-line move.

OWN-WORLD: Ground is white in the day theme and near-black (#111) in the night-service theme, both tinted cool-neutral; every project owns one saturated route colour from an eight-line palette and that colour is the only accent on its screens. Stations are white dots with a 2px dark ring; the active station a 3px ring in the route colour; an interchange a double ring. Type is the transit grotesk: Helvetica Neue / Helvetica / Arial system stack, 13px UI, 12px legend, tabular figures for every number. Hairline (1px) rules divide panels; no cards, no drop shadows on resting surfaces; one soft offset shadow only on things that float (menus, the draggable panel edge). State colours: amber = unconfirmed, green = confirmed, red = error. Motion moves along lines: a dot travelling the station line marks autosave; rows rerank in place; the active station pulses once on arrival.

STORY: The visitor lands on the live canvas and reads the top bar: "Water Heater" route chip, then "Overview" with its sibling stations as dots on a coloured line. They understand that saved versions are stops, that a note sticks to a shape, and that the map shows the whole domain. They act: draw, save a version, confirm it, leave a note on a selected shape, transfer to the linked diagram by clicking a station or a shape's link.

FIRST VIEWPORT: 1440×900. Top bar 48px: left, a route chip (colour swatch + project name, click → project map) and the diagram name (inline-editable); centre, the station line: sibling diagrams as dots on the route-coloured line, active dot ringed, hover names a station, click transfers; right, the autosave readout in tabular figures ("saved 12:03:41 · 24 elements"), the primary button "Save version" in route colour, panel toggle, theme toggle. Below it Excalidraw fills the rest. The right panel (360px, docked, collapsible, remembered) has three tabs: Versions (stops list, the number as headline "v7", label, author, time, confirm/restore/delete inline), Notes (thread of human and agent notes with anchored-element chips, composer pinned at the bottom, "about selection" when shapes are selected), Context (selected shape's tags editor and note, links from this diagram, project description, open agent questions). Primary action: "Save version" top-right.

FORM: Transit system map legend, candidate 4 of 7 on the ordered list (after drawing-set title block, service-manual parts catalog, engineer's lab notebook; before patent plates, whiteboard stickies, museum placards). seed: none (unavailable)

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- Whether multiple tabs may show different diagrams (today: one active diagram per server).
- Mobile: the canvas works on phones through Excalidraw; the panel becomes a bottom sheet. Not a primary scene.
