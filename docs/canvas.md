# The canvas: principles and structure

The page is built from the same three things as the store: items and links,
read by a query, drawn by a style. It is one flat canvas, where every item is
a node and every link a wire, with a sheet over it for one item at a time.
Seven principles decide it; from them a developer can predict what the page
does, and each names the check in `npm test` that holds it. What each surface
is for is `docs/ui-strategy.md`; the words are `docs/glossary.md`.

## The principles

### 1. Three things on screen
What is drawn is items and links; which ones is a query; how they look is a
style. The page keeps no other state of the map and no look of its own.
- `test/query-flat.test.ts`: "the answer is items and links, and nothing of
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
- `test/structure.test.ts`: "the canvas draws no depth, and nothing keeps
  places" (the canvas asks for no nesting; the flat query names none).

### 3. The query is a filter, a walk and a limit, and the only bound
Its parts have one name each, on the page and in an agent's answer: Find,
Only, Not, Walk and Limit (e_drt4g872, `docs/glossary.md`). Find, Only and Not
take one list of terms (`packs/query/kernel/query-terms.ts`, e_4y5x454z), each a set of items
written as words: `text <words>`, `type <t>`, `kind <k>`, `id <item>`,
`in <item>` (all that is part of it at any depth, from the part_of closure,
e_tvsdqjeq), `related <item>` (any link to it, either way), `<link> <item>`
(`waits_on me`; `<link>< <item>` what it links to), `owner <person>`,
`island <island>` (what lives on it, on a map with islands on), and
words that can only be checked of what is found: `done`, `blocked`,
`status <s>`, `no owner`, `over estimate`, `changed since 7d`,
`made since <date>`, `made before <date>` (a since and a before are a range;
a date is its day in the workspace's zone), `by owner`, `by agent`
(`packs/query/kernel/query-only.ts`, e_xe5dx55e).
The part says what is done with a set: Find adds it (a union; neither `kind`
nor a word finds, since each would read the map), Only keeps what is in it
(an AND; an item is of one type, so its types are one set), and Not takes it
away from everything the walk reaches and every item named by id
(e_ndcxf2bv); the default Not, which nobody said, hides nothing named. Walk
follows the link types named, each out (→, `depends_on>`), in (←,
`depends_on<`) or either way (↔, as a view kept before ways were said), for
some steps, a click on its arrow in the bar turning it (e_gue6cg6q); Limit
caps it. A filter that includes nothing is refused, so no canvas reads the
whole map. Words typed in find are a Find term, the filter's text. A query may instead name a view whose answer is items and links
(`view`, in the address `?view=usage`), drawn in place of what a filter
finds: a pack's Usage canvas draws core's `usage` view, asked by the
page as an agent asks it (the owner, 29 Oct 2026, e_7frmyj2q). It is not a
replica of the log: it is asked again when the canvas is drawn again, and a
term added in find makes it a filter of the map.
- `test/query-flat.test.ts`: "a filter that includes nothing is refused";
  "what is excluded is left out of everything the walk reaches, and is not
  walked through"; "the limit caps what is sent, seeds first, and says it
  cut"; "the text is the search read"; "narrowing: only and within must all
  hold of every seed, not of what the walk reaches"; "an item named by id is
  drawn whatever Not says, and the walk from it still keeps Not".
- `test/query-terms.test.ts`: "Find in an item: all that is part of it at any
  depth, of any type, not the item itself"; "the walk follows each link out,
  in or either way, as it is named"; "Only's plain words: each must hold of
  every seed, and the walk is not narrowed".
- `test/find-query.test.ts`: "in a browser, the find bar sets the text of the
  canvas lens".

### 4. Query and layout are the whole surface, for people and agents
A person grows a canvas by editing its query in find, at the canvas's foot,
which is the query's (e_2a4mddx8): at rest it says the query in one line;
open, the rows Find, Only, Not, Walk and Limit rise above it; typed, it
lists what the words could be, each said by its kind, Words first and lit,
and a part's word and a space (`only `) puts it in that part (a click only
opens an item's page, e_jedng69e). The top keeps the view's band. An agent reads the same query
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
- `test/query-flat.test.ts`: "an agent asks it by name, and sees only what
  the viewer may".
- `test/saved-canvases.test.ts`: "an agent makes and changes a saved canvas
  through change, and report show opens it".

### 5. Views are items, drawn from their query alone
A view is a query and a layout kept on the map, an item of core's
system type `lens`, and the bar's switcher lists them. It is drawn from its answer alone,
the same each time it is asked, and no node is dragged or put by hand (the
owner, 3 Nov 2026: Home wore down under places kept from other pictures). Position never carries meaning; a grouping that matters is made
as a link.
A pack ships views as presets (a `styles` entry of `type: "lens"`,
decision e_x8bghuce): the picker and Home list each until the owner saves
their own version, which names it (`preset`) and stands in its place.
Four things make a view (decision e_47pjkbxb): a query says what is on it (the
query above), a layout how it is arranged (a drawing a pack ships, or a layout
item kept on the map, core's `layout` type), a style how it looks, and the view is a name for
a query and a layout with its settings, which it holds itself (`style` on the
item): nothing reaches into it by a link, and a style is about nothing. Looks
stack in one line: the packs', the workspace's, the view's, then a person's own
colours. What moved from the styles made for one view is `packs/styles/kernel/style-move.ts`;
how the styles with code became layouts is `packs/styles/kernel/layout-move.ts`.
A layout is the pane's: editing the query keeps it, opening a saved view
brings its own. The view band switches it (the styles pack's part `styles.layout_switch`), which lists
layouts and nothing else. A change in a pane is a draft: Save is marked and
writes it to the view, and Save as new view makes another. The band's ⋯ holds
Fit for the main canvas (decision e_yxp78scv). Find never
draws in a style it names: it finds it as an item, whose page opens over the
canvas, and Use here there, a button its type declares on a screen
(`docs/packs.md`), does what the switch does (task e_q3yfvnz7). Deleting a
layout or style says which views use it; they go to the default.
- `test/saved-canvases.test.ts`, `test/saved-canvases-narrow.test.ts`: "in a
  browser, a canvas is saved from the bar at 1280 px (560 px) and listed on
  Home"; `test/saved-canvases-switch.test.ts`: "a saved
  canvas is opened from Home and switched to from the bar".
- `test/style-items.test.ts`: "in a browser, find opens a style’s page and
  Apply draws the canvas in it".
- `test/structure.test.ts`: "every store is named, with its rule"; "the
  canvas draws no depth, and nothing keeps places".

### 6. The page is a replica of the log
The page holds a query's answer as items and links by id, and keeps it
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
would land and decided there. A node is never moved by hand.
- `test/structure.test.ts`: "items and relations are written in one place";
  "every approval is decided by a rule".
- `test/canvas-wires.test.ts`: "in a browser, opening a step keeps the canvas
  still and lights it, and a held change is decided where it would land".
- `test/ghosts.test.ts`: "held changes are drawn where they would land, and
  only there".
- `test/canvas-drag.test.ts`: "in a browser, a step cannot be dragged: a
  press and move on it pans the canvas".

### 8. An item reads the same everywhere
Rule 11 of the target model (decided 26 Oct 2026, e_bed3aj7d). An item's page
is its head, its fields and its note. A field is drawn by the kind its type
declares it as (`packs/sheet/page/fields.js`), and by its shape where the kind does not say,
so a field a pack adds that no one foresaw is still read; never by its name.
It is changed where it stands the same way (`packs/sheet/page/field-edit.js`): a pick (a
value from a menu, a day, yes or no, an item) is a change at once, and words
(text, numbers, lists, rows, a set of names, JSON) wait with the note for the
page's one Save (decided 26 Oct 2026, e_mvzugyga). System fields are only
read. What a field means beyond its kind comes from capabilities: a question
whose type declares `settles.choices` (and `chosen`, `why`, `on`) is settled
by picking one, as one change (e_xyxct9nq). The page opens on one band under its
title, before its head (decision e_ktr4vbcd, `packs/sheet/parts/page/lead.js`): a question that settles
on its choices, or its answer once settled; any other type on what its capability `lead` declares, as
data a pack ships: a `measure` (its `value` large, with `unit` and `as_of`), an `alert` while the boolean
`unless` is false (with `says`, and a press that makes it true), or a `timeline` of the beats a json
`beats` field keeps. Fields the band shows are not shown again below it. The head is one line of marks under the title (type, status as a
pick, age, who may see it, the owner, how sure only when not sure: e_x3h4vbe7). An item that waits on the
person looking says so in the band, with what for (a state, not a listed link: e_xj9cs33u). A screen's
piece with `place: "lead"` stands in the band too, the kernel's own or one a pack's part draws as
`piece.<name>` (e_x89zp8uz). A note is written in one dialect (`packs/kit/page/text.js`: titles,
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
| `canvas.js` | a pane's canvas: its query, Home's query, clicks, moves held on the drawing, Arrange |
| `query.js` | the address codec (`readAddress`, `addressOf`); `flatView` reads, holds and draws a query |
| `query-bar.js` | the query said in one line at rest, and as the rows Find, Only, Not, Walk and Limit, changed in place |
| `find.js` | the bar at the canvas's foot: opened, its rows; typed, what the words could be; Enter takes the lit choice, Shift+Enter adds the words (e_e3k797d3) |
| `find-choices.js` | what typed words could be in each part, each said by its kind, Words first |
| `term-kinds.js`, `term-pick.js` | a row's +: its kinds, then the things of that kind, picked, never guessed |
| `canvases.js` | views: the bar's switch, Save, Home's list |
| `layout.js`, `draw.html`, `draw.js`, `marks.js` | a drawing run in the sandbox; its marks checked and mounted |
| `reader-frame.js` | the one mark the page makes itself: a document's draft or published page, read in a frame on the canvas |
| `pan-zoom.js` | the infinite plane |
| `pinch.js` | two fingers on it |
| `canvas-wires.js` | a held change's badge clicked, opening where it is decided |
| `live.js`, `replica.js`, `membership.js` | tailing the log; the one store, keyed by item, shared by views; when a view asks again; held changes drawn into it |
| `panes.js`, `pane-address.js` | the one canvas at the page's address, with back and forward in the band |
| `pane-route.js` | what a session is called where a show lights its item |
| `item.js`, `item-sections.js`, `field-edit.js`, `link-pick.js`, `settle.js` | the item's page, the host's by who owns what (the owner, 13 Nov 2026): its frame, fields, links, choices and settling for any type; a piece only one type or screen has is a part of the pack that owns it (a screen's note: `canvas.note`) |
| `fields.js` | a field's value by its kind, else by its shape; the choices a question settles by |
| `text.js`, `body.js` | the one dialect a note is written in, and the note drawn from it, folded |

### In `src/` and `packs/`
| Module | What it is |
| --- | --- |
| `packs/query/kernel/query-flat.ts` | the flat query (core view `flat`) |
| `packs/lenses/kernel/query-saved.ts` | kept views: their picture, `shown_in`, the move from old views |
| `packs/styles/kernel/styles.ts` | the style a page or view is drawn in (core view `style`) |
| `packs/loader/kernel/layouts.ts` | which drawing a style names, and the owner's version of it (a layout with its `preset`) |
| `packs/log/kernel/tail.ts`, `packs/log/kernel/project.ts` | facts after a position; the pure projector (served as `/project.js`) |
| `packs/write/kernel/pelago.ts`, `packs/rules/kernel/rules.ts` | the one write path, and what decides it |
| `packs/canvas/layouts/flow/` | the flow drawing: `graph.js` flattens, `layout.js` orders, `free.js` keeps places, `index.js` answers marks |

## How a canvas is read
1. The address holds the query (`#/v?…` or `#/e/<id>?…`); `panes.js` reads
   each pane's with `readAddress` (`query.js`) and draws it in a canvas made
   by `canvas.js` `canvasIn` (Home's query when there is none).
2. `flatView` asks `view` `flat` with the query and `view` `style` beside it,
   and nothing else: no place is read beside it.
3. The answer goes into a store (`live.js` `replicate`), with the position
   read before the query and the changes held for the owner.

## How it is drawn
1. The style names a drawing; `layout.js` sends it the store's `drawn()`
   (the answer with ghosts and the person's pending wires) in the sandbox.
2. The flow lays out every item from the answer alone, and answers with
   marks; the page checks them and mounts them in the plane.
3. The query bar draws the query; a click on a node rewrites the address with
   the node's id added, and the cycle starts again.

## How it is kept current
1. `live.js` calls `tail` with the page's position and the ids it holds.
2. Each store folds the facts in with the projector and tells its listeners
   what changed; `flatView` draws again. Only a link to something the store
   does not hold reads the query again, since the walk may now reach further.
3. When the queue moves, the held changes are read again and the ghosts
   follow.

## How it is written
1. A held change comes back as a proposal, drawn as a ghost; a click on it
   asks Apply or Decline, and `decide` settles it.

## One canvas
The page has one canvas (`panes.js`, `canvas.js`): a query and a style, held
in its own store and kept current from the log, with its wires and its
fitting. Tabs and panes side by side went on 18 Nov 2026 (decision
e_mnuthcap): what a person sees is the islands they have on, and two models
of the view, tabs and the island side bar, each claimed it.

The address is the canvas's (`pane-address.js`): `#/v?…` says its query, and
an item's page open over it is `#/e/<id>?…` with that query beside it. ‹ › in
the band, and the browser's own back and forward, step through what it drew.
A click on a node adds it to the filter and opens its page in the sheet over
the canvas. The top bar runs across the page over the sheet: the sheet opens
under it, and takes its room from the canvas, so whatever draws it stands
beside it and no view does this itself.

Where an agent's step lands (`live.js`): only a show lands, and it never
moves the reader's view. A show of an item on an island puts that island on
their canvas and lights the item in the side bar, where a press goes to it;
any other show leaves the page as it is. A change or a beat of a session's
story moves nothing and is said nowhere on the canvas (the owner, 29 and 30
Oct 2026, e_e7yfp2yg). The chats at work are the side bar's Sessions part,
and the count of those waiting on you stands beside the islands button.

## What is not yet so
- Not leaves out only closed, system or a type; an item named to leave out
  is not yet a term of the query.
- A kept view drawn in a document or a screen (`canvases.js` `keptView`)
  still nests what is inside what for the drawings that box it
  (architecture, grid, list). The canvas itself never does.
- An item started loose is followed with `get` calls and a list in the
  browser (`canvas.js`), not yet through a store.
- A store does not judge the filter again: an item that stops matching stays
  until the query is read again.
