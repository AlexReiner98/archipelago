# map

Page side: the canvas of a query, the view "Map" in the shell. One flat
plane; the query (`find.query`) is the whole surface.

- An item is one line with the mark of its state; links are right-angled
  wires (layout.ts): an item stands right of what it depends_on or
  waits_on, of its parts, of what bears_on it. Items with no links among
  the drawn ones sit apart below.
- Marks (marks.ts) come from the base and the status's side, never the
  type's name: shape by base, hollow for the first open status, half for a
  later open one, full for the first closed, struck for a later closed.
- A click sets `here.item`. A drag from one item onto another links them
  (`items.link`, the kind picked in the bar); `+` makes an item
  (`items.create`), part of the one the query is `in:`. Drag the plane to
  move it, wheel to zoom, double-click to fit.
- Declares `map.bar` (find fills it) and `map.side` (the item page).

SVG components: a query draws at most a few hundred items. The scene
surface (spec/scene.md) is for the graph at scale.
