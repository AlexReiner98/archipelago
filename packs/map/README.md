# map

Page side: the canvas of a query, the view "Map" in the shell. One flat
plane; the query (`find.query`) is the whole surface.

- An item is one line with the mark of its state; links are right-angled
  wires (layout.ts): an item stands right of what it depends_on or
  waits_on, of its parts, of what bears_on it. Items with no links among
  the drawn ones sit apart below.
- Wires never share a stretch of line or run through a card: a wire that
  spans columns takes a thin row of its own in each column it passes, each
  card side spreads its wire ends, and each wire turns on its own lane.
- Marks (marks.ts) come from the base and the status's side, never the
  type's name: shape by base, hollow for the first open status, half for a
  later open one, full for the first closed, struck for a later closed.
- A click sets `here.item`. Drag the plane to move it, wheel to zoom,
  double-click to fit.
- It only shows: nobody adds or links items by hand. Agents change the
  map through the items actions, and the canvas follows live.
- Declares `map.bar` (find fills it) and `map.side` (the item page).

SVG components: a query draws at most a few hundred items. The scene
surface (spec/scene.md) is for the graph at scale.
