---
name: Linemap
description: A transit-map legend around a full-bleed Excalidraw canvas; one route colour per project is the only accent.
colors:
  bg: "#ffffff"
  bg-rail: "#f3f4f6"
  bg-sunk: "#e9ebee"
  bg-float: "#ffffff"
  ink: "#15181c"
  ink-2: "#4a5059"
  ink-3: "#686e77"
  rule: "#dcdfe4"
  rule-strong: "#b9bfc8"
  station-fill: "#ffffff"
  station-ring: "#15181c"
  route: "#2457d6"
  route-ink: "#ffffff"
  ok: "#1b7f3b"
  ok-text: "#187035"
  warn: "#b15c00"
  warn-text: "#964e00"
  err: "#b42318"
  new: "#c98a00"
  new-text: "#855c00"
  bg-night: "#111316"
  bg-rail-night: "#181b1f"
  bg-sunk-night: "#0c0e10"
  bg-float-night: "#1d2126"
  ink-night: "#e8eaed"
  ink-2-night: "#b0b6bd"
  ink-3-night: "#848b93"
  rule-night: "#2a2f36"
  rule-strong-night: "#3d444d"
  ok-night: "#4ade80"
  warn-night: "#f0a24a"
  err-night: "#f87171"
  new-night: "#f0b429"
  line-amber: "#f59e0b"
  line-emerald: "#10b981"
  line-blue: "#3b82f6"
  line-violet: "#8b5cf6"
  line-pink: "#ec4899"
  line-red: "#ef4444"
  line-teal: "#14b8a6"
  line-orange: "#f97316"
typography:
  headline:
    fontFamily: '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif'
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif'
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "tabular-nums"
  meta:
    fontFamily: '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif'
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif'
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.04em"
  micro:
    fontFamily: '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif'
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.01em"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "3px"
  chip: "4px"
  md: "6px"
  pill: "9px"
  lg: "10px"
  full: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  gutter: "16px"
  lg: "24px"
  xl: "32px"
components:
  button:
    backgroundColor: "{colors.bg-float}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "30px"
  button-hover:
    backgroundColor: "{colors.bg-rail}"
    textColor: "{colors.ink}"
  button-primary:
    backgroundColor: "{colors.route}"
    textColor: "{colors.route-ink}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "30px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "30px"
  button-danger:
    textColor: "{colors.err}"
  button-sm:
    typography: "{typography.meta}"
    padding: "0 8px"
    height: "26px"
  input:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
    height: "32px"
  tab:
    textColor: "{colors.ink-2}"
    padding: "0 10px"
    height: "40px"
  tab-selected:
    textColor: "{colors.ink}"
  chip:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.chip}"
    padding: "0 7px"
    height: "20px"
  pill-ok:
    textColor: "{colors.ok-text}"
    typography: "{typography.micro}"
    rounded: "{rounded.pill}"
    padding: "0 7px"
    height: "18px"
  pill-warn:
    textColor: "{colors.warn-text}"
    typography: "{typography.micro}"
    rounded: "{rounded.pill}"
    padding: "0 7px"
    height: "18px"
  tag:
    backgroundColor: "{colors.bg-sunk}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.sm}"
    padding: "1px 6px"
  route-chip:
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    padding: "0 10px 0 6px"
    height: "30px"
  station:
    backgroundColor: "{colors.station-fill}"
    size: "10px"
  stop:
    padding: "10px 16px"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.bg}"
    rounded: "{rounded.lg}"
    padding: "8px 14px"
---

# Design System: Linemap

## Overview

**Creative North Star: "The Transit Map Legend"**

The workbench is a transit system drawn with the fewest marks a map legend needs: a line, a dot, a ring, a dash. A project is a route in one saturated colour; each diagram is a station on it; a link is an interchange (a double ring on the line, a dashed arc on the map); a saved version is a stop behind you on the rail. The shell around the Excalidraw canvas is an ordinary editor shell (a 48px top bar, a docked 360px panel) and the world shows only through type, route colour, legend density and the station-line move. The hand-drawn canvas carries the personality; the chrome carries the wayfinding.

Density is timetable density: 13px UI type, 12px legend and meta, 11px pills, all in the Helvetica Neue / Helvetica / Arial system stack with tabular figures wherever a number appears. Surfaces are flat. Hairline (1px) rules divide the panel into sections; nothing is boxed; the one soft offset shadow belongs to things that float (the scene banner, the toast, the small-screen panel overlay). Day service is white; night service is near-black (#111316); both are tinted cool-neutral and the Excalidraw theme toggle drives them.

Rejections confirmed by the build: no cards on the panel, no second accent, no icon font or web font, no emoji glyphs, no modal for routine actions (confirm, restore and delete happen inline in the row), and no fades for content motion (motion travels along the line or reranks in place).

**Key Characteristics:**
- One route colour per project is the only accent; state hues (green confirmed, amber unconfirmed, red error, gold newly arrived) mark state and nothing else.
- Transit grotesk system stack on a 13 / 12 / 11px UI ramp, `font-variant-numeric: tabular-nums` set on `body`.
- Hairline-ruled sections, flat resting surfaces, one float shadow.
- A diagram is always a station: white dot, 2px Signal Black ring; 3px route ring when on canvas; double ring when linked; dot size on a fixed ramp by element count.
- Motion travels along lines: the train rides the track on autosave, the active station arrives once, rows rerank in place through view transitions.
- An authored 16px / 1.5px-stroke inline SVG icon set, one weight, no icon font.

## Colors

Cool-neutral greys for ground and ink, one saturated route colour per project, four state hues, and nothing else.

### Primary
- **Route (per project)**: every project owns one hex from the eight-line palette `DEFAULT_PROJECT_COLORS` in `src/domain/model.ts`: Amber Line (`line-amber`), Emerald Line (`line-emerald`), Blue Line (`line-blue`), Violet Line (`line-violet`), Pink Line (`line-pink`), Red Line (`line-red`), Teal Line (`line-teal`), Orange Line (`line-orange`). `applyRoute(project.color, theme)` writes it to `--route` on `<html>` when a canvas or project page mounts and clears it on the projects list. **Default Route Blue** (`route`, #2457d6) is the fallback when no project is on screen (the projects list, or a colour `routeTokens` cannot parse).
- Derived per route and theme by `frontend/src/color.ts`, never used raw: `--route-btn` (the button face, shifted toward black until white text clears 4.5:1), `--route-ink` (white, or Signal Black when the route is light enough to carry it), `--route-text` (the route shifted toward black by day or toward white at night until it clears 4.5:1 on the ground). Two tints are mixed in CSS: `--route-soft` (12% route over the ground: hover wash, pressed state, agent avatar, route pill) and `--route-line` (85% route into ink by day, 80% route into white at night: the rail, the track, the map route).
- Where the route goes: the primary button, the active station ring, the tab underline, the focus outline, text selection, the input focus border and ring, the diagram-title rename underline, link hover, the route swatch and the legend bar.

### Neutral
Day service (`bg` through `station-ring`), night service as the `-night` keys with the same roles.
- **Day White** (`bg`, #ffffff): the ground, inputs, chip fill, station fill (`station-fill`), tooltip and toast text.
- **Rail Grey** (`bg-rail`, #f3f4f6): the top bar, the side panel, the composer, the map footer, button and row hover.
- **Sunk Grey** (`bg-sunk`, #e9ebee): count badges, tags, the human avatar.
- **Float White** (`bg-float`, #ffffff): the default button face and the scene banner; at night it lifts to #1d2126 so floating surfaces read lighter than the ground.
- **Signal Black** (`ink`, #15181c): body text, headlines, the station ring (`station-ring`), the tooltip and toast ground.
- **Platform Grey** (`ink-2`, #4a5059): secondary text, section headers, tab labels, chip text, the version label.
- **Timetable Grey** (`ink-3`, #686e77): meta, the readout, placeholders, the crumb separator, dashed link arcs on the map.
- **Hairline** (`rule`, #dcdfe4): every 1px divider (top bar bottom edge, panel left edge, sections, rows, table cells).
- **Hairline Strong** (`rule-strong`, #b9bfc8): button and input borders, chip borders, the table header rule, the legend top rule, the scrollbar thumb.
- **Night Ground** (`bg-night`, #111316): the night-service ground; the night station ring is Night Ink (`ink-night`, #e8eaed) and night state hues are lifted (`ok-night`, `warn-night`, `err-night`, `new-night`) so they clear the dark ground.

### State
- **Confirmed Green** (`ok`, #1b7f3b; text `ok-text`, #187035): the confirmed station ring, the confirmed and resolved pills, the saved readout dot.
- **Unconfirmed Amber** (`warn`, #b15c00; text `warn-text`, #964e00): the unconfirmed pill only.
- **Signal Red** (`err`, #b42318): danger buttons, the offline and error readout dot, the failed scene banner, the error toast.
- **Arrival Gold** (`new`, #c98a00; text `new-text`, #855c00): the editing readout dot, the "new" count badge, and the row tint a newly arrived note or version holds until it is hovered or focused.
- Soft washes are mixed in CSS over the ground: `--ok-soft` 14%, `--warn-soft` 14%, `--err-soft` 12%, `--new-soft` 16%.

### Named Rules
**The One Route Rule.** Every accent on a screen reads from `--route` or one of its derivations; there is no second accent, and the route changes only when the project does.

**The Fit-to-4.5 Rule.** A route colour never touches text or a button face raw: `routeTokens()` derives `--route-btn`, `--route-ink` and `--route-text` per theme until each pair clears 4.5:1.

**The State-Is-Not-Decoration Rule.** Green, amber, red and gold appear only on the thing whose state they report (a pill, a dot, a ring, a row tint); they never colour headings, layout or ordinary buttons.

## Typography

**Display Font:** none; the hand-drawn Excalidraw canvas is the display voice.
**Body Font:** Helvetica Neue (with Helvetica, Arial, Liberation Sans, sans-serif)
**Label/Mono Font:** ui-monospace (with SFMono-Regular, Menlo, monospace), only inside the context-digest `<pre>`

**Character:** The transit grotesk: neutral, tight, set like a timetable. No web font is loaded for the chrome and no display face exists; hierarchy comes from weight and from one step up in size.

### Hierarchy
- **Headline** (700, 24px, 1.2, -0.01em): the page `h1` on Projects and on the project map. The only size above 15px in use.
- **Title** (600, 15px, 1.2): the diagram title in the top bar and the project row title. The version number uses the same size at 700.
- **Body** (400, 13px, 1.45): the base UI size; note bodies at 1.5; buttons and tab labels at 500.
- **Meta** (400, 12px, 1.45): the readout, timestamps, descriptions, table cells, field labels (500), empty states. Descriptions are capped at 70ch.
- **Label** (600, 12px, uppercase, 0.04em): section headers inside the panel and on pages; table headers take the same treatment at 11px.
- **Micro** (600, 11px, 0.01em): pills and count badges; chips at 400, tags at 500, tooltips at 400.
- `--fs-18` and `--fs-32` are declared on `:root` but no surface uses them.

### Named Rules
**The Tabular Figures Rule.** `body` sets `font-variant-numeric: tabular-nums`; every number (readout time, element counts, version numbers, stats) sits on tabular figures so rows rerank without jitter.

**The Headline Number Rule.** In a version row the number ("v7") is the headline at 15px / 700; its label sits beside it at 13px / 500 in Platform Grey, and nothing is labelled twice.

## Layout

The app is a column: a 48px top bar (`--topbar-h`) over a workbench that fills the rest, with `overflow: hidden` on `body` so the canvas owns the viewport and only the panel and pages scroll.

- **Top bar**: a three-column grid `minmax(220px, 1fr) minmax(0, 2fr) minmax(220px, 1fr)` with 12px gap and 12px side padding, Rail Grey, 1px Hairline bottom edge. Left: route chip, chevron, diagram title. Centre: the station line. Right: the autosave readout, the one primary button, the panel toggle, the theme toggle. Every control is 30px tall.
- **Workbench**: the canvas host takes the remaining width; the panel is 360px (`--panel-w`), docked right, Rail Grey with a 1px Hairline left edge; it collapses to 0 over 220ms and its open state is remembered.
- **Panel internals**: a 40px tab strip on a 1px rule; `.panel-section` blocks at 12px 16px with a 1px bottom rule; rows (stops, notes) at 10px 16px with a 1px bottom rule; the composer pinned to the bottom behind a 1px top rule.
- **Pages** (Projects, project map): `.page-inner` max-width 1100px, centred, padding 32px 16px 64px; page head margin-bottom 24px; map block margin-bottom 28px; `.two-col` at 1.4fr / 1fr with a 32px gap.
- **Rhythm**: the 16px gutter (`--gutter`) is the horizontal rhythm inside the panel and pages; internal gaps step 4 / 6 / 8 / 10 / 12 / 16 / 24 / 32.
- **Breakpoints**: at ≤900px the top bar becomes `1fr auto`, the station line and readout text hide, "Save version" shortens to "Save", the route chip caps at 42% width, `.two-col` stacks, legend rows go 40px / 1fr, and the panel becomes an absolute right-edge overlay at `min(360px, 92vw)` carrying `--shadow-float`. At ≤600px the map footer stacks and the key becomes a two-column grid. The map SVG keeps a 640px minimum width and scrolls horizontally. The small-screen panel treatment is unresolved (the contract listed a bottom sheet); the right overlay is what ships, not a settled rule.

### Named Rules
**The Hairline Section Rule.** Panel and page content is divided, not boxed: sections and rows end in a 1px `--rule` border and share the 16px gutter.

## Elevation & Depth

Flat by default with tonal layering: ground (Day White) under rail surfaces (Rail Grey) under sunk fills (Sunk Grey), separated by 1px hairlines. Depth at rest is a tone step and a rule, never a shadow. One shadow token exists and only floating surfaces use it.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 10px 28px -10px rgba(21, 24, 28, 0.28), 0 2px 6px -2px rgba(21, 24, 28, 0.14)`; night `0 12px 30px -10px rgba(0, 0, 0, 0.7), 0 2px 6px -2px rgba(0, 0, 0, 0.5)`): the scene banner over the canvas, the toast, and the ≤900px panel overlay. Nothing at rest.
- **Rings drawn with box-shadow (not depth)**: the input focus ring `0 0 0 3px` at 22% route; the interchange double ring `0 0 0 2px station-fill, 0 0 0 3.5px station-ring`.

### Named Rules
**The Float-Only Shadow Rule.** `--shadow-float` goes on things that float (scene banner, toast, the small-screen panel overlay) and on nothing that rests.

**The Ring-Not-Shadow Rule.** A `box-shadow` on a station or an input is a ring that reports state; it is never softened or offset into depth.

## Shapes

- **Controls**: gently rounded (6px, `--radius`) on buttons, inputs, the readout and the diagram title. Small corners (3px) on tags, the route swatch and the focus outline. Chips at 4px, with a dashed border for tag chips. Pills and count badges are round-ended (9px on 18px height); the route chip is a full pill (999px) at 30px.
- **Floating surfaces**: 10px (`--radius-lg`) on the scene banner and the toast.
- **Circles**: station dots, avatars (24px), the readout dot (6px), the train (8px), the map marker (r 5).
- **Lines**: the route is a 4px bar between stations in the station line (28 × 4 segments), a 6px round-capped stroke on the map, a 3px rail in the version list, and a 6px bar with 3px radius in the projects legend. Link arcs are dashed 4 / 5 at 2px. Icon strokes are 1.5px.
- **Borders**: 1px everywhere; 2px only for the diagram-title rename underline and the selected-tab underline. Station rings are 2 / 2.5 / 3 / 3.5px by role (line, list and map, active in the line, active on the map).
- **Known deviation, not canon**: on the project page the map frame (`.map-wrap`), the conversation thread (an inline style) and the context digest (`.brain`) sit in 1px Hairline boxes with the 10px floating radius. The contract and the panel use hairline sections; do not extend those boxes to new surfaces.

### Named Rules
**The Station Mark Rule.** A diagram is always a white dot (`station-fill`) with a 2px Signal Black ring, sized 8 / 10 / 12 / 14px for 0 / ≤5 / ≤30 / >30 elements (`stationSize`); confirmed is a green ring, on canvas is a 3px route ring 4px larger, linked is a double ring. The map key draws the same marks it explains.

## Components

Character: quiet, bordered, one height, one accent. Every control is a standard element styled by a class; no component library.

### Buttons
- **Shape:** gently rounded (6px), 30px tall, padding 0 12px, weight 500, 6px gap to a 16px icon.
- **Default:** Float White face, 1px Hairline Strong border, Signal Black text. Hover: Timetable Grey border on a Rail Grey face. Active: `translateY(1px)`. Disabled: 45% opacity.
- **Primary:** `--route-btn` face and border with `--route-ink` text; hover mixes 88% route-btn into ink. One per screen: "Save version" on the canvas, "Back to …" or "Open …" on the map, "New project" on the list.
- **Ghost:** no border, no face; hover is the Route Soft wash. Icon-only ghosts are 30 × 30 (26 × 26 small).
- **Danger:** Signal Red text; hover is the Err Soft wash with a Signal Red border. Ghost plus danger for inline delete.
- **Small:** 26px tall, padding 0 8px, 12px type.
- **Pressed** (`aria-pressed="true"`): Route Soft face with a 40% route border (the panel toggle, "New diagram").
- **Busy** (`.is-busy`): the label goes transparent and a 14px two-tone spinner turns at 0.8s linear.
- **Focus:** 2px route outline, 2px offset (global `:focus-visible`).

### Chips / Pills / Tags
- **Chip** (`.chip`): 20px tall, padding 0 7px, 4px radius, 1px Hairline Strong border on Day White, 11px Platform Grey, max 180px with ellipsis; anchored-element chips lead with the 11px `locate` icon; as a button, hover turns border and text to the route. Tag chips (`.chip-tag`) use a dashed border and a leading `#`.
- **Pill** (`.pill`): 18px tall, padding 0 7px, 9px radius, 11px / 600; `pill-ok` is Ok Soft on `ok-text` ("confirmed", "resolved", "v3" with a check), `pill-warn` is Warn Soft on `warn-text` ("unconfirmed"), `pill-route` is Route Soft on `--route-text` ("on canvas").
- **Tag** (`.tag`): 11px / 500 Platform Grey on Sunk Grey, padding 1px 6px, 3px radius, leading `#`; project and diagram tags.
- **Count badge** (`.tab .count`): 18px, 9px radius, Sunk Grey, 11px / 600; `data-new="true"` switches to New Soft on `new-text`.

### Inputs / Fields
- **Style:** 1px Hairline Strong on Day White, 6px radius, min-height 32px, padding 6px 10px, placeholder Timetable Grey. Textarea minimum 64px (56px in the composer), vertical resize, 1.5 line-height.
- **Focus:** border becomes the route plus a `0 0 0 3px` ring at 22% route; no outline.
- **Field label:** 12px / 500 Platform Grey above the control with a 4px gap.
- **Checkbox:** `accent-color: var(--route)`, 14px.
- **Inline rename** (diagram title): an unstyled input with a 2px route bottom border at 15px / 600.
- **Error / Disabled:** no field-level error style; failures surface as an error toast.

### Navigation
- **Route chip:** an 18 × 6 route bar (3px radius) beside the project name at 600, 30px pill with a transparent border; hover is the Route Soft wash with a 30% route border; click opens the project map.
- **Diagram title:** 15px / 600 at 30px; hover reveals a Hairline border; click to rename inline.
- **Readout:** 12px Timetable Grey at 30px with a 6px dot coloured by state (saved green, editing gold, syncing route with a 1s pulse, offline and error red); the text reads "saved 12:03:41 · 24 el"; hover is the Route Soft wash.
- **Panel tabs:** 40px tall, padding 0 10px, Platform Grey at 500; hover Signal Black; selected is Signal Black with a 2px route underline inset 8px from each side, sitting on the strip's 1px rule.
- **Projects legend** (`.legend-row`): grid 56px / 1fr / auto, padding 14px 4px, 1px Hairline rows under a Hairline Strong top rule; the 56px cell holds a 6px route bar with up to four 10px station dots in a 2px route ring; the title is 15px / 600; stats are 12px with 600 numbers; hover Rail Grey; each row carries its own `--route` through `routeStyle()`.
- **Small screens:** the top bar drops to two columns, the station line hides, and the panel overlays from the right (provisional, see Layout).

### Station Line (signature)
The project's diagrams as stations on its route, centred in the top bar. Each station is a 24px hit area holding a dot sized by `stationSize` (8 / 10 / 12 / 14px) in Day White with a 2px Signal Black ring; 28 × 4 route-line segments join them. Hover scales the dot 1.25 and turns the ring route; the on-canvas station wears a 3px route ring 4px larger and plays `arrive` (scale 0.6 to 1 over 420ms) once; a linked station wears the double ring. Hover or focus shows the tip below the dot: Signal Black on Day White text at 11px, "name · count". The train (an 8px route dot) rides the track over 900ms when the server autosaves. A `+` ghost button at the end opens an inline 180px input with a "Create" primary small button.

### Transit Map (signature)
The project as pure SVG at a 960 viewBox: a snaking route (6px `--route-line`, round caps, 28px turn radius) through up to five stations per row, 170px between rows; stations as dots (`stationSize` / 2 + 2 radius, 2.5px Signal Black ring; confirmed green; on canvas route at 3.5px; hover route; focus route at 4px) with the name at 12px / 600 rotated 45°, and "14 el · v3" at 11px Timetable Grey beneath; links as dashed arcs (4 / 5 at 2px, Timetable Grey, arrowhead) lifted above or below alternately, labelled at 11px with a 4px ground-coloured stroke behind the text; an expanding route ring (`ring`, 1.4s) on the active station on arrival; a 5px route marker that rides the whole route once (`animateMotion`) on arrival and on autosave. The map key beneath draws the same marks: diagram, linked, confirmed, on canvas, link.

### Stop (version row, signature)
A grid of 28px rail / content / actions at 10px 16px with a 1px Hairline bottom rule. The rail is a 3px `--route-line` running the full height (trimmed at the first and last stop) with a 13px station dot (2.5px Signal Black ring) at 8px / 8px; confirmed turns the ring green. The headline is the version number at 15px / 700 with the label beside it at 13px / 500 Platform Grey and a confirmed or unconfirmed pill; the meta line (author, relative time, element count) is 12px Timetable Grey; an optional note follows at 12px Platform Grey. Three icon ghost buttons (confirm, restore, delete) sit in the actions column at 0 opacity until hover or focus-within. A newly arrived version holds the New Soft tint until read. Restore and delete confirm inline in the row with a small primary or danger button and a ghost "Cancel". Rows rerank in place through a view transition named per version.

### Notes thread
Rows as a 24px avatar / content grid at 10px 16px with a 1px Hairline rule; the human avatar is Sunk Grey on Platform Grey, the agent avatar Route Soft on `--route-text`, each holding a 14px icon. The head line is 12px: author at 600, "project" in Timetable Grey for project-wide notes, a resolved pill, and the time right-aligned. Anchored-element chips and tag chips follow the body; Resolve and Delete ghost buttons appear on hover. Resolved notes sit at 60% opacity. The composer is pinned at the bottom on Rail Grey behind a 1px top rule, with an "About …" chip line, a 56px textarea, a "⌘↵ to send" hint and a small primary "Add note".

### Toast and Scene Banner (floating)
- **Toast:** fixed 16px from the bottom, centred; Signal Black ground with Day White text (inverted), padding 8px 14px, 10px radius, Float shadow, slides up 8px over 220ms; the error kind is Signal Red with white text.
- **Scene banner:** 12px from the top of the canvas, centred; Float White with a 1px Hairline border, 10px radius, Float shadow, 12px text; the failed kind takes a Signal Red border and text.

### Motion
Tokens: `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)`; `--t-fast` 140ms (hover, colour, transform), `--t-base` 220ms (panel collapse, row rerank, toast), `--t-slow` 420ms (station arrival). Keyframes: `ride` 900ms (the train along the track on autosave), `arrive` 420ms (active station scale 0.6 to 1), `ring` 1.4s (the map's active-station ring expanding from r 9 to 22 and fading), `pulse` 1s (the syncing readout dot), `spin` 0.8s (busy buttons), `toast-in` 220ms. Rows rerank in place through `document.startViewTransition` (`withViewTransition()` in `frontend/src/motion.ts`) at 220ms with `--ease-out`. Under `prefers-reduced-motion: reduce` every duration drops to 0.01ms, view transitions are off, and the train and the map marker are hidden.

**The Along-the-Line Rule.** Motion travels along a line or reranks in place: the train rides the track, the station arrives, the ring expands, rows move to their new rank. Nothing fades in from nowhere except the toast, and nothing bounces.

## Do's and Don'ts

### Do:
- **Do** read every accent from `--route` and its derivations (`--route-btn`, `--route-ink`, `--route-text`, `--route-soft`, `--route-line`), set through `applyRoute(project.color, theme)`; a per-row route comes from `routeStyle()`.
- **Do** divide panel and page content with 1px `--rule` hairlines (`.panel-section`, row borders) and keep resting surfaces flat on the ground / Rail Grey / Sunk Grey tone steps.
- **Do** keep one control height: 30px for buttons, the readout and the route chip; 26px for `.btn-sm`; 32px minimum for inputs; 40px for tabs.
- **Do** draw a diagram as a station: white dot, 2px Signal Black ring, sized 8 / 10 / 12 / 14px by element count, green when confirmed, 3px route ring when on canvas, double ring when linked.
- **Do** use the authored 16px / 1.5px-stroke `Icon` set and add new glyphs to `icons.tsx` on the same grid and weight.
- **Do** keep numbers in tabular figures and make the version number the row headline at 15px / 700.
- **Do** hold the `--new-soft` tint on a newly arrived note or version until it is hovered or focused.
- **Do** give focus a 2px route outline offset 2px, and inputs a route border with a 3px ring at 22% route.
- **Do** confirm destructive or replacing actions inline in the row (small danger or primary button plus a ghost "Cancel") and report results in the toast.
- **Do** move along the line: reuse `withViewTransition()` for reranking rows and the `--t-fast` / `--t-base` / `--t-slow` steps with `--ease-out`; honour `prefers-reduced-motion`.

### Don't:
- **Don't** add a second accent colour; green, amber, red and gold report state and appear only on the pill, dot, ring or row tint that carries it.
- **Don't** box panel or page content in bordered, rounded cards; the 10px radius belongs to floating surfaces (scene banner, toast).
- **Don't** put `--shadow-float` on anything at rest; it is for the scene banner, the toast and the small-screen panel overlay only.
- **Don't** load a web font or an icon font, and don't use emoji or glyph characters as icons; the chrome is the Helvetica Neue / Helvetica / Arial stack with inline SVG.
- **Don't** put a raw project colour on text or a button face; derive it through `routeTokens()` so every pair clears 4.5:1.
- **Don't** cover or restyle Excalidraw's own chrome (toolbar, menus, shortcuts, theme); the shell wraps the canvas and only the scene banner floats over it.
- **Don't** add a modal for routine actions (save, confirm, restore, delete, rename, link); they happen inline where the thing is.
- **Don't** label twice: no eyebrow or kicker above a headline, no "Version" word beside "v7", no repeated section title inside a row.
- **Don't** use `--fs-18` or `--fs-32` without a new reason; no shipped surface needs a size above 24px or between 15 and 24.
- **Don't** animate content with fades, bounces or slides that do not follow a line or a rerank; the toast is the one allowed slide-in.
