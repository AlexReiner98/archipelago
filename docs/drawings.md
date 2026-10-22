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

A drawing's stylesheet (`css`) is read only inside its own picture: nested under `:where([data-drawing="…"])`, so its selectors weigh what they would alone, with the picture's paint contained. What could reach outside it (`&`, `:has`, `:root`, a leading combinator, `@import`, `url(`, a quote, a backslash, a brace that closes the wrapper) is refused.

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

- **One frame, started early.** The lens view starts the sandbox while its answer is on the way. The frame is drawn with no size, never hidden: a frame that is not drawn has its worker slowed about tenfold.
- **A warm worker waiting.** The frame keeps one worker started, its text measuring warmed, for the next drawing to load into.
- **Code sent once.** Drawings are kept by hash, the last three in this browser; the page names them in `have`, so the server does not send them again, and loads them before the first answer arrives.
- **Widths measured once.** The worker keeps each text's width; a drawing asks again and again as it cuts a name to fit.
- **The same scene, mounted at once.** A picture drawn again from the same answer and style (the map changed elsewhere) is mounted from the scene kept, before the worker answers.
- **Layout off the page's thread.** The page is held only while the marks are mounted.
