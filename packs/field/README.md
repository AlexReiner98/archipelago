# field

Page side: the map as particles, the view "Field" in the shell, beside
"Map". Each item is a particle in its island's colour, islands are
clusters, and links are faint lines. It draws the whole map (open and
closed) or the find line's query, up to `field_limit` items.

- **Islands are links.** An item's island is the island item it is part_of
  at any depth, or the top of its part_of chain (the `islands by` dial).
  Neither: "No island". ([islands.ts](islands.ts))
- **Behaviours compose.** [step.ts](step.ts) sums the pushes of the
  behaviours that are on, each times its weight and the run's warmth, then
  moves the particles. Each is a module in [behaviours/](behaviours):
  `islands`, `gather`, `repel` (Barnes-Hut on an [octree](octree.ts)),
  `springs` (length and stiffness per link type), `collide`, `untangle`,
  `flow` and `plane` (off by default). A behaviour is
  `{ name, doc, on, dials, apply, move?, busy?, firm? }`
  ([behaviour.ts](behaviour.ts)).
- **Every number is a dial.** Each behaviour's dials, then the start, the
  run and the drawing, are in the panel on the left, each with what it
  does on hover and ↺ back to its start. Their values are `field.dials`
  (page scope), so an agent can set them; the browser remembers them.
- **Untangle is sliced.** Once the run cools to `untangle_from`, each step
  does at most `untangle_work` link tests, trying the particles in most
  crossings at the middle of their neighbours or mirrored across what they
  cross, and keeps a move only if crossings fall
  ([segments.ts](segments.ts)). It goes on after the forces sleep until a
  pass moves nothing.
- **Hover** lights a particle, its links and its neighbours, dims the rest,
  and names them ([paint.ts](paint.ts)). A click sets `here.item`; the
  item page opens beside (`map.side`). Drag a particle to move it (it
  settles again when let go), drag the sea to pan, wheel to zoom,
  double-click the sea to fit. ([engine.ts](engine.ts))
- It only shows: nothing here writes to the map.

On 2000 items and about 2700 links the forces settle in about 460 steps at
about 4 ms each (node, `test/field.test.ts`). The physics is ported from
the old map's Field layout (14 Nov 2026), without its bends and meaning.
