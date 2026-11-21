# map

Page side: the canvas of a query, the view "Map" in the region `center`. One flat
plane; the query (`find.query`) is the whole surface.

- An item is one line with the mark of its state; links are right-angled
  wires (layout.ts): an item stands right of what it depends_on or
  waits_on, of its parts, of what bears_on it. Items with no links among
  the drawn ones sit apart below.
- Wires never share a stretch of line or run through a card: a wire that
  spans columns takes a thin row of its own in each column it passes, each
  card side spreads its wire ends, and each wire turns on its own lane.
- Marks (marks.ts) follow the spec's rule (spec/style.md): shape by base,
  side by where the status sits, never the type's name. The glyphs and
  their colours are the style's tokens: hollow for the first open status,
  half and blue for a later open one, full and green for the first closed,
  full and grey (its title struck) for a later closed. The legend ([packs/legend](../legend/README.md)) shows every mark:
  each base with each of its statuses, and each kind of link.
- Hovering or opening an item lights it: a blue outline, its links blue
  over the rest, the items linked to it yellow. The legend's "lit" line
  says so.
- A click sets `here.item`. Drag the plane to move it, wheel to zoom,
  double-click to fit.
- It only shows: nobody adds or links items by hand. Agents change the
  map through the items actions, and the canvas follows live.
- Declares no slots. Find fills the region `top`, the item page `right`,
  and the legend `over`, each while the map shows.

SVG components: a query draws at most a few hundred items. The scene
surface (spec/scene.md) is for the graph at scale.
