# field

Page side: the map as particles, the view "Field" in the shell, beside
"Map". Each item is a particle in its type's colour, and links are faint
lines. It always lays out the whole map,
open and closed, up to `field_limit` items: the find line never moves a
particle, it only lights what it finds and fades the rest (`query_fade`).

- **No groups.** The map has no islands, and Field knows none: clusters
  form from the links alone (part_of springs are the shortest and
  stiffest). Particles start on one spiral, in an order that walks the
  links, so linked ones start near each other ([graph.ts](graph.ts)).
- **Behaviours compose.** [step.ts](step.ts) sums the pushes of the
  behaviours that are on, each times its weight and the run's warmth, then
  moves the particles. Each is a module in [behaviours/](behaviours):
  `gather`, `repel` (Barnes-Hut on an [octree](octree.ts), with a reach
  past which particles don't push, so gather keeps clusters together),
  `springs` (length and stiffness per link type) and `collide`. A
  behaviour is
  `{ name, doc, on, dials, apply, move?, busy?, firm? }`
  ([behaviour.ts](behaviour.ts)).
- **Every number is a dial.** Each behaviour's dials, then the start, the
  run, are in the panel on the left, in sections that
  start closed and say how many of their dials are changed; springs are
  grouped by link type. Each dial says what it does on hover, and ↺ puts
  it back. Their values are `field.dials`
  (page scope), so an agent can set them; the browser remembers them.
- **It settles to the end.** The physics runs on its own loop (a message
  channel), in slices of `frame_ms`, until no behaviour has work left;
  animation frames only paint. A tab in the background settles as fast.
- **The legend is the filter** ([legend.ts](legend.ts), [filter.ts](filter.ts)).
  Each type (with its colour), each of a type's statuses and kinds, open
  and closed, items with no links, and each link type is a switch, with how
  many the map has and how many show. What is hidden is left out of the
  layout: each change settles the graph again with what is shown, warmed
  to `alpha_filter` (a run dial), kept particles starting where they were
  and returning ones beside a neighbour. What is hidden is `field.hide`
  (page scope), so an agent can set it; the browser remembers it. Folded,
  the legend is one line of type switches.
- **Reading it.** Closed items are drawn faded. The most linked items
  (`label_hubs`) are named at any zoom. The run line says how far the run
  is. How particles, links and words are drawn keeps its values in
  `DRAW` ([paint.ts](paint.ts)), out of the panel.
- **Hover** lights a particle, its links and its neighbours, dims the rest,
  and names them ([paint.ts](paint.ts)). A click sets `here.item`; the
  item page opens beside (`map.side`). Drag a particle to move it (it
  settles again when let go), drag the sea to pan, wheel to zoom,
  double-click the sea to fit. While it settles the view eases after the
  picture (`follow_ms`) instead of jumping to fit it. ([engine.ts](engine.ts))
- It only shows: nothing here writes to the map.

On 2000 items and about 2700 links the forces settle in about 460 steps at
about 4 ms each (node, `test/field.test.ts`). The physics is ported from
the old map's Field layout (14 Nov 2026), without its islands, untangle,
flow, plane, bends and meaning.
