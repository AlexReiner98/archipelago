# UI strategy: the canvas, the sheet, altitude, your move

The map grows faster than a person can read it. This strategy keeps the map
whole and the screen small. Since 24 Oct 2026 the UI is **canvas first**: the
map drawn in space is the app, and one thing is read in a **sheet** that
opens over it from the side. The ideas from before still hold where they
describe the map (**altitude**, **noticed** items). Where they described rows
on a page, the canvas replaces them, as each section below says.

The UI rules in `CLAUDE.md` still hold; this says what the screens are for.
Where the two disagree, change the rule and say so in the commit.

## 0. Canvas first (the owner, 24 Oct 2026)

The owner's words: the canvas becomes the main view; an item gives its most
important facts on hover, and clicking it opens it from the side to act on.

- **The canvas is the whole page.** Home is the map's top with what is
  directly in each thing. An item's address (`#/e/<id>`) is the canvas where
  that item stands, among what is beside it, with the item lit. A view's
  address (`#/v?...`) is that view. What the canvas draws is a lens in the
  drawing its style names: the core flow drawing for now (the owner, 25 Oct
  2026: keep the flow as it is), set by the canvas pack's preset; a project's
  own view where it keeps one.
- **Connections are drawn, never listed.** What holds what up is a wire on
  the canvas; where the canvas stands is the bar's trail. No page lists
  links: not the trail rows, Shown in, Mentioned in, Delivers, Waiting on
  this or This waits on.
- **Hover says the point.** What a step says on hover is the drawing's: the
  flow's, for now.
- **Clicking a node refocuses the canvas on it.** An item that holds things,
  or is tied by what it depends on or waits on, becomes the canvas's focus,
  with all of that around it; an item tied to nothing is lit where it sits.
- **The sheet is the item's one page, and it is written in.** It opens from
  the right on a click and holds the item read as a document: its title, one
  quiet line of marks, its note or text, and what its pack adds for its kind
  or type, as plain sections. Rare actions go in one menu.
- **Only intentional actions reach the map** (the owner, 25 Oct 2026). The
  title and note are written in place as a draft and reach the map on Save,
  one change set on the person's authority, undoable as one. Changing the
  status is an action of its own. Save asks first if someone changed the item
  since the sheet opened. Leaving a draft unsaved asks first.
- **The canvas is flexible.** A step can be moved anywhere by hand. Moves
  stay on the page and are written as one change set of their own just before
  the person's next action (a change or decision, switching canvas, leaving
  the page), onto the workspace's style that keeps places, by canvas. Wires to
  a moved step are solved live, still at right angles. Snap (a soft grid) is a
  setting; Arrange lays the canvas out again.
- **A new node is started on the canvas.** Double-click the canvas or press
  + to open a draft. It becomes an item once it has a title and is saved, and
  it is loose, tied to nothing: its note says how it relates, and an agent
  proposes the links, which wait for the owner. The flow draws it once it is
  tied. The sheet also holds a
  new item, the Workspace page, a screen in the menu, and For you. It never
  takes more than half the screen; on a phone it takes the whole of it. Esc
  or × goes back to the canvas.
- **Nothing else is on screen.** A thin bar on top shows where the canvas
  stands, a mark counting what waits for you, and the menu. Find is a bar at
  the foot of the canvas. The drawing's own controls are not drawn: the key
  and fit are settings in the menu, kept in the reader's browser. With fit on,
  the drawing is brought whole into sight on every change (a new view, the map
  changing, the sheet opening or shutting, the window resized); with it off,
  the canvas moves only when the reader moves it, and keeps where they left
  it when it is drawn again.
- **Looks are the drawing's.** How the canvas draws is a style: the canvas
  pack's preset, or one kept on the map, never the page's own code.

## The problem, as seen on 19 Oct 2026

- One project alone holds 131 items; 102 of them want attention, 65 merely
  "ready". Home lists them all, ranked, with no way to tell a project from a
  one-line fix.
- The picture the owner likes best, a system drawn as architecture, cannot be
  found: it is private, sits as the first view of a component three levels
  down (a project, then a feature, then the component), and no page lists
  pictures. Search finds it only if you already know its name.
- Agents close a task by recording what they found, and what they found is
  new issues. Nothing tells the screen that these are lower than the work
  they came from.

## 1. Altitude: one level per screen

*Replaced on screen by the canvas (section 0), pending the owner's word
(question e_eb4qrq9k). Altitude stays a fact of each type. The rows with
pills below are no longer drawn: the canvas draws one level in full and
deeper levels as a count on each thing.*

Every type has an altitude, declared in its pack (the kernel names no pack's
type; it reads the altitude from the registry):

| Altitude | What sits there | Examples |
| --- | --- | --- |
| 0 Workspace | areas, goals, the people | the workspace itself, a goal it serves |
| 1 Project | projects | a product, a client engagement |
| 2 Stream | features, components, releases, documents | "Sign-in by email", "The web server" |
| 3 Step | tasks, issues, decisions, hypotheses, notes | "Which database do we keep?" |

The rules:

- **A page shows the level below it, and only that.** A project's page lists
  its streams; a stream's page lists its steps. A step that sits directly in a
  project (no stream) is shown in a fold of its own, "loose", as a count,
  which is a prompt to file it, not a row to read.
- **Deeper levels arrive as numbers, not rows.** A stream's row carries pills
  for what is under it: open, waiting on you, blocked. Clicking a pill opens
  the stream's page filtered to it.
- **A breadcrumb is always on top,** so a person always knows how high they
  are. It is the item's `trail`, already sent by `get`.
- **Search answers by level.** Results are grouped by altitude, highest first:
  a search for "kernel" shows the feature before its forty tasks.
- **The graph and the roadmap draw one level too:** boxes are streams,
  and what is inside each is its count, until you open it.

Altitude is read from the type, not from how deep an item happens to sit, so
a decision is a step wherever it is filed.

## 2. Your move: a bounded Home

*Replaced by the canvas as Home (section 0), pending the owner's word
(question e_eb4qrq9k). What waits for you is a mark in the bar opening For
you in the sheet: what is held for your word, then your move. "Your
projects" is the canvas itself.*

Home answers one question: what can only I do next? It holds:

0. **Held for you,** a table above everything, shown only when an agent's
   change waits for the owner's word: what it does, who asked, Look, Apply,
   Decline. There is no Changes page (removed 19 Oct 2026): what changed is
   each item's history, and notifications are for agents, not the screen.
1. **Your move,** at most five rows (the owner may set the number): things
   that `waits_on` you, decisions an agent settled for you to confirm, and
   open decisions owned by you. Ranked by what each holds up. Below them, one
   line: "and 23 more, in Website (14), Mobile app (9)", each a link to that
   project's page, filtered to you.
2. **Your projects,** one row each (altitude 1), with the same pills. Not
   their tasks.
3. **The saved views strip:** the pinned pictures, as small tiles.

Nothing else is on Home by default: "ready" work, stale work and what
agents are doing are answers to questions the owner asks on a project's page,
not things pushed at them. A pack's screen may be added to Home by the owner,
never by default.

## 3. Saved views: pictures with names

A picture is a lens in a style. Today it exists only as the first view of some
item. As a saved view it is a thing in its own right:

- **Every kept picture has a title of its own,** naming what it shows ("System
  architecture"), not the item it hangs on. The server refuses a style or
  lens without one from an agent.
- **A Saved views page in the nav** lists every picture as a tile, grouped by the
  project it is about, newest first, with pins on top. It is the "one page"
  of a picture; the item a picture is about links to it, and it links back.
- **Search finds pictures** by title and by the title of what they are about,
  in a group of their own at the top of the results.
- **The owner pins** (one click on the tile). Pinned pictures show on Home.
- **A picture an agent makes is announced once** in the changes feed with its
  tile, so the owner sees it was made without hunting for it.

## 4. Growth: what agents raise starts noticed, not open

The map should keep everything agents find; the screen should not show it
until someone decides it matters. An item an agent raises on its own
judgment (an issue, a task, a question it noticed in passing) arrives
**noticed**, not open:

- It counts on its parent as "noticed: 4", and appears nowhere else.
- It becomes open when the owner promotes it, when a session takes it on, or
  when something open comes to depend on it.
- Noticed items untouched for 30 days fold away (archived, never deleted;
  search still finds them).

This is the one part of the strategy that changes what the map records, not
only what the screen draws; the owner agreed to it as written on 19 Oct 2026.

## How a change is judged against this

Before adding or changing a screen, check:

- Which altitude does it show? If more than one, it is two screens or one
  screen with counts.
- Does it add a row to Home? Then it must be something only the owner can do.
- Does it make a picture? Then the picture needs a title and a place in the
  saved views.
- Does it raise new items? Then they arrive noticed unless the owner asked.

## Order of work

1. Altitude on each type in its pack, and the breadcrumb on every item page.
2. Home: your move (capped), your projects, the saved views strip; drop the rest
   from the default.
3. The Saved views page, picture titles required, pins, search grouped by level
   with pictures first. Give the architecture picture its title and pin it.
4. Item pages list one level down, with pills; "loose" fold.
5. Noticed items.

## Settled by the owner, 19 Oct 2026

- Your move is capped at five.
- Noticed items as written in section 4, for everything an agent raises on
  its own judgment.
- The page of pictures was called Atlas; renamed Saved views on 22 Oct 2026,
  when the owner ruled that names say the technical mechanism, not a theme.
