# UI strategy: altitude, your move, an atlas

The map grows faster than a person can read it: agents raise two items for
every one they close, and every screen shows all of them at once, projects
beside tasks beside issues. This strategy keeps the map whole but the screen
small. Three ideas, each fixing one complaint: **altitude** (one level of the
hierarchy per screen), **your move** (Home shows only what waits on you, and
never more than a handful), and **an atlas** (the pictures worth keeping are
named, listed and found in one place).

The UI rules in `CLAUDE.md` still hold; this says what the screens are for.
Where the two disagree, change the rule and say so in the commit.

## The problem, as seen on 19 Oct 2026

- Archipelago alone holds 131 items; 102 of them want attention, 65 merely
  "ready". Home lists them all, ranked, with no way to tell a project from a
  one-line fix.
- The picture the owner likes best, the stack drawn as architecture (style
  "The stack as architecture" on lens "The stack as wired"), cannot be found:
  it is private, sits as the first view of the "Sovereign AI stack"
  component three levels down (Archipelago, then "A sovereign stack and a
  loop in seconds", then the component), and no page lists pictures. Search
  finds it only if you already know its name.
- Agents close a task by recording what they found, and what they found is
  new issues. Nothing tells the screen that these are lower than the work
  they came from.

## 1. Altitude: one level per screen

Every type has an altitude, declared in its pack (the kernel names no pack's
type; it reads the altitude from the registry):

| Altitude | What sits there | Examples |
| --- | --- | --- |
| 0 Workspace | areas, goals, the people | the workspace itself, a goal it serves |
| 1 Project | projects | Aperture, Archipelago, Aaline |
| 2 Stream | features, components, releases, documents | "A minimal kernel", "Sovereign AI stack" |
| 3 Step | tasks, issues, decisions, hypotheses, notes | "Does PGlite stay as a second driver?" |

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

Home answers one question: what can only I do next? It holds:

1. **Your move,** at most five rows (the owner may set the number): things
   that `waits_on` you, decisions an agent settled for you to confirm, and
   open decisions owned by you. Ranked by what each holds up. Below them, one
   line: "and 23 more, in Aperture (14), Archipelago (9)", each a link to that
   project's page, filtered to you.
2. **Your projects,** one row each (altitude 1), with the same pills. Not
   their tasks.
3. **The atlas strip:** the pinned pictures, as small tiles.

Nothing else is on Home by default: "ready" work, stale work and what
agents are doing are answers to questions the owner asks on a project's page,
not things pushed at them. A pack's screen may be added to Home by the owner,
never by default.

## 3. The atlas: pictures with names

A picture is a lens in a style. Today it exists only as the first view of some
item. In the atlas it is a thing in its own right:

- **Every kept picture has a title of its own,** naming what it shows ("System
  architecture"), not the item it hangs on. The server refuses a style or
  lens without one from an agent.
- **An Atlas page in the nav** lists every picture as a tile, grouped by the
  project it is about, newest first, with pins on top. It is the "one page"
  of a picture; the item a picture is about links to it, and it links back.
- **Search finds pictures** by title and by the title of what they are about,
  in a group of their own at the top of the results.
- **The owner pins** (one click on the tile). Pinned pictures show on Home.
- **A picture an agent makes is announced once** in the changes feed with its
  tile, so the owner sees it was made without hunting for it.

## 4. Growth: what agents raise starts below the waterline

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
only what the screen draws; it is the owner's decision before it is built.

## How a change is judged against this

Before adding or changing a screen, check:

- Which altitude does it show? If more than one, it is two screens or one
  screen with counts.
- Does it add a row to Home? Then it must be something only the owner can do.
- Does it make a picture? Then the picture needs a title and a place in the
  atlas.
- Does it raise new items? Then they arrive noticed unless the owner asked.

## Order of work

1. Altitude on each type in its pack, and the breadcrumb on every item page.
2. Home: your move (capped), your projects, the atlas strip; drop the rest
   from the default.
3. The Atlas page, picture titles required, pins, search grouped by level
   with pictures first. Give the architecture picture its title and pin it.
4. Item pages list one level down, with pills; "loose" fold.
5. Noticed items (after the owner decides section 4).

## Open questions for the owner

- The cap on your move: five, or another number?
- Noticed items: yes as written, or only for issues?
- Is "Atlas" the name for the page of pictures?
