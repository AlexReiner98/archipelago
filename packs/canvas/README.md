# The canvas pack

How the map looks and is drawn, as a practice pack of its own (decision
e_fgsgw8ja, 11 Nov 2026): the house style (`core.house`), the two drawings
(`core.map` and `core.rails`, their code under `layouts/`), the graph view
(`core.graph`) and a style's Use here (`core.style_apply`). They moved out of
core keeping their ids, so what names them (a saved view's style, a layout
kept on the map as a version of `core.map`, an island pin) reads as before.

## Every map starts with it

A map that had core before the move is given canvas once, as any pack that
holds what another declared is (`movedPacks`, `src/pack-moved.ts`). A new map
starts with it as it starts with core, since it keeps core's ids
(`keepsKernel`). The page reads its own numbers off the house style, so take
canvas out and the page cannot draw: it says which number it lacks until the
pack is added again.

## Its presets

`core.house` is the base every style lies over. `canvas.house` draws every
view as the map unless a nearer style says otherwise; it lies over the
workspace's own style (`over: "workspace"`), so a workspace style kept from
before the canvas that says `shape: list` does not turn the canvas back into
lists (the owner, 26 Oct 2026). A style on a kind, a type, an item or a view
still wins.

## Changing how it looks

Change a preset here, or keep a style on the map. A drawing's code is in
`layouts/` (`docs/layouts.md`), with its tests beside this file, run with no
page. Check a drawing in a real browser before you push: the browser pane
will not load the sandbox, so use headless Chrome (`test/browser.ts`,
`test/layouts.test.ts`).
