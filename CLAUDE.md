# Archipelago: working rules for agent sessions

Archipelago is a typed map of people, work and dependencies, used by a human and by
AI agents through the same tools. README.md describes what it does; this file
is how to work on it.

## Where things stand

The state of this build is kept in an Archipelago map, not in this file. Which map
that is belongs to whoever is working; `CLAUDE.local.md` (not tracked) says
where, and how that server is run.

- **If your pelago tools are connected to a map that tracks this
  repository,** start with `query`, name `handoff`, and the repository. One
  answer holds the last push, the handoff note, what has happened since, and
  the open work. Say what you take on with `report` action `session_update`,
  keep the map true as you go, and bring the handoff note up to date before
  you finish.
- **The pelago tools are nine.** `query` reads (a view, a lens, or a read
  such as `get`, `search`, `schema`, `events`), `change` writes, `undo` takes
  a change set back, and every other action is called under its verb
  (`capture`, `assign`, `report`, `ask`, `settle`, `revise`) by name, with its
  inputs as `params`: `report` with action `tell`. `query` with name
  `actions` says what each action takes. The table of what every old tool
  became is on the task "A small surface for agents".
- **The local server on port 3100 (`npm run dev`) is where the code is
  tried.** Its map is a scratch copy: do not record the state of the work
  there. Make sure it is running before you change code. `npm run pull`
  replaces it with a copy of the live map (automations paused, the old
  folder kept as `data-backup-*`), to try a change on real data.
- **Never print the agent token.** `claude mcp get pelago` prints it in
  full; to see which server a session uses, print `PELAGO_URL` instead.

## Rules

- **You are an agent, not the owner.** Changes you make go through `change`.
  Under `npm start` they wait as proposals; under `npm run dev` they apply at
  once, so check them before you send them. Either way, never approve, reject,
  launch or manage tokens by calling the CLI or `/api` yourself: those carry
  the human's authority.
- **Say on whose authority.** A `change` takes `authority`: `of: "human"`
  with `basis` (what the owner said and where) when the owner told you to or
  decided it, `of: "agent"` when it is your own reading of the work. Do not
  claim the owner's word for your own judgment; the log keeps both apart.
  Settling a question needs it said (the core rule `settle_said`).
- **A rule decides what waits.** Whether a change applies, waits for a person
  or is refused is decided by rules as data alone (`rules` in a pack file,
  judged by `decide` in `src/rules.ts`), and a held change names the rule
  that held it (`held_by`, in the answer and on the proposal). The kernel's
  own are core's: an agent's change waits (`agent_changes`), settling a
  question is the owner's (`settle`), code that runs, what is public,
  publishing, backups. A workspace setting only lifts a rule its pack
  declared liftable (`lifted`); the server's policy (`pelago.config.json`)
  only lifts `agent_changes` where the workspace has not chosen, or forbids
  an op. Never decide an approval anywhere else: `test/structure.test.ts`
  refuses it, and `test/approvals.test.ts` keeps the table of what becomes
  of each change.
- **Restart the local server yourself in dev mode.** After changing anything
  under `src/` or `packs/`, run `npm test` and `npm run typecheck`, then
  restart it and wait for `GET /health`: with `revise` action `restart` if your
  pelago tools are the local server's, otherwise
  `curl -X POST http://127.0.0.1:3100/agent/revise -H "content-type: application/json" -d "{\"action\":\"restart\"}"`. `/health` says which commit the
  server was started from and when (`commit`, `started`): any server runs
  new code when its `commit` is the one you mean (`git rev-parse HEAD`), not
  merely when it answers. If it does not come back, the
  reason is in `runs/dev-server.log`; fix the code and it starts again on the
  next file change. Without dev mode (no restart action), ask the owner.
- **Test where the owner can watch.** Try things on the local server (port
  3100), and keep the owner's screen with you when they have it open there:
  `report` action `show` before each step worth seeing (a change you make already moves it). Say in the reason that it is a test, and undo what you
  made when you are done (`undo` with the change set). Drive a browser only
  when you need to click, and then a visible one on that same server. To see
  how a held change looks there, send it with `hold: true` (core's rule
  `asked` holds it); it leaves the
  queue by itself when the same change is then sent unheld.
- **Name what a change makes by its ref.** A title or note in the same change
  as a new item names it as `{ref}`, which becomes the item's id when the
  change is applied. Do not write an id you have not been given.
- **After the server restarts on new code, your tool list is old.** The
  client keeps the tools as they were when it connected; the prompt hook says
  when the server has restarted under the session. An action or input the server has and your
  list lacks can be called as plain JSON (`POST /agent/<tool>` with the agent
  token from the environment, never printed), or the owner can reconnect.
- **Say who is waited on with a link, not a sentence.** Work that cannot
  move until a person answers or acts gets a `waits_on` link to that person
  (what for goes in the link's `props.for`), and the link is removed once
  they have. Other work is `depends_on`, a resource is `needs`.
- **Listen for the owner.** What they do in the web UI (a decision made, an
  edit, an approval) is addressed to you as much as a chat message is. `query`
  with name `watch` answers the moment they change something: call it once for
  `latest`, then run it in the background with `after` and `wait_seconds`, act
  on what it returns, and start it again. The prompt hook also tells you, with
  the owner's next message, what they did since you last heard.
- **A throwaway server is for what the live one cannot take:** token identity,
  schema changes, launches, and anything that destroys or floods data. Always
  give it its own data folder:
  `PELAGO_PORT=3199 PELAGO_DATA=<temp folder>/data node src/server.ts`
  (add `PELAGO_AUTH=tokens` to test identity). Delete it afterwards. Never
  point a second server at `data/`; the lock refuses it.
- **Before changing the database schema, take a backup** with `capture` action `backup`
  (the server also writes one every 6 hours, to `backups/default/`), then
  confirm the item count and the log's entries are unchanged after the restart. Never copy `data/` while the
  server runs and call it a backup. A schema change never rewrites the log: an
  entry is kept as it was appended, and a new form is read through an
  upcaster (`docs/log.md`, section 6).
- **The log is the truth; the tables are its projections.** Every change to
  items and links goes through `Archipelago.change` / `apply`, which appends
  it to the workspace's log (`log_entry`, `log_fact`; `docs/log.md`) and
  projects its facts into `entity`, `relation`, `proposal`, the part_of
  closure and mentions in the same transaction (`src/replay.ts`). Never write
  a projection any other way, and never treat one as the record: a rebuild
  from the log replaces it. What skips approval is operational state, kept in
  the operational streams (`log_op`) by its pack's retention rules, and every
  store of it is named in `src/operational.ts` with its rule: add a new one
  there, or the structure test refuses it. Free text in the log is sealed
  with its item's key (`src/seal.ts`): a read of `log_fact` opens it with
  `openSaid`, never reads the bytes as words.
- **A forget cannot be undone.** It destroys the item's key, so its words
  leave the log, the projections and every backup that needs that key. An
  agent's forget waits for the owner (core's rule `forget`); never send one
  on the owner's map to test something.
- **Visibility is enforced by the database** (row level security in
  `src/db.ts`). Do not add application-side visibility filters; if something
  must cross the privacy line, add a narrow `security definer` function.
- **Types live in pack files** under `packs/`, each a manifest of fifteen keys
  (`docs/packs.md`, read by `src/manifest.ts`). Fields the system maintains are
  marked `"system": true`.
- **An item is a small head and its fields** (`src/head.ts`). The head is id,
  kind, type, title, body, visibility and its times; everything else is a
  field its kind or type declares, checked on write, and an undeclared one is
  refused. Status, owner, confidence and source are such fields, declared by
  the kinds in `packs/core/pack.json` and kept in columns of the row (for the
  indexes, row-level security and the foreign keys). Read an item's kind from
  its row (`kind`). A value over 4000 characters needs a field declared
  `"large": true`, which only a system-kind type may have. What a pack adds to the page of an item of a kind
  or type is a screen there too (a view of `form: "screen"`: pieces the kernel draws, listed in
  `src/declared.ts`); the item page (`ui/item.js`) names no pack's type.
- **The UI has no build step and no framework.** Plain files in `ui/`.
- **Dependencies stay at four** (`@electric-sql/pglite`,
  `@modelcontextprotocol/sdk`, `zod`, and since 18 Oct 2026 `pg`, for a
  Postgres server; model calls are plain fetch, in `src/model.ts`) unless the owner agrees to another. One library is kept as a file, not a
  dependency: `ui/three.module.min.js` (three.js 0.160, MIT, since 13 Oct
  2026 at the owner's asking), offered to a style's own drawing code and to
  a drawing that paints on a surface (`ui/surface.js`, since 23 Oct 2026, for
  the landing page's relief), loaded only when one asks for it, in the
  sandbox. The app's own pages do not use it.
- **A style's code runs behind two walls, and only there.** A style item may
  carry a drawing module (`code`). It runs in a worker inside the sandboxed
  frame `ui/draw.html`, never in the app's page; an agent that writes one
  proposes it, whatever the workspace lets agents do unreviewed. Do not give
  that code a page to touch, a way to the network, or anything typed. After
  changing `ui/draw.js`, `ui/draw.html`, `ui/marks.js`, `ui/surface.js` or the frame's policy in
  `src/server.ts`, run a hostile style against it in a real browser (the
  browser pane will not load a sandboxed frame); `test/drawings.test.ts`
  does, in headless Chrome.

## UI rules

What each screen is for (one level of the hierarchy per screen, a bounded
Home, named views kept on the map) is in `docs/ui-strategy.md`; read it before
adding or changing a screen.

The UI is for a person glancing at it, and most of what it shows was written
by agents, who write paragraphs. Every screen keeps to these (the owner's
goal, 8 Oct 2026: minimal, no walls of text, text never stacking vertically,
spatial where it can be):

- **One thing, one page.** An item has a single page, and every way to it
  (Home, a search, a link, an agent's show) leads to that same page, so a
  person always lands somewhere they recognise. A list or dashboard points at
  the page; it never draws its own version of the item. What one kind of item
  needs beyond the common page (a project's roadmap) is a part of that page,
  not a second screen. Before adding a screen, ask whose page it belongs on.
- **No wall of text, anywhere.** A screen never opens on more than one short
  paragraph of prose (about four lines). A note shows its first paragraph and
  the titles of its sections, each one click away (`renderBody` does this:
  keep to it, and never print a body, a reason or a field whole). If you find
  a screen that shows a block of text, that is a bug: fold it. When you write
  a note, lead with the point in two or three sentences and give every further
  part a short title on a line of its own, so it folds.
- **One line per row.** A row never wraps at any width: what does not fit is
  cut with an ellipsis, and the whole of it is in the tooltip and one click
  away. Check a new row at 1280 and at 560 px.
- **The point, not the paragraph.** A reason is shown as its first clause
  (`gist`), a note as a page with its sections folded (`renderBody`), at a
  readable width (about 70 characters).
- **Names, not identifiers.** Actors through `who`, events through `verb`,
  times through `ago`, authority through `authorityMark`. An id is something
  to copy, never something to read.
- **One word for each idea.** Item, link, kind, type, field, view,
  drawing, pack, change, rule, the map, as `docs/glossary.md` defines them;
  `npm test` refuses the retired words in the UI and the tool text.
- **A mark for a state.** Status, age, authority and counts are pills, marks
  and numbers, not sentences.
- **One or two actions in sight.** What is done rarely goes in a `menu`.
- **Draw it when it has a shape.** Structure, order and neighbourhood are
  drawn (the roadmap, the graph, an item's links), with the list as
  the second view.
- **A name is a few words.** An item's title is read in a row, in a box on a
  chart and in a tooltip: name the thing, in 60 characters at most (the
  server refuses longer from an agent), and say the rest in the first line
  of its note. "Find a repository by its remote", not "A session finds its
  repository by its GitHub address, not by a folder path on one machine".
- **No explaining sentences on the page.** What a control is for is its
  tooltip.

Look at what you changed in a browser before you push it: the local server
serves the working tree.

## Code shape

The kernel is being cut down to what keeps humans in control, with every way
of working as a pack (the design is on the map: "A minimal kernel; everything
else a pack"). These rules keep it composable while that happens, and
`test/structure.test.ts` checks each one in `npm test`:

- **No file over 500 lines.** Split it into modules, each one thing.
- **The kernel names no pack.** No pack's type or link type by name in `src/`
  or `ui/`: ask the registry for a kind or a capability.
- **One write path, checked.** Items and links are written only in
  `src/pelago.ts` and the projector it runs (`src/replay.ts`): through
  `change`, or through the operational writes and the restore path
  `src/operational.ts` names.
- **No read of the whole map.** Every SQL read of items, links, the log or
  the review queue is bounded (an id or set of ids, a subtree, a person, a
  cursor, a limit) or names an index the schema makes (`-- index <name>`).
  A view that needs everything inside an item reads the part_of closure.
- **A pack's code imports nothing of the kernel.** It is handed what it reads
  and answers with ops and requests.
- **A pack's code comes with its tests,** run without a database: input in,
  ops out.
- **Kernel modules import one way.** No cycles; type-only imports do not
  count.
- **The UI loads as modules,** with no build step: each part of the page its
  own module under `ui/`, served by name from `src/ui-files.ts`.
- **Four dependencies,** as above.
- **How anything looks is a style on the map, never kernel code,** the
  defaults included (the owner, 20 Oct 2026). A pack ships its defaults as
  style presets (`styles` in its pack file, resolved in `src/styles.ts`);
  the owner changes one by keeping their own version on the map. The UI
  keeps the mechanism (layouts, renderers, CSS rules reading variables) and
  no values: a colour, a length or a number constant in `ui/` is counted,
  and the count only goes down.

- **Every view is drawn by a drawing a pack ships** (the owner, 22 Oct 2026):
  code for one form (list, flow, grid...), in `pack.json` `drawings`, changed by the owner on
  the map, run in the sandbox, answering with marks the page checks
  (`docs/drawings.md`). The kernel keeps the frame every view has. A
  drawing moved out of the kernel must draw what the kernel drew: the same
  marks, looks and behaviour, checked in a real browser.

Each rule keeps a list of what already broke it on 16 Oct 2026. An entry may
only shrink and goes once the rule is met: when your change brings a number
down, lower it in the test, in the same commit. Never raise one.

## Checks before committing

```bash
npm test
npm run typecheck
```

The UI asks its questions in the page (`ask` and `tell` in `ui/base.js`), so
browser automation can answer them. Do not add `confirm`, `prompt` or `alert`.
