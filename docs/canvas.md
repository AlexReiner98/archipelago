# The canvas: principles and structure

The page is built from the same three things as the store: items and links,
read by a lens, drawn by a style. It is one flat canvas, where every item is
a node and every link a wire, with a sheet over it for one item at a time.
Seven principles decide it; from them a developer can predict what the page
does, and each names the check in `npm test` that holds it. What each surface
is for is `docs/ui-strategy.md`; the words are `docs/glossary.md`.

## The principles

### 1. Three things on screen
What is drawn is items and links; which ones is a lens; how they look is a
style. The page keeps no other state of the map and no look of its own.
- `test/lens-flat.test.ts`: "the answer is items and links, and nothing of
  the old lens".
- `test/page-style.test.ts`: "a page is drawn by its style: the house style,
  a kind's preset over it, the owner's version over that".
- `test/structure.test.ts`: "how things look lives in style presets, not in
  the kernel"; "the kernel draws no shape of its own".

### 2. Depth is never drawn
One plane. `part_of` is a quiet tie that draws near, `depends_on` draws the
order, and no box holds another. Zoom changes scale and how much text shows,
never structure. Containment is a projection the server keeps (the
`part_of` closure), never geometry.
- `packs/core/flow.test.ts`: "a flat lens's answer is drawn: every item a
  step, part_of a tie, depends_on the order, nothing nested".
- `test/structure.test.ts`: "the canvas draws no depth, and places are read
  only to draw" (the canvas asks for no nesting; the flat lens names none).

### 3. The lens is a filter, a walk and a limit, and the only bound
Its parts have one name each, on the page and in an agent's answer: Find,
Only, Not, Walk and Limit (e_drt4g872, `docs/glossary.md`). The filter has
two kinds of term. Find's add seeds, each its own (words, types, ids, links
such as `tagged e_x`, `in` an item: all that is part of it at any depth,
from the part_of closure, e_tvsdqjeq; a union); Only's must all hold of a
seed (an AND: types, and plain words,
`done`, `blocked`, `status <s>`, `owner me`, `no owner`, `over estimate`,
`changed since 7d`, `made since <date>`, `by owner`, `by agent`, read in
`src/lens-only.ts`, e_xe5dx55e; `within`, items it is part of at any depth,
read from the part_of closure). What Not
leaves out applies to everything the walk reaches, never to an item named
by id (e_yasbwj45); Walk
follows the link types named, each out (→, `depends_on>`), in (←,
`depends_on<`) or either way (↔, as a lens kept before ways were said), for
some steps, a click on its arrow in the bar turning it (e_gue6cg6q); Limit
caps it. A filter that includes nothing is refused, so no canvas reads the
whole map. Words typed in find are a Find term, the filter's text; tags are
a core `tag` type and a `tagged` link, found by and, in the house style, not
drawn. A lens may instead name a view whose answer is items and links
(`view`, in the address `?view=usage`), drawn in place of what a filter
finds: the plan pack's Usage canvas draws core's `usage` view, asked by the
page as an agent asks it (the owner, 29 Oct 2026, e_7frmyj2q). It is not a
replica of the log: it is asked again when the canvas is drawn again, and a
term added in find makes it a filter of the map.
- `test/lens-flat.test.ts`: "a filter that includes nothing is refused";
  "what is excluded is left out of everything the walk reaches, and is not
  walked through"; "the limit caps what is sent, seeds first, and says it
  cut"; "the text is the search read"; "narrowing: only and within must all
  hold of every seed, not of what the walk reaches"; "an item named by id is
  drawn whatever Not says, and the walk from it still keeps Not".
- `test/lens-terms.test.ts`: "Find in an item: all that is part of it at any
  depth, of any type, not the item itself"; "the walk follows each link out,
  in or either way, as it is named"; "Only's plain words: each must hold of
  every seed, and the walk is not narrowed".
- `test/find-lens.test.ts`: "in a browser, the find bar sets the text of the
  canvas lens".

### 4. Lens and style are the whole surface, for people and agents
A person grows a canvas by editing its lens in find, at the canvas's foot,
which is the query's (e_2a4mddx8): at rest it says the lens in one line;
open, the rows Find, Only, Not, Walk and Limit rise above it; typed, it
lists what the words could be, each said by its kind, Words first and lit,
and a part's word and a space (`only `) puts it in that part (a click only
opens an item's page, e_jedng69e). The top keeps the view's band. An agent reads the same lens
(`query` name `flat`) and points the page at one (`report` action `show`
with `lens`). The page calls no tool an agent lacks for it. A term is made
by picking its kind, then the thing (Find's kinds: Words, Type, Tag, Link,
Item, In; Only's: Type, Within, its plain words, Status, Owner, Changed or
Made since; an item by its name from a list, kept by its id); nothing written is taken for a term, and a name an agent writes
is answered by its id or refused when two items share it (e_45sgrfqd). The bar's
pickers (the walk's links, the box's types) lead with what the canvas
draws, then what lies one step around it (the same `flat` read, walked
once), then the rest; a retired or dormant type or link type is never
offered (`ui/picker-rank.js`, task e_css8swr9).
- `test/structure.test.ts`: "the page calls no more tools through /api than
  it did" (the names it calls, frozen on 25 Oct 2026; the list only shrinks).
- `test/lens-flat.test.ts`: "an agent asks it by name, and sees only what
  the viewer may".
- `test/saved-canvases.test.ts`: "an agent makes and changes a saved canvas
  through change, and report show opens it".

### 5. Views are items; places live in a stream of their own
A saved canvas is a lens and a style kept on the map, an item of core's
system type `lens`, and Home lists them. Where a person put a node is a
place in the `places` stream: one per canvas and item, compacted to the
newest, never an item or a link, read only to draw it there. Position never
carries meaning; a grouping that matters is made as a link.
A pack ships saved canvases as presets (a `styles` entry of `type: "lens"`,
decision e_x8bghuce): the picker and Home list each until the owner saves
their own version, which names it (`preset`) and stands in its place.
A style is the pane's (decision e_tqr9cxdc): editing the lens keeps it,
opening a saved canvas brings its own, and Save keeps both. The view band
switches it beside the canvas (`ui/look-switch.js`); the band's ⋯ holds
Arrange, Fit and Snap for the main canvas (decision e_yxp78scv).
- `test/saved-canvases.test.ts`: "in a browser, a canvas is saved from the
  bar, listed on Home, opened and switched to, its places its own".
- `test/canvas-places.test.ts`: "a move names a canvas and items the map
  has"; "compaction leaves the newest place of each item on each canvas".
- `test/structure.test.ts`: "every store is named, with its rule"; "the
  canvas draws no depth, and places are read only to draw".

### 6. The page is a replica of the log
The page holds a lens's answer as items and links by id, and keeps it
current by reading the facts after its position on what it holds, folded in
by the same pure projector the server runs. It never polls for a picture or
compares answers.
- `test/replica.test.ts`: "the page's projector makes the server's rows from
  the log, row for row"; "the facts after a position are read only on what
  is held, as the viewer may see them".
- `test/canvas-replica.test.ts`: "in a browser, an agent's change reaches an
  open canvas without a lens read".

### 7. Every gesture is a change through the one write path
A status, Save in the sheet: each builds ops and sends
them through `change` on the person's authority, where the rules decide
whether it applies or waits. A held change is drawn as a ghost where it
would land and decided there. Moves are the one batch outside it, written to
the places stream just before the person's next action.
- `test/structure.test.ts`: "items and relations are written in one place";
  "every approval is decided by a rule".
- `test/canvas-wires.test.ts`: "in a browser, opening a step keeps the canvas
  still and lights it, and a held change is decided where it would land".
- `test/ghosts.test.ts`: "held changes are drawn where they would land, and
  only there".
- `test/canvas-drag.test.ts`: "in a browser, a step dragged on the canvas is
  kept in the places stream and drawn there again".

### 8. An item reads the same everywhere
Rule 11 of the target model (decided 26 Oct 2026, e_bed3aj7d). An item's page
is its head, its fields and its note. A field is drawn by the kind its type
declares it as (`ui/fields.js`), and by its shape where the kind does not say,
so a field a pack adds that no one foresaw is still read; never by its name.
It is changed where it stands the same way (`ui/field-edit.js`): a pick (a
value from a menu, a day, yes or no, an item) is a change at once, and words
(text, numbers, lists, rows, a set of names, JSON) wait with the note for the
page's one Save (decided 26 Oct 2026, e_mvzugyga). System fields are only
read. What a field means beyond its kind comes from capabilities: a question
whose type declares `settles.choices` (and `chosen`, `why`, `on`) is settled
by picking one, as one change (e_xyxct9nq). A note is written in one dialect (`ui/text.js`: titles,
lists, checklists, callouts, tables, code, emphasis, links, items by id),
read the same by the sheet and the published reader; ticking a checklist is a
change to that line. How it looks is the style's `notes` (callout colours, the
measure it reads at), shipped by the house style and a pack's presets.
- `test/text.test.ts`: "a note reads as titles, lists, checklists, callouts,
  code and tables"; "the item page and the published reader read one dialect".

## The modules

### In `ui/`
| Module | What it is |
| --- | --- |
| `app.js` | routes the address to the canvas and the sheet |
| `canvas.js` | a pane's canvas: its lens, Home's lens, clicks, moves batched, Arrange |
| `lens.js` | the address codec (`readFlatLens`, `flatQuery`); `flatView` reads, holds and draws a lens |
| `query-bar.js` | the lens said in one line at rest, and as the rows Find, Only, Not, Walk and Limit, changed in place |
| `find.js` | the bar at the canvas's foot: opened, its rows; typed, what the words could be; Enter takes the lit choice, Shift+Enter adds the words (e_e3k797d3) |
| `find-choices.js` | what typed words could be in each part, each said by its kind, Words first |
| `term-kinds.js`, `term-pick.js` | a row's +: its kinds, then the things of that kind, picked, never guessed |
| `canvases.js` | saved canvases: the bar's switch, Save, Home's list |
| `drawing.js`, `draw.html`, `draw.js`, `marks.js` | a drawing run in the sandbox; its marks checked and mounted |
| `reader-frame.js` | the one mark the page makes itself: a document's draft or published page, read in a frame on the canvas |
| `pan-zoom.js` | the infinite plane |
| `drag.js`, `canvas-wires.js` | moving a node; drawing a wire and making its link |
| `live.js`, `replica.js`, `ghosts.js` | tailing the log; the store; held changes drawn into it |
| `panes.js`, `pane-drag.js`, `pane-address.js` | more than one canvas at once: panes alike side by side in a tab, dragged; the address and back and forward the pane in focus's |
| `tabs.js`, `tab-bar.js`, `pane-route.js`, `pane-land.js` | tabs at the top, one per session at work, popped out and back; where an agent's step lands |
| `item.js` and the sheet's parts | the item's page (being settled) |
| `fields.js` | a field's value by its kind, else by its shape; the choices a question settles by |
| `text.js`, `body.js` | the one dialect a note is written in, and the note drawn from it, folded |

### In `src/` and `packs/`
| Module | What it is |
| --- | --- |
| `src/lens-flat.ts` | the flat lens (core view `flat`) |
| `src/lens-saved.ts` | saved canvases: their picture, `shown_in`, the move from old views |
| `src/styles.ts` | the style a page or view is drawn in (core view `style`) |
| `src/drawings.ts` | which drawing a style names, and the owner's version of it |
| `src/canvas-places.ts` | the places stream: `places`, `places_put` |
| `src/tail.ts`, `src/project.ts` | facts after a position; the pure projector (served as `/project.js`) |
| `src/pelago.ts`, `src/rules.ts` | the one write path, and what decides it |
| `packs/core/draw/flow/` | the flow drawing: `graph.js` flattens, `layout.js` orders, `free.js` keeps places, `index.js` answers marks |

## How a canvas is read
1. The address holds the lens (`#/v?…` or `#/e/<id>?…`); `app.js` reads it
   with `readFlatLens` and `canvas.js` `showCanvas` puts it up (Home's lens
   when there is none).
2. `flatView` asks `view` `flat` with the lens and `view` `style` beside it,
   and `canvas.js` asks `places` for the canvas (the saved canvas, else the
   first id in the filter, else the whole map).
3. The answer goes into a store (`live.js` `replicate`), with the position
   read before the lens and the changes held for the owner.

## How it is drawn
1. The style names a drawing; `drawing.js` sends it the store's `drawn()`
   (the answer with ghosts and the person's pending wires) in the sandbox.
2. The flow lays out what has no place round what has one, and answers with
   marks; the page checks them and mounts them in the plane.
3. The query bar draws the lens; a click on a node rewrites the address with
   the node's id added, and the cycle starts again.

## How it is kept current
1. `live.js` calls `tail` with the page's position and the ids it holds.
2. Each store folds the facts in with the projector and tells its listeners
   what changed; `flatView` draws again. Only a link to something the store
   does not hold reads the lens again, since the walk may now reach further.
3. When the queue moves, the held changes are read again and the ghosts
   follow.

## How it is written
1. A wire let go on a node asks which link, then `change` as the person; it
   is drawn at once as pending and kept or dropped when the answer comes.
2. A drop on the canvas is batched; before any act (`change`, `decide`,
   `undo`...) `ui/base.js` writes the batch with `places_put`.
3. A held change comes back as a proposal, drawn as a ghost; a click on it
   asks Apply or Decline, and `decide` settles it.

## Tabs and panes: more than one canvas at once
Every pane in a tab is alike (the owner, 28 Oct 2026): none is the main one.
Each is a canvas of its own (`canvas.js`): a lens and a style, held in its
own store and kept current from the log, with its places, its wires, its
fitting and Arrange. Panes stand side by side, as a code editor's groups do:
◫ in the bar opens the pane in focus's canvas in a pane beside it, a pane's
name dragged onto a side of another docks it there (onto its middle swaps
them), the line between two shares the room, and × closes it; the last one stays. One pane alone has no strip: the bar floats
over its top, as the page's canvas always did.

The pane last touched is in focus: the view's band sits in its strip and
find acts on its lens (decision e_h2pqjy2q). The address is its address
(`pane-address.js`): `#/v?…` says its lens, and an item's page open over it
is `#/e/<id>?…` with that lens beside it. Moving focus rewrites the address
without a step of the browser's; a lens given to a pane in focus is one. Each
pane keeps its own back and forward, kept with its tab, so a reload draws
every pane as it was, history included: a step for each lens it is given,
none for typing or for a page opened over it (e_ssnyd3ex). ‹ › in the bar,
dimmed with nowhere to go, and the browser's own back and forward, all act on
the pane in focus. A click on a node in any pane puts that pane in focus,
adds the node to its filter and opens its page in the sheet over it. Find shuts when
another pane or tab comes into focus, and what was typed goes. On a page taller than wide a row is
drawn as a column. The top bar runs across the page over the sheet, one pane
or several: the sheet opens under it.

A tab (`tab-bar.js`, `tabs.js`; decision e_mzer5m4t) is a set of panes,
which stay together in it. The tabs stand in the
top bar, one tab included, each named as its pane in focus is: a session's by the
session in its hue, else a saved canvas or an item by its name, a lens by
what its filter finds, Home by Home. There is no most: many shrink to their
mark and first letters (e_q3amet26). What is the tab's own is on the strip,
never in the query bar, which shows the lens (e_j7ggggjr): + at its end
opens the canvas in a tab of its own; a press brings a tab into sight, a
middle press closes it, and every tab has ⋯, its menu, and ×, in sight or not. A tab,
not a pane, pops out into a window of its own (Pop out in ⋯, or the tab
dragged out of the page) and ⇲ there docks it back whole (e_ezb7s3a7).
Brought into sight again, a tab's bar acts on the pane last touched in it
(e_x9b9yv5g), and the bar's canvas name takes the hue of the session it
follows. The tabs are the reader's, kept in this browser for each workspace
like the canvas settings: never on the map, meaning nothing.

A pane moves into a tab of its own by hand, with ⧉ in its strip or dragged
onto the tabs, in sight beside the one it left; a pane held for a session
takes the session with it, and the new tab follows it (e_c5stzz6z). An agent
cannot ask for a tab: a tab is the reader's. The way back is the reader's too:
Merge into in ⋯, or a tab dragged onto another, puts its panes beside that
tab's, and a pane dragged onto a tab joins it, the pane in focus there staying
so. A session keeps what is its own through all of it: a pane moved to a tab
takes the session along, panes from a tab that followed a session are held
for it again, and its next show finds them in any tab but one that follows
nobody.

Each tab follows everyone (the default), one session, or nobody (its name
in italics): the reader picks it in ⋯. Where an agent's step lands is `pane-route.js`, worked
out from that alone (decisions e_622ev534, e_nwmx4tbd, e_y7uz9pk9):
- only a show lands: a change or a beat of a session's story moves nothing
  and is said nowhere on the canvas (the owner, 29 and 30 Oct 2026,
  e_e7yfp2yg). Whom a tab follows is the one control: there is no line at the
  foot and no Follow agents;
- a session's show goes to the tab that follows it;
- else to a tab that follows everyone and no other session at work (a step
  within ten minutes) holds: the one where it holds a pane, the one it
  landed in, the one drawing it, else the one in sight;
- when those are all held by other sessions, it gets a tab of its own,
  following it, out of sight;
- within the tab, a show's `pane` may be a name of the session's own ("map",
  "tests"): a pane by that name is split beside the others the first time and
  drawn in again each time it is named. Else it goes to the session's own
  pane: one held for it (a pane keeps whose it is, and says so in its strip,
  for as long as it stands, so a long session finds it again), else one that
  draws what it shows, else one nobody holds, else one split for it. Never
  the pane the reader is in or touched last (the owner, 28 and 29 Oct 2026);
  in a tab that follows the session alone every pane is its own. A page that
  is not a canvas opens over a pane only there, else in a tab of its own;
- no tab is brought into sight: a show into a tab out of sight is drawn
  there and its mark rings (e_xjrpyysn);
- a pane the reader is busy in (`pane-busy.js`: a press, scroll or key there
  in the last twenty seconds, text selected there, or words typed in the
  sheet and not saved; moving the pointer or turning a dial is not busy) is
  never taken, and no pane is split into a tab the reader is at work in: a
  show goes to a tab of its own in the background instead.
A side (`left`, `right`, `above`, `below`) puts the session's pane there in
its tab; `alone` closes the others only in a tab that follows the session;
`main`, from before every pane was alike, is the session's own pane. A page
that is not a canvas (a screen) opens in the sheet only in a tab that follows
the session, and is otherwise offered. A session
is its run: a step carries the run it names (show, tell, session_update), or
the one its agent last named (`src/presence.ts`). A popped-out window follows
no agent: the main page does, and draws a show for its tab in the window's
pane in focus when that tab follows the session.

## What is not yet so
- Not leaves out only closed, system or a type; an item named to leave out
  is not yet a term of the lens.
- A kept view drawn in a document or a screen (`canvases.js` `keptView`)
  still nests what is inside what for the drawings that box it
  (architecture, grid, list). The canvas itself never does.
- An item started loose is followed with `get` calls and a list in the
  browser (`canvas.js`), not yet through a store.
- A store does not judge the filter again: an item that stops matching stays
  until the lens is read again.
