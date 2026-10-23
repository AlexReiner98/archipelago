# Drawings

Every picture is drawn by a drawing: code a pack ships for one shape, which the owner changes on the map, run in the browser's sandbox and answering with marks the page checks. The kernel keeps only the frame every picture has (the stage that pans and zooms, the key, the bar, a published page's still frame). The architecture shape is the first; the others follow, one at a time, each proven to draw what the kernel drew.

## Where a drawing comes from

A pack declares it in `pack.json`:

```json
"drawings": [
  { "id": "core.architecture", "title": "Architecture", "shape": "architecture",
    "modules": { "index.js": "draw/architecture/index.js", "layout.js": "draw/architecture/layout.js", "look.js": "draw/architecture/look.js" } }
]
```

A style whose `shape` a drawing draws is drawn by it (`src/drawings.ts`). The owner's version is a style kept on the map with the drawing's id as its `preset` and some of its modules in `modules`: each stands in for the pack's module of that name, so changing how a picture is laid out is changing `layout.js` on the map, live. An agent's change to `modules` waits for the human (rule `code_runs`), as `code` does.

A lens answer carries the drawing as `style.drawing`: its id, the hash of its modules, and the modules only when the page did not say it has them (`have`).

## What a drawing is

Modules, entered at `index.js`; one imports another as `'./name.js'`, and nothing else. `index.js` exports:

```js
export function picture({ answer, style, reduced }, { measure, patch, open, frame }) {
  return { scene, on(event), restyle(style), end() };
}
```

- `answer` is the lens answer, `style` the style's fields, `reduced` whether the reader asked for less motion.
- `measure(text, px, font)` is a text's width, as the page's canvas would give it.
- `patch(list)` changes what is drawn, at any time; `open(id)` opens an item's page; `frame()` resolves at the page's next frame, for what moves.
- `scene` is `{ svg, legend, bar, css, size: { width, height }, start }`, or `{ message }` when there is nothing to draw.
- `on({ name, key })` is told of `enter`, `leave` and `click` on a mark that asked for them, and answers with patches; `restyle(style)` is told when the reader changes what stays lit.

## Marks and patches

A mark is `[tag, attributes, ...what is in it]`; a string is text. `key` names a mark for patches; `on` lists the events it is told of. The page makes only the SVG and HTML tags and the attributes listed in `ui/marks.js`; a link goes only to an item's page (`#/e/<id>`); there is no script, no event handler and no style attribute. Anything else stops the drawing, and the picture says so.

A patch names a mark by its key: `toggle` classes, `set` attributes (with `over`, in milliseconds, numbers and paths move there), `text`, `mark` to replace it, `remove`, `append`.

A drawing can say what a mark is in a tip beside it: `{ tip: { key, mark } }` shows `mark` (checked as every mark is) beside the mark with that key, and `{ tip: null }` takes it away. The drawing decides when, answering `enter`, `leave` or `click` (a tap, where there is no pointer to hover), and how it looks, in its own stylesheet; the page keeps where (`ui/drawing-tip.js`): above the mark or below where there is no room, inside the picture, gone when the pointer leaves it or a tap lands elsewhere, the mark's own title set aside meanwhile. The architecture drawing gives each part and each place's name one: its name as the step shows it, and its first line.

A drawing's stylesheet (`css`) is read only inside its own picture: nested under `:where([data-drawing="…"])`, so its selectors weigh what they would alone, with the picture's paint contained. What could reach outside it (`&`, `:has`, `:root`, a leading combinator, `@import`, `url(`, a quote, a backslash, a brace that closes the wrapper) is refused.

## A picture that plays

A lens may keep `steps`: how the picture came to be, ending on the map as it is (`src/lens-steps.ts`). Each changes the one before it, from nothing: `add` and `remove` (ids), `titles` and `flag` (by id), `fields` (by id, then by name), `chapter` (`name`, `when`, `count`) and `lines` (`by`, `text`). The last step is the map as it is, whatever the steps say, so the still picture is always the last frame. What a step names is sent with the picture even when finished: a part that is gone is told of. A published picture keeps its steps, naming only what it shows.

The architecture drawing plays them (`story.js`, `play.js`). Each step is laid out with the one before it as its prior: places keep their order and parts their row, a part keeps its place across, and a wire its line, unless something new needs the room. Places that only call one way are stacked, wires turn as little as they can, and no two drops run within 6 units. A step that takes something away does that first, in red, while nothing else moves; then the rest move, new parts and wires in the accent, wires drawn in, every corner square throughout. The chapters are a rail above the picture; what was said is a conversation below it. A style's `dots` colours each part by a field (`layer`: kernel, type pack, server pack, store, outside, yours), and every time is the house style's (`arch_story_*`). With less motion asked for, it is the last step at once. A step's `look` (`islands`) draws the story from then on as an archipelago (`islands.js`): each part's box moves into an island on a soft arc in the order its work comes, each wire is drawn again as a curved route from what is needed to what needs it, and a done island rises; the style's `dots.islands` colours it by status, with a key of its own. A step's `fields` may give the `status` work had then, a `quick` step goes by at a fast-forward pace (`arch_story_quick`), and the last step shows the work the map has finished, not what it retired.

The landing page's story (14 steps) is checked in `packs/core/story.test.ts`: no two wires run as one, crossings (43) and turns (452) do not grow, corners stay square in every frame of every move, a step laid out again from itself moves nothing, and the last step is the map.

## The walls

The drawing runs in a worker inside one sandboxed frame (`ui/draw.html`, `ui/draw.js`): an origin of its own, a policy that sends nothing anywhere, no page. Each picture talks to its worker over a channel of its own. A drawing that does not answer for 12 seconds is stopped. `test/drawings.test.ts` tries all of this against a real browser.

## How fast

Measured in headless Chrome with `node scripts/drawing-bench.ts <server>`, 22 Oct 2026, against the kernel's own architecture drawing before it moved (in parentheses):

| Picture | First visit | Page opened again | Drawn again | Page's thread held |
|---|---|---|---|---|
| Landing page hero, 25 parts | 60 ms (49) | 19 ms (49) | 6 ms (7) | 0 ms (all of it) |
| A system of 205 parts | 194 ms (192) | 129 ms (192) | 63 ms (121) | 63 ms (all of it) |

A first visit counts from when the page starts its first picture, with the frame started while the answer was on its way (cold, with nothing started: 85 and 218 ms). Hovering answers in 2 to 6 ms, against at once before: the lighting is the drawing's, so it is asked of the worker.

What makes it so:

- **A published picture's first frame, kept at publish.** Where a picture's drawing is the pack's own (its hash is the pack's), the server runs it once at publish and keeps the scene it opens on with the frozen lens (`first`, `src/published-frames.ts`), its text measured by a width table of the house typeface (`src/text-widths.ts`). The page carries its data and hints every module it starts with (`src/published-page.ts`), so the frame is mounted with the text, and the sandbox takes over when it answers. A version changed on the map is run only in the sandbox. The drawing's code is fetched by its hash, kept as immutable. Landing page, over HTTP/2 at a 50 ms round trip (`node scripts/hero-bench.ts <page data>`): the hero is on screen with the text, at 277 ms on a first visit (660 before) and 208 ms on a repeat one (573).
- **One frame, started early.** The lens view starts the sandbox while its answer is on the way. The frame is drawn with no size, never hidden: a frame that is not drawn has its worker slowed about tenfold.
- **A warm worker waiting.** The frame keeps one worker started, its text measuring warmed, for the next drawing to load into.
- **Code sent once.** Drawings are kept by hash, the last three in this browser; the page names them in `have`, so the server does not send them again, and loads them before the first answer arrives.
- **Widths measured once.** The worker keeps each text's width; a drawing asks again and again as it cuts a name to fit.
- **The same scene, mounted at once.** A picture drawn again from the same answer and style (the map changed elsewhere) is mounted from the scene kept, before the worker answers.
- **Layout off the page's thread.** The page is held only while the marks are mounted.
