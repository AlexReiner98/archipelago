# field

Page side: the map as particles, the view "Field" in the frame's `center`
(home). Each item is a particle in its type's colour and its base's shape,
and links are faint lines with arrows. It lays out the whole map, open and
closed, up to `field_limit` items, less what the legend hides; while the
find line has words, only what it finds and what lies near it.

- **No groups.** The map has no islands, and Field knows none: clusters
  form from the links alone (part_of springs are the shortest and
  stiffest). Particles start on one spiral, in an order that walks the
  links, so linked ones start near each other ([graph.ts](graph.ts)).
- **Behaviours compose, and each keeps one rule.** A behaviour lowers an
  energy of its own (`energy`), and its push is that energy's downhill
  slope (`apply`) ([behaviour.ts](behaviour.ts)). [step.ts](step.ts) sums
  the pushes of the behaviours that are on, each times its weight, and
  moves the particles. So the run's whole energy falls step by step, and
  the run ends when particles move less than `settle_move` a step: where
  the pushes balance, not where it cooled. Warmth only caps how far a
  particle may move in a step, and friction eases from `friction` to
  `friction_cool` as it cools, so a run that is nearly there stops
  trembling. The run line says `settled`, or `stopped` when it hit
  `steps_most` first.
- **The rule is checked, not trusted.** [descends.ts](descends.ts) checks a
  behaviour: its push against its energy's measured slope at a few
  particles, and its energy step by step with gather, warmth held. The
  field's test runs it on every behaviour, and on one made to break it.
  Field's own page in the Packs view (the slot `docs.page`) runs the same
  check on the map in view, so what the page says is what the code does.
- **The behaviours** ([behaviours/](behaviours)): `gather`, `repel`
  (Barnes-Hut on an [octree](octree.ts); its push fades to nothing at its
  reach, so gather keeps clusters together), `springs` (length and
  stiffness per link type), `flow` (order links put a plan in columns:
  each item's rank is its longest chain of what it waits on, and what it
  waits on is to the left) and `collide` (by each shape's edge along the
  line between two particles).
- **Every number is a dial**, in the legend's dials tab: each behaviour's,
  then the start, find, the run and the drawing, in sections that start
  closed and say how many of their dials are changed; springs and flow are
  grouped by link type. Each dial says what it does on hover, and ↺ puts it
  back. Their values are `field.dials` (page scope), so an agent can set
  them; the browser remembers them.
- **Find** ([filter.ts](filter.ts) `around`). While the find line has words,
  what it finds stays with what lies `find_steps` links from it, drawn in
  full, and `find_faint` links further, drawn faint (`query_fade`); the
  rest of the map leaves the layout and what is kept settles again
  (`alpha_filter`). The view goes to what it finds (`find_follow_ms`).
  What it finds is drawn whole, closed or not, and named first.
- **Shapes** ([shapes.ts](shapes.ts)). A particle is its base's mark shape
  (spec/style.ts: square, diamond, circle, triangle), each the area of its
  circle: hollow while its status is the first open one, half (◐, one
  shape, open on the right) while later open, full once closed, as the
  item marks are. `shapes` turns them to circles; one smaller than
  `hollow_px` on screen is drawn full.
- **Wires** ([wires.ts](wires.ts)). Each link has an arrowhead at the end
  it points to, its tip on that particle's edge ("A depends_on B" points at
  B). A link long enough on screen, whose ends are big enough to be
  titled, or lit, has its type's name along its middle, over no title and
  no other name.
- **The legend is the filter, and holds the dials** ([legend.ts](legend.ts),
  [panel.ts](panel.ts)). Closed, one line: the count and two tabs.
  `filter` opens each type (with its colour), each of a type's statuses
  and kinds, open and closed, items with no links, and each link type as a
  switch, with how many the map has and how many show. What is hidden is
  left out of the layout and the graph settles again with what is shown.
  What is hidden is `field.hide` (page scope). `dials` opens the run line
  and every dial, in the same box, the same size.
- **Titles** ([labels.ts](labels.ts)). Placed in order: the particle
  pointed at and its neighbours, what the find line finds, what was named
  last frame (so names hold still while it settles), the most linked
  (`label_hubs`), then the largest on screen. A particle wide enough
  (`label_inside`) holds its title inside, wrapped onto up to three lines;
  otherwise a title tries eight spots round its particle and takes the
  first inside the view that overlaps no title, no particle and not the
  legend. At most one per `label_room` square pixels.
- **Hover** lights a particle, its links and its neighbours, dims the rest,
  and names them ([paint.ts](paint.ts)); the pointer picks the nearest
  particle within `hover_px` of its edge. A click sets `here.item`; the item
  page opens in `right`. Drag a particle to move it (it settles again when
  let go), drag the sea to pan, wheel to zoom, double-click the sea to fit.
  While it settles the view eases after the picture (`follow_ms`).
  ([engine.ts](engine.ts))
- The physics runs on its own loop (a message channel), in slices of
  `frame_ms`; animation frames only paint. A tab in the background settles
  as fast.
- **Empty.** A map with no items shows a mark and one line, and under it
  the slot `field.empty`, which other packs fill with what to do first
  (the [connect](../connect/README.md) pack: connect Claude Code). A map
  whose items are all hidden, or that find finds nothing in, says
  "Nothing shown". A fit never zooms in past `fit_zoom_most`, so one item
  shows at its size.
- It only shows: nothing here writes to the map.

On the live map's copy (943 items, about 1,900 links) a run settles in about
1,800 to 3,000 steps at about 5 ms each (node); 600 sample items settle in
about 2,600 steps (`test/field.test.ts`). The physics is ported from the old
map's Field layout (14 Nov 2026), without its islands, untangle and plane.
