# UI strategy: one flat canvas, and a sheet over it

The map grows faster than a person can read it, so the page draws only what
a lens asks for, on one flat canvas, and one thing at a time is read in a
**sheet** that opens over it from the side. This file says what each surface
is for; `docs/canvas.md` gives the principles and the modules that build it.

The UI rules in `CLAUDE.md` still hold; where the two disagree, change the
rule and say so in the commit.

## 0. The flat canvas (25 Oct 2026)

The owner's words (24 Oct 2026): the canvas becomes the main view; an item
gives its most important facts on hover, and clicking it opens it from the
side to act on. The design that built it is the map's document "Rework: the
canvas as a flat graph", with its decisions.

### What is drawn
- **One flat plane.** Every item a node showing its name, every link a wire:
  `depends_on` draws the order, every other link a quiet tie. Depth is never
  drawn (decision "Depth is never drawn"). The plane has no edge; zoom is
  scale and how much text shows.
- **A lens says what is on it.** A filter (text, types, ids, links such as
  `tagged e_x` or `waits_on me`, each adding seeds; terms that must all
  hold of a seed, such as a type within an item; and what is left out), a walk along the
  link types named for some steps, and a limit. It is kept in the address
  (`#/v?<lens>`, or `#/e/<id>?<lens>` with an item's page over it) and
  always in sight in the **query bar**, as chips changed in place.
- **A style says how it looks,** and which drawing draws it: the core flow,
  by the canvas pack's preset, unless a nearer style says otherwise.
- **Home (`#/`) is the map's top:** what stands at the altitude of the
  workspace or a project, open, with what is directly in each.

### Growing a canvas
- **A click on a node opens its page** in the sheet and leaves the lens as
  it was (the owner, 28 Oct 2026). Hover shows its title and the start of
  its note.
- **Find, at the canvas's foot, sets the seeds.** Typing shows in one line
  how many it would find and their first names; Enter draws them in place of
  the lens, what it leaves out kept; Shift+Enter adds them to it.
- **An item's address alone** (`#/e/<id>`) keeps the canvas when it draws
  the item, and otherwise draws the item with what it holds, depends on and
  waits on.

### Saved canvases and Home
- **A saved canvas is a lens and a style** kept on the map (core's `lens`
  type; the page calls it a canvas). The bar names the one up and switches
  to the others; ☆ saves the canvas as it is, under a name.
- **Home's sheet, For you, lists the canvases first,** then Start here,
  what is held for your word and Your move (at most five). The mark in the
  top bar counts what waits for you and opens it.

### Writing on it
- **Every gesture is a change,** on the person's authority:
  - a wire pressed from a node's edge (or with Alt) and let go on another
    asks which link it is, and makes it;
  - the sheet's Save writes title and note as one change set, undoable as
    one, after asking if someone changed the item since it opened;
  - a status is an action of its own.
- **A held change is drawn as a ghost where it would land** (a faint node,
  a dashed wire, a badge on an edited one); a click on it applies or
  declines it.
- **A node can be put anywhere by hand.** Moves stay on the page and are
  written in one batch just before the person's next action, into the places
  stream: one place per canvas and item, never an item or a link. Where a
  thing sits never means anything; a grouping that matters is a link.
  Arrange lays the canvas out again; snap is a setting.
- **A new item is started on the canvas:** double-click or +. It is loose
  until it is tied; once a change ties it, the canvas goes to it.

### Panes
- **More than one canvas at once,** side by side in a tab, docked by dragging
  a pane's name as in a code editor, and in tabs at the top, one for each
  session at work, each popped out into a window of its own and back
  (`docs/canvas.md`, Tabs and panes). The bar and find act on the pane last touched,
  and each pane has its own back and forward; the sheet opens over the main
  canvas. Where the panes stand is the reader's, in their browser.

### The sheet
- **The sheet is the item's one page,** over the canvas where it stands,
  never more than half the screen (all of it on a phone); Esc or × goes back.
  It also holds a new item, the Workspace page, a screen from the menu, and
  For you. What the item page holds is being settled with the owner (task
  "The page as a bare markdown file"); what is settled is above: Save, a
  status of its own, and no list of links.
- **Nothing else is on screen:** the top bar (the query bar, the mark, the
  menu) and find. The key, fit and snap are settings in the menu, kept in the
  reader's browser.

### Staying current
- **The page is a replica of the log.** It holds the lens's answer as items
  and links and keeps it current from the facts written after it read, so an
  agent's change lands in place without the canvas being read again.

## 1. Altitude: a fact of each type

Every type has an altitude, declared in its pack (the kernel reads it from
the registry): 0 workspace, 1 project, 2 stream (features, components,
releases, documents), 3 step (tasks, issues, decisions, notes). It is read
from the type, not from how deep an item happens to sit.

On screen altitude chooses Home's seeds (section 0); it no longer draws
pages of one level, rows with pills or a breadcrumb. Those were replaced by
the flat canvas (the question "Which UI rules does the canvas-first UI
replace?", left to the owner to settle).

## 2. Growth: what agents raise starts noticed, not open

The map should keep everything agents find; the screen should not show it
until someone decides it matters. An item an agent raises on its own
judgment (an issue, a task, a question it noticed in passing) arrives
**noticed**, not open:

- It counts on its parent as "noticed: 4", and appears nowhere else.
- It becomes open when the owner promotes it, when a session takes it on, or
  when something open comes to depend on it.
- Noticed items untouched for 30 days fold away (archived, never deleted;
  search still finds them).

This changes what the map records, not only what the screen draws; the owner
agreed to it as written on 19 Oct 2026.

## How a change is judged against this

Before adding or changing a screen, check:

- Is it a lens? A new way of choosing what is drawn is a term of the flat
  lens or a saved canvas, never a page of its own.
- Is it a look? Then it is a style, or a drawing a pack ships.
- Does it draw one thing inside another? Then it is a tie, not a box.
- Does it write? Then it builds ops through `change`, on the person's
  authority, and its held form is a ghost.
- Does it call a tool an agent does not read the canvas with? `npm test`
  refuses a new name the page calls through `/api`.
- Does it raise new items? Then they arrive noticed unless the owner asked.

## Settled by the owner

- 19 Oct 2026: Your move is capped at five; noticed items as in section 2.
- 22 Oct 2026: names say the technical mechanism, not a theme (Atlas became
  Saved views, now saved canvases).
- 24 Oct 2026: canvas first; connections drawn, never listed.
- 25 Oct 2026: the flat canvas (decisions "Depth is never drawn", "The lens
  is a filter, a walk and a limit", the view stream for places, tags); only
  intentional actions reach the map; keep the flow as it is.
