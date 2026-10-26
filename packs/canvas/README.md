# The canvas pack

How the canvas the app opens on is drawn, as a pack of its own. Its one
preset, `canvas.house`, draws every view as a flow (core's drawing, kept as it
is on the owner's word, 25 Oct 2026) unless a nearer style says otherwise.
It lies over the workspace's own style (`over: "workspace"`), so a
workspace style kept from before the canvas that says `shape: list` does not
turn the canvas back into lists (the owner, 26 Oct 2026: the flow is the
default for now). A style on a kind, a type, an item or a view still wins.
Its part_of wires show only while one of their ends is hovered
(`hover_only`, the owner, 26 Oct 2026), to keep a large map clean.
Take the pack out and views are drawn as before.

## Why a pack

Packs are layered. Presets with no `on` are combined in the order the packs
load, a named set merged name by name, so this pack's preset lies over
core's house style, over the workspace's own style (its `over`), and under
anything kept on a kind, a type, an item or a view. To change how the
canvas looks, change or add a preset here, or keep a style on the map. The
kernel's page (`ui/canvas.js`, `ui/app.js`) holds no look of its own.

## Using it as a template

A pack that changes how the map looks has a `pack.json` that `requires`
core, and its `styles`. One that draws a new form adds `drawings` (its
modules, entered at `index.js`, with tests run with no page), as
`packs/core/draw/flow/` is: see `docs/drawings.md`. Check a drawing in a real
browser before you push. The browser pane will not load the sandbox, so use
headless Chrome (`test/browser.ts`).
