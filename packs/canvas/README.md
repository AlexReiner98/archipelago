# The canvas pack

The map drawn in space, and a template for any pack that changes how the map
looks. Its preset makes the canvas the view every lens is drawn in unless a
nearer style says otherwise. Take the pack out and views are drawn as before.

## What it ships

- **A drawing**, `canvas.space` (shape `space`). What holds others is land
  with what it holds on it, so the part_of closure is drawn as regions within
  regions. Inside a region, things that depend on each other are laid out in
  rows the way a flow reads, and the rest are packed to the region's shape.
  Every link is a wire pointing at the one that waits. A mention (an item
  naming another in its note) is a faint thread. Hovering shows the point of
  a thing in a tip and lights its wires; clicking opens its page.
- **Outlines** (`draw/outlines.js`): nineteen node shapes, each a few lines
  of path. They are box, round, pill, diamond, sheet, stack, note, folder,
  hexagon, octagon, slant, chevron, flag, tag, cylinder, person, circle,
  cloud and shield.
- **A field on the style type**, `outlines`, so a style can name an outline
  for a type, a root type or a kind. The nearest name wins, and an item with
  no name is drawn as a box.
- **A preset**, `canvas.house`: the shape, the outlines per kind and per
  common type, and every length the drawing uses (`space_*` sizes).

## Making a view evocative

Keep a style on the map with an `outlines` field, about a project or for the
whole workspace. For example, `{ "work.task": "chevron", "aim": "flag" }`.
To change the layout itself, keep a style with the preset `canvas.space` and
your own `layout.js` in `modules`. That change waits for the owner, as all
code does.

## Using it as a template

A drawing pack is these files and nothing else:

| File | What it is |
|---|---|
| `pack.json` | `requires`, the drawing (its shape and modules), its preset, any field it adds to `style` (`types`, an entry with `of`) |
| `draw/index.js` | `picture(input, tools)`: answers with a scene, `on(event)` and `restyle(style)` (docs/drawings.md) |
| `draw/layout.js` | Pure geometry: an answer in, places out. Test it without a page |
| `draw/look.js` | The stylesheet, every length a `--ln-*` the preset names and every colour a theme's |
| `draw/marks.js` | The mark helper, copied: a pack's modules are files of its own folder |
| `canvas.test.ts` | Input in, geometry and marks out, run by `npm test` with no database |

Rules a drawing keeps:

- No number or colour in the code that a person might want to change. It
  reads them from the style, and the preset names each one.
- No look in the kernel. A pack adds the shape it draws to what a style may
  name, because the registry takes the shapes from the drawings packs ship.
- Marks only from `ui/marks.js`'s list. A link goes to `#/e/<id>` and
  nowhere else.
- Run it in a real browser before you push. The browser pane will not load
  the sandbox, so use headless Chrome (`test/browser.ts`).
