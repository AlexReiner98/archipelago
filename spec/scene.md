# scene

How large graphs are drawn. Panels are Preact components ([slot](slot.md));
the graph is not. It is one surface: a WebGL2 canvas owned by the scene
pack, which other packs fill with layers. Types: [scene.ts](scene.ts).

## Capabilities

| Key | Gives |
|---|---|
| `layout.region` | Items, links and groups placed in a rectangle |
| `scene.layer` | Add a layer to the surface |
| `scene.view` | The camera |

## Why one surface

DOM, and so any component renderer, stalls at a few thousand nodes. A
surface draws each kind of mark as one instanced draw call, so a hundred
thousand nodes cost a few calls, not a hundred thousand elements. Every
pack draws the graph the same way, through layers, so there's one way to
do it and it's fast for all of them.

## What the scene does

```
camera moves ─▶ layout.region (what's in view, bounded)
graph.watch  ─▶ what changed in view
                    │
                    ▼
              SceneDelta ─▶ each layer patches its buffers ─▶ draw
pointer ─▶ pick pass ─▶ id ─▶ here.item
```

- **Reads follow the view.** The scene asks `layout.region` for what is in
  the view, so a graph of any size loads no more than a screenful. Where
  things are is the layout pack's: it may compute positions or keep them
  on items, and the scene doesn't care which.
- **Deltas, not redraws.** Moving the camera or a change in the graph
  becomes a `SceneDelta`: what entered, changed and left. Layers patch
  their buffers from it.
- **Detail by scale.** Zoomed out past where items can be seen,
  `layout.region.groups` gives clusters to draw in their place. Layers read
  `view.scale` to drop labels and fine marks.
- **Picking.** Each pickable layer draws its marks in id colours in an
  offscreen pass. The scene reads the pixel under the pointer and sets
  `here.item`, and the panels follow.

## Layers

A layer is one kind of mark: edges, node glyphs, labels, the live run's
highlights, a verdict tint. It gets the scene's WebGL2 context, owns the
resources it creates (its `init` returns their disposer), patches on
`update`, and draws on `draw`. Layers draw in the config-tree order of
their packs, the first at the bottom. When a pack unloads, its layers and
their GPU resources go.

Raw WebGL2, not a library: the layer contract is ours either way, and the
scene pack can be replaced later without touching a layer that only uses
the context it is given.

## The scene on the page

The scene pack fills an ordinary slot with a Preact component that hosts
the canvas, so the surface sits among the panels like any other panel.
The camera (`scene.view`) is ephemeral state, like `here`: an agent can
move it to show the person something.
