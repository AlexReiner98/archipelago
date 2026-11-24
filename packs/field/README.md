# field

Page side: the map as particles, the view "Landscape" (the world every agent's context interface
touches) in the frame's `center` (home). Each item is a particle in its type's colour and its base's shape,
and links are faint lines with arrows. It lays out the whole map, open and
closed, up to `field_limit` items, less what the legend hides (closed
items, to start with); while the
find line has words, only what it finds and what lies near it.

- **No groups.** The map has no islands, and Field knows none: clusters
  form from the links alone (part_of springs are the shortest and
  stiffest). Particles start on one spiral, in an order that walks the
  links, so linked ones start near each other ([graph.ts](graph.ts)).
- **Behaviours compose, and each keeps one rule.** A behaviour lowers an
  energy of its own (`energy`), and its push is that energy's downhill
  slope (`apply`) ([behaviour.ts](behaviour.ts)). [step.ts](step.ts) sums
  the pushes of the behaviours that are on, each times its weight, and
  moves each particle by its push over its mass (one plus `mass_links`
  times its links: a hub feels all its springs at once, and would shake as
  light as a leaf). So the run's whole energy falls step by step, and the
  run ends when the push left is under `settle_push` on `settle_share` of
  the particles (not the mean, which a crowd of resting leaves pulls down):
  where the pushes balance, not where it cooled or slowed. Friction is low
  (fast down long gentle slopes), and when the particles as a whole move
  against the push every speed drops to nothing (`uphill_stop`), so it
  never swings. Warmth only caps how far a particle may move in a step.
  The run line says `settled`, or `stopped` when it hit `steps_most` first.
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
  line between two particles), and `tree` (while the Landscape is
  arranged into a context filter, packs/arrange's page key `arrange.tree`, each
  of its items flies from where it stood to its place in that context filter's
  tree over `tree_ms`, eased, however fast the run steps; only those items
  are laid out, the camera keeps the whole tree in view, and the tree's
  branches and names ([treeover.ts](treeover.ts)) come in under them as
  they arrive, once what left the map has faded for `tree_in_ms` (450) so
  the two are never drawn over each other, and then at least as fast as
  `gone_ms`; the
  items' titles give way to its names).
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
  The map follows the words once typing pauses (`find_wait_ms`, `Settle`),
  not at every letter. Whatever leaves the map, by the find line or the
  legend, fades out where it stood over `gone_ms` ([gone.ts](gone.ts)),
  from as strong as it was drawn, and whatever comes onto it fades in where
  it lands over `come_ms`. What stays but takes a new size (fewer of its
  links shown) grows or shrinks to it over `resize_ms`. A ghost keeps the
  hollow or half shape it was drawn with. Its links (arrowheads and names too) and its title, where it was placed, leave with it,
  and a pointed-at item's light fades the other titles out over `dim_ms`
  before they go.
  What it finds is drawn whole, closed or not, and named first; the
  legend's open and closed switches do not apply while it has words, so a
  plan shows its done steps.
- **Shapes** ([shapes.ts](shapes.ts)). A particle is its base's mark shape
  (`types.mark`, edition 10: square, diamond, circle, triangle, pentagon,
  hexagon, as the base's pack names it), each the area of its
  circle: hollow while its status is the first open one, half (◐, one
  shape, open on the right) while later open, full once closed, as the
  item marks are. `shapes` turns them to circles; one smaller than
  `hollow_px` on screen is drawn full.
- **Wires** ([wires.ts](wires.ts)). Each link has an arrowhead at the end
  it points to, its tip on that particle's edge ("A depends_on B" points at
  B). A head is `arrow_strength` times as strong as its line, keeps
  `arrow_keep` of that while a pointer dims the rest or find fades its
  edge, and is `arrow_lit` times bigger on a lit link. A link long enough on screen, whose ends are big enough to be
  titled, or lit, has its type's name along its middle, over no title and
  no other name. A name grows and shrinks with the zoom (`link_name_size`
  times the zoom, between `link_name_least_px` and `link_name_most_px`),
  and fades in and out over `link_name_fade_ms` as it gains or loses its
  room, never popping.
- **The legend is the filter, and holds the dials** ([legend.ts](legend.ts),
  [panel.ts](panel.ts)). Closed, one line: the count and two tabs.
  `filter` opens each type (its mark in its colour and shape), each of a
  type's statuses (its mark as full as it is drawn) and kinds, each base
  by its shape (its switch shows or hides all its types), open (with how
  many sit at the first status, hollow, and at a later one, half, each a
  switch) and
  closed (faded), items with no links, and each link type as a switch, with how many the map has and how many show. Each mark is drawn by
  `markPath` ([shapes.ts](shapes.ts)) with the drawing's own dials
  (`shapes`, `hollow_line`, `closed_fade`), so the key reads as the map
  does; with shapes off, the shape and fill keys go. What is hidden is
  left out of the layout and the graph settles again with what is shown.
  What is hidden is `field.hide` (page scope); it starts with closed items
  hidden, so Field opens on the work still open, and `show all` shows
  everything (kept as `{}`). `dials` opens every dial,
  in the same box, the same size, with how the run is going last, closed
  (`state`).
- **Titles** ([labels.ts](labels.ts)). Placed in order: the particle
  pointed at and its neighbours, what the find line finds, the hubs, what
  was named last frame (so names hold still while it settles), then the
  largest on screen. The hubs are the map's central topics: the
  `label_hubs` most linked with at least `label_hub_links` links, named at
  any zoom, over other particles if need be. The set is worked out only
  when the graph or a dial changes, and a hub stays until `label_hub_keep`
  more items outrank it, so zoomed out the same few names hold through the
  solve. A particle wide enough (`label_inside`) holds its title inside,
  wrapped onto up to three lines; otherwise a title tries eight spots round
  its particle, the one it had last frame first, and takes the first inside
  the view that overlaps no title, no particle and not the legend. At most
  one per `label_room` square pixels.
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
1,350 steps at about 5 ms each (node), and its 391 open items in about 1,100
in the browser; 600 sample items settle in about 2,300 steps
(`test/field.test.ts`). The physics is ported from the old
map's Field layout (14 Nov 2026), without its islands, untangle and plane.
