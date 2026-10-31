# Drawings

Every picture is drawn by a drawing: code a pack ships for one shape, which the owner changes on the map, run in the browser's sandbox and answering with marks the page checks. The kernel keeps only the frame every picture has (the stage that pans and zooms, the key, the bar, a published page's still frame). The architecture shape was the first, the flow (a process map, `packs/core/draw/flow/`) the second and the grid (`packs/core/draw/grid/`) and the time axis (`packs/core/draw/time/`) after them, each proven in a real browser to draw what the kernel drew (`test/drawings.test.ts` and `test/drawings-moved.test.ts`, against what the kernel's code drew, kept in `test/fixtures/drawings/`); the list follows. A lens on a time axis is sent the time shape's drawing, and the page draws with a drawing only a picture of the shape it is for (`drawing.shape`). A picture published before its shape had a drawing is given the pack's own drawing for it when its page is served (`src/published.ts`), so it draws as it did until it is published again.

The canvas the app opens on draws with the flow, set by the canvas pack's preset (`packs/canvas/`, a template for a pack that changes how the map looks). The flow draws a flat graph (depth is never drawn): every item a step showing its name, depends_on the order from the top down in wires at right angles, every other link (part_of first) a tie, a wire of its own laid out the same way, each link type in its own colour (the style's `link_colours`, else one of its `link_hues`), each tie with a head where its link points unless the style names its type in `headless` (core's house style: part_of), every wire drawn all the time, since a wire left out would hide what placed it, a place that holds parts (other places: components, parts) drawn as no step but as a colour on the outline of each of its parts, named in the key, where the style gives `place_hues` (core's house style does; the place the picture was opened from stays a step), and a tip on hover with the title and the start of the note. The leaves of a step hang in a comb beside it, and what is not joined stands apart, set out toward the page's shape. It reads the flat lens's answer (items and links), and the `inside` a kept view's picture says (src/lens-saved.ts), which it reads as part_of. How it is laid out is under Wired drawings below; a step put by hand stays where it was put, and nothing else moves but what hangs on it.

The pages (`packs/core/draw/pages/`, shape `pages`) are where documents are worked on: each document a row, its title leading to its page in the sheet, its draft alone, or beside what is published with the style's `published`. Each of the two is drawn by the reader itself, so it reads and looks as the site does, figures and drawings included: the drawing makes a `reader` mark naming only the item, which of the two (`as`: draft or published) and when it or a section it brings in last changed (`at`), and the page makes it (`ui/reader-frame.js`), a frame of the preview (`/preview/<id>`, what publishing would give now) or of the published page (`/p/<workspace>/<id>`), loaded once in sight and as tall as what it holds, over a line that says whether the draft differs from what is published (the `published` read). A private document can never be published, so it has no preview: it is one frame, read as the person looking sees it (`as: own`, `/read/<id>`), and its preview says it is private. Those two pages may be framed by this server's own page and by no other (`frame-ancestors 'self'`), as may the reader for a private one; a link's page and the app are framed by none. A picture the page lays out scrolls in its view alone, never the pane or the page, and is cut at the line under the bars over the canvas whatever its own styling says (`ui/shell.css`). An item a document brings in as a section is read there, not as a row of its own: to find those lines far down a note, the drawing's entry says `notes: "whole"`, the style answer carries that on the drawing, the canvas then asks the flat read for each note whole (`notes`, for the first 100 items; the answer names them in `whole`), and its store keeps those whole as facts arrive (`ui/replica.js`).

A form chosen in the view band (`?shape=` in the address) is sent with the style read (`shape`), so the style answer carries that form's drawing.

## Where a drawing comes from

A pack declares it in `pack.json`:

```json
"drawings": [
  { "id": "core.architecture", "title": "Architecture", "shape": "architecture",
    "modules": { "index.js": "draw/architecture/index.js", "layout.js": "draw/architecture/layout.js", "look.js": "draw/architecture/look.js" } }
]
```

A style whose `shape` a drawing draws is drawn by it (`src/drawings.ts`). The owner's version is a style kept on the map with the drawing's id as its `preset` and some of its modules in `modules`: each stands in for the pack's module of that name, so changing how a picture is laid out is changing `layout.js` on the map, live. An agent's change to `modules` waits for the human (rule `code_runs`), as `code` does.

**A drawing asks in data; the page acts as the person** (the owner, 27 Oct 2026, decision e_h7he5guk). A style's own code never hears a key and never writes. It asks for a text field (`field(key, at)`): the frame's own code (`ui/draw.js`) draws a real one over the canvas and tells the code its value (`on('field')`), so what is typed stays in the page that drew the field. It asks for a change (`change(ops, reason)`): the page (`ui/style-code.js`) sends the ops through `change` as the person looking, naming the style whose code asked (`drawing`, the style answer's `coder`), and tells the code what came of it. The rules read such a change as the drawing's (`src/drawing-changes.ts`, `Who.drawing`): it may create, update, archive, restore, link and unlink, and core's `drawing_reach`, `drawing_code` and `drawing_public` hold for that person what writes outside the types its style declares (`writes`), code or what a drawing may write, or makes something public. The rest applies, as the person's own act. An agent's change to `writes` waits, as code does. Code that listens for `on('answer')` is handed the answer again as the map changes; code that does not is started again.

A lens answer carries the drawing as `style.drawing`: its id, the hash of its modules, and the modules only when the page did not say it has them (`have`).

## What a drawing is

Modules, entered at `index.js`; one imports another as `'./name.js'`, and nothing else. `index.js` exports:

```js
export function picture({ answer, style, reduced }, { measure, patch, open, frame }) {
  return { scene, on(event), viewport(view), restyle(style), end() };
}
```

- `answer` is the lens answer, `style` the style's fields, `reduced` whether the reader asked for less motion.
- `measure(text, px, font, role)` is a text's width, as the page's canvas would give it; given one of the style's text roles (`type`: weight, style, case, track), as that role sets it.
- `patch(list)` changes what is drawn, at any time; `open(id)` opens an item's page; `frame()` resolves at the page's next frame, for what moves.
- `scene` is `{ svg, key, bar, css, size: { width, height }, start }`, or `{ message }` when there is nothing to draw. A picture whose root is HTML, not an SVG (the grid's cards), or that says it is `flat` (the time axis, drawn to the page's width), is laid out by the page: not panned or zoomed, its key below it, and brought to the mark `focus` names.
- `key` says what each mark the picture uses means, one row each: `{ glyph, label, item }`, `glyph` a small mark (an `svg` of its own, checked as every mark is, drawn in the scene's stylesheet), `label` its words, and `item`, when the row stands for an item, the id its row opens. The page draws the key in the one frame every key has: on the canvas always in sight, beside the picture in the room the bars leave (the fit leaves room for it), below a picture the page lays out, above a still one; and not at all where the style says `key: "hidden"` (core's house style says `shown`). A drawing names only what it draws: the flow a row for each shape, state and link type it uses, each link type in its colour. A drawing written before the key was data may still give `legend`, marks it lays out itself.
- The page tells a drawing how wide it is (`width`: the text's width in a published document, else its host's) and how tall its host is (`height`, 0 where the host is as tall as what it holds), so a drawing can lay out to the pane's shape (the flow leans down a narrow pane and across a wide one, by `flow_aspect_follow`; the calendar sizes its hours to fit); a drawing the page lays out says so in its entry (`flat: true`), the style answer carries that, and the page gives it its box before measuring, so it is drawn once at the size it will have; a scene that says `shaped: true` is drawn again when its pane settles into another shape (by more than `plane_reshape_ratio`, still for `plane_reshape_after` ms), and the values each type's fields may take (`fields`, by type then field) and each link's title (`relations`), for the types and links the answer holds: a drawing has no registry of its own.
- `surface()` resolves, once the scene has asked for one (`surface: { key }`), to `{ canvas, size, colours, three, resized, show }`: a canvas of the drawing's own to paint (an OffscreenCanvas, 2D or WebGL), the size of its picture, the page's colours (`page`, by the theme's names, and `lens`), three.js, a way to hear the size change, and `show()`, which sends what is painted to the page as an image, shown on a canvas laid over the picture (`ui/surface.js`). Where the scene asked for none, it resolves to null.
- The picture lies on one plane (`ui/pan-zoom.js`): no edge holds it in, zoom is only scale, and the page leaves undrawn each mark (what is directly in the `svg`, or in a bare `g` directly in it) that is out of sight, a margin round the view kept drawn (the style's `plane_*` numbers). Text too small on screen is not drawn: the frame says by how big the picture's text is on screen (`data-text`: `none`, `names` or `all`, by `plane_text_least` and `plane_more_from`), and a drawing's stylesheet says what more than a name is under `[data-text=names]` (the flow folds what a choice is and the count on a step). `viewport(view)` is told what is in view as the plane moves (`{ x, y, width, height, scale }`, in the picture's units), only the latest when it moves faster than the drawing answers, and answers with patches: a drawing with more than is worth drawing at once draws what is in view.
- `on({ name, key })` is told of `enter`, `leave` and `click` on a mark that asked for them, and `seen` once, when the mark is first half in sight, and answers with patches; `restyle(style)` is told when the reader changes what stays lit.
- A mark that asks for `drag` can be moved by hand: the page follows the press (`ui/drag.js`) and tells the drawing `drag` each frame and `drop` once, with how far it has moved in the picture's own units (`dx`, `dy`; at `drop`, kept out of the corner and snapped to the style's `sizes.snap` when the reader asked for it). The drawing moves it and what is tied to it. Let go, a mark that links to an item tells the canvas where its middle now is, and the canvas keeps it in the places stream (written in one batch with `places_put` just before the person's next action, read with `places` beside the lens) and hands this canvas's places to the drawing as the style's `placed`, by item. The flow reads `placed` and wires a step put by hand live, at right angles, round the steps in the way where it can (`draw/flow/free.js`).

- **Ghosts.** On the canvas, the answer a drawing is given holds what is held for the owner where it would land (`ui/ghosts.js`, read from the pending proposals the canvas's store keeps beside its answer, read again as the queue moves): an item or link with `pending` is not yet on the map. `pending` is `{ proposal, op, by, reason }`: `op` `create` is an item a held change would make (its `id` is not an item's: draw it with no link to a page), `link` a link it would make, `update`, `archive` or `unlink` a held change to an item or link that is there. A link the person drew that the server has not yet answered for is `{ mine: true, op: 'link' }`. To let the person decide a held change where it is drawn, a drawing gives a mark the key `held:<proposal>` (anything may follow) and `on: ['click']`: a click on it puts that change to the person in the page's own words, with Apply and Decline, through the page's `decide`. The drawing only says where; it never says what the change is or decides it. The flow draws a new item faint, a link dashed in the colour of what waits on you (the person's own dashed until its fact comes), an edit as a dashed outline on its step, and a badge on each (`flow_held_*`, `flow_dash_held`, `flow_ghost`).

## Two tiers

Every drawing has one path: the answer, the style and the pins (`placed`) go in, a model is made from them, and the marks are drawn from the model. Every drawing's module list holds all it imports, and every length is a size on the style.

A wired drawing, one with wires between its boxes, adds layers and one solver. The wired ones are Flow and Architecture. Grid, Time, Pages and Meters have no wires.

`test/structure.test.ts` checks all of this. Each rule keeps a list of what already breaks it, and a list may only shrink: when a number comes down, lower it in the same commit, and never raise one.

## Wired drawings

A wired drawing is built in layers, and wires take room during layout the way boxes do, so spacing is built and not repaired. Flow is built this way. Architecture is not yet: its `layout.js` and `route.js` are more than one layer, and its entries on the lists say how far it has to come.

### The layers

Each module says its layer in its first comment (`Layer: metrics.`). A layer reads those before it and nothing after. A module that has not said so yet is on `LAYERS_OWED` in `test/wired.ts`, with what it will say; once it says it, its name comes off.

| Layer | Holds | Flow's modules |
| --- | --- | --- |
| Graph | Steps, links and which way each runs, combs, and the small things every layer says of lines | `graph`, `steps`, `lines`, `direction`, `combs`, `hangs`, `places`, `polyline`, `shapes` |
| Topology | Who crosses whom, the faces, the order of wires round each box | `topology`, `planar`, `lr`, `thread`, `numbering`, `upward`, `count` |
| Shape | Each wire's turns, and which drawing of a part is kept | `search`, `shape`, `faults` |
| Metrics | Every coordinate | `solve`, `shelves`, `wrap`, `assemble`, `pins`, `ways`, `finish`, `tidy`, `layout` |
| Marks | What is drawn | `index`, `look`, `story` |

`flow/part.js` is still Shape and Metrics together, and `flow/shape.js` still works on a sketch of coordinates that the solve then replaces.

Only Metrics sets a place or a wire's points. What still does so elsewhere is listed by module.

### The one solver

`draw/flow/solve.js` places every box edge and wire stretch. Each is a number on one axis, and each pair that stands beside one another keeps a least distance, named by what the two are:

| Distance | Between | Size |
| --- | --- | --- |
| `wire` | Two wires | `flow_wire_gap`, or a third of `flow_node_gap` if that is more |
| `room` | A wire and a box it passes | `flow_wire_room` |
| `run` | A wire and a box it goes to | `flow_port_run` |
| `corner` | A wire's end and the corner of its box | `flow_port_corner` |
| `apart` | Two boxes | half of `flow_node_gap` |
| `section` | Sections that are not joined | `flow_section_gap` |

Order on an axis is read off the drawing as given, so nothing crossed is undone and nothing new is crossed. A box is as big as its name and what lands on it need, and past that it stands rigid. One that cannot, because its ports are held further apart than it measures, gives way and is counted (`freed`).

Each joined section is solved alone (`solveSections`), then set out a section apart. A step put by hand is the exception: `hand.js` sets it after the solve, and its wires are drawn by the routers in `free.js` and `reroute.js`.

### Named lengths

A distance is a size on the style, used on both axes, with no constant in the code. `test/structure.test.ts` counts each bare number of 3 or more in a drawing that does not multiply or divide, and each `px` in a string. That catches more than lengths, and the count only goes down.

### No shared wires

Every wire is its own line: no two wires share a stretch, a comb's among them. A wired drawing runs on small sketches (`test/wired.ts`) and is counted by `spacing` in `draw/flow/faults.js`: two wires on one line, of different boxes (`overlaps`) or of one box (`shared`), and neighbours nearer than the spacing (`under`). A box on a box and a wire through a box count too. Flow is clean on all of them.

### One call

Drawn, moved, let go and reloaded should give the same wires. The rule draws a sketch, moves a step, and compares each wire with the picture drawn afresh with the step there. Flow is listed as broken: a drag frame still wires by the quick router in `free.js`, and only a drop lays out again. Architecture has no hand placing, and is listed too.

### Adding a wired drawing

1. List its modules in `pack.json`, entered at `index.js`.
2. Give each module one layer in its first comment.
3. Put its layout in `layout.js`, exporting `layout`, and name every length it uses in the house style.
4. Add it to `WIRED` in `test/wired.ts`: how it draws a sketch, and the size it keeps its wires apart by.
5. Run `npm test -- test/structure.test.ts`. A new drawing does not go on the lists: it passes each rule, or the rule says what to fix.

## Marks and patches

A mark is `[tag, attributes, ...what is in it]`; a string is text. `key` names a mark for patches; `on` lists the events it is told of; `item` says the item it stands for, as a link to the item does, and the page lights marks by it when a term of the query is pointed at (`ui/lens-light.js`), every style alike: a drawing with a surface instead hears `on({ name: "light", ids })`, with `ids` null when it ends. The page makes only the SVG and HTML tags and the attributes listed in `ui/marks.js`; a link goes only to an item's page (`#/e/<id>`); there is no script, no event handler and no style attribute. Anything else stops the drawing, and the picture says so.

A patch names a mark by its key: `toggle` classes, `set` attributes (with `over`, in milliseconds, numbers and paths move there), `text`, `mark` to replace it, `remove`, `append`.

A drawing can say what a mark is in a tip beside it: `{ tip: { key, mark } }` shows `mark` (checked as every mark is) beside the mark with that key, and `{ tip: null }` takes it away. The drawing decides when, answering `enter`, `leave` or `click` (a tap, where there is no pointer to hover), and how it looks, in its own stylesheet; the page keeps where (`ui/drawing-tip.js`): above the mark or below where there is no room, inside the picture, gone when the pointer leaves it or a tap lands elsewhere, the mark's own title set aside meanwhile. The architecture drawing gives each part and each place's name one: its name as the step shows it, and its first line.

A drawing's stylesheet (`css`) is read only inside its own picture: nested under `:where([data-drawing="…"])`, so its selectors weigh what they would alone, with the picture's paint contained. What could reach outside it (`&`, `:has`, `:root`, a leading combinator, `@import`, `url(`, a quote, a backslash, a brace that closes the wrapper) is refused.

## A picture that plays

A lens may keep `steps`: how the picture came to be, ending on the map as it is (`src/lens-steps.ts`). Each changes the one before it, from nothing: `add` and `remove` (ids), `titles` and `flag` (by id), `fields` (by id, then by name), `chapter` (`name`, `when`, `count`) and `lines` (`by`, `text`). The last step is the map as it is: what the steps leave in, with its own titles, fields and status now, and gone if it is retired (work that is finished stays), so the still picture is always the last frame and true of what it shows. What a step names is sent with the picture even when finished: a part that is gone is told of. A published picture keeps its steps, naming only what it shows.

Every drawing plays them, each on a stage of its own over the shared player (`play.js`): the flow, the grid and the time axis lay out everything the steps ever bring in and show each thing as a step brings it, in the accent a while, so nothing moves. The architecture drawing plays them as follows (`story.js`). Each step is laid out with the one before it as its prior: places keep their order and parts their row, a part keeps its place across, and a wire its line, unless something new needs the room. Places that only call one way are stacked, wires turn as little as they can, and no two drops run within 6 units. A step that takes something away does that first, in red, while nothing else moves; then the rest move, new parts and wires in the accent, wires drawn in, every corner square throughout. The chapters are a rail above the picture; what was said is a conversation on its right, and the story starts when that conversation is scrolled into sight. A style's `dots` colours each part by a field (`layer`: kernel, type pack, server pack, store, outside, yours), and every time is the house style's (`arch_story_*`). With less motion asked for, it is the last step at once. A step's `look` (`islands`) draws the story from then on as an archipelago (`islands.js`): each part's box moves into an island on a soft arc in the order its work comes, each wire is drawn again as a curved route from what is needed to what needs it, and a done island rises; the style's `dots.islands` colours it by status, with a key of its own. A step's `look` `gantt` or `kanban` lays the parts that hold work out as rows (`boards.js`): a plan, each piece of work a bar along its row, done first, then under way, then to do; or a board, the rows lanes and each piece a card in its status's column. A bar moves into a card, and both fade as the parts become islands. A step's `look` `islands_3d` turns the same islands into a relief map, painted on a surface (`deep.js`): one tile of ground with the sea floor under clear water and each island a mountain, with a contour for each piece of work inside it, coloured from the shore up as that work is done; it comes in from straight above, where it is a map of the flat picture, and tilts down while the land rises, and stays there while the work goes on. The sea runs on past the picture into a haze. Whoever a step names as the `owner` of a piece of work (`fields`) is a boat (`boats.js`), not an island: it sails, round the land, to the island that holds the work it has under way, and back to a harbour when it has none. An island that holds work is named with how much of it is done ("Website 2/4"), and islands no wire joins (projects apart from each other) each take their own place along the arc. A step's `card` (a title and a line) is what the story ends on: in relief, once the boats are home, the conversation folds away to the right, the eye rises over the map and looks up as the sea falls away into space, and the card's words stand among the stars. Its colours are the theme's `relief_*`, its heights and angles the style's `arch_deep_*`; with no surface (a still picture drawn on the server, no WebGL) the flat islands stay. A step's `fields` may give the `status` work had then, a `quick` step goes by at a fast-forward pace (`arch_story_quick`), and the last step shows the work the map has finished, not what it retired.

The landing page's story (14 steps) is checked in `packs/core/story.test.ts`: no two wires run as one, crossings (43) and turns (452) do not grow, corners stay square in every frame of every move, a step laid out again from itself moves nothing, and the last step is the map.

## The walls

A surface does not open them: the drawing paints on a canvas of its own in its worker, and only images come to the page, checked to be images; the page's canvas takes no pointer and lies inside the picture.

The drawing runs in a worker inside one sandboxed frame (`ui/draw.html`, `ui/draw.js`): an origin of its own, a policy that sends nothing anywhere, no page. Each picture talks to its worker over a channel of its own. A drawing that does not answer for 12 seconds is stopped. `test/drawings.test.ts` tries all of this against a real browser.

## When a view has drawn

An agent sees a view the way a reader does: `query look` (and `report show` with `look: true`) has the server open the app's own page in its headless Chrome (`src/look-draw.ts`, `src/chrome.ts`), as that agent sees the map, with a look pass that reads and writes nothing (`src/looks.ts`). The picture is taken once the view says it has drawn, never on a timer: the page in look mode (`?look`, `ui/look.js`) sets `data-look` on its root from the first `view-drawn` event the canvas raises. A drawing raises it once its scene is mounted and any surface over it has shown its first frame; a style's own code, once its default function has returned and its worker has painted two frames since (`drew`, from `ui/draw.js`); the lens, when it found nothing or failed. A view that says nothing in 15 seconds is taken as it stands (`late`). It is drawn dark unless the look asks for `scheme: "light"`: the page and a style's code take their theme from the system's scheme, which the server's Chrome sets for each look. The answer says whether two pictures a moment apart were the same (`settled`), and carries the picture as an MCP image.

## How fast

Measured in headless Chrome with `node scripts/drawing-bench.ts <server>`, 22 Oct 2026, against the kernel's own architecture drawing before it moved (in parentheses):

| Picture | First visit | Page opened again | Drawn again | Page's thread held |
|---|---|---|---|---|
| Landing page hero, 25 parts | 60 ms (49) | 19 ms (49) | 6 ms (7) | 0 ms (all of it) |
| A system of 205 parts | 194 ms (192) | 129 ms (192) | 63 ms (121) | 63 ms (all of it) |

A first visit counts from when the page starts its first picture, with the frame started while the answer was on its way (cold, with nothing started: 85 and 218 ms). Hovering answers in 2 to 6 ms, against at once before: the lighting is the drawing's, so it is asked of the worker.

What makes it so:

- **A published picture's first frame, kept at publish.** Where a picture's drawing is the pack's own (its hash is the pack's), the server runs it once at publish and keeps the scene it opens on with the frozen lens (`first`, `src/published-frames.ts`), its text measured by a width table of the house typeface (`src/text-widths.ts`). The page carries its data and hints every module it starts with (`src/published-page.ts`), so the frame is mounted with the text, and the sandbox takes over when it answers. A version changed on the map is run only in the sandbox. The drawing's code is fetched by its hash, kept as immutable. Landing page, over HTTP/2 at a 50 ms round trip (`node scripts/hero-bench.ts <page data>`): the hero is on screen with the text, at 277 ms on a first visit (660 before) and 208 ms on a repeat one (573).
- **One frame, started early.** A view starts the sandbox while its answer is on the way. The frame is drawn with no size, never hidden: a frame that is not drawn has its worker slowed about tenfold.
- **A warm worker waiting.** The frame keeps one worker started, its text measuring warmed, for the next drawing to load into.
- **Code sent once.** Drawings are kept by hash, the last three in this browser; the page names them in `have`, so the server does not send them again, and loads them before the first answer arrives.
- **Widths measured once.** The worker keeps each text's width; a drawing asks again and again as it cuts a name to fit.
- **The same scene, mounted at once.** A picture drawn again from the same answer and style (the map changed elsewhere) is mounted from the scene kept, before the worker answers.
- **Layout off the page's thread.** The page is held only while the marks are mounted.
