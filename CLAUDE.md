# Lattice: working rules for agent sessions

Lattice is a typed map of people, work and dependencies, used by a human and by
AI agents through the same tools. README.md describes what it does; this file
is how to work on it.

## Where things stand

The state of this build is kept in Lattice itself, not in this file. There
are two servers, and they are not the same thing:

- **The map of record is the owner's workspace on the hosted server**
  (https://lattice.aperture.tools). The owner decided this on 8 Oct 2026. The
  lattice MCP tools in this folder point there when the machine has the
  environment variables `LATTICE_URL` and `LATTICE_AGENT_TOKEN` (set once
  from "Connect an agent" on the Workspace screen; `.mcp.json` reads them).
  Check before you rely on it: print `LATTICE_URL` (`echo $LATTICE_URL`; in
  PowerShell, `$env:LATTICE_URL`), and if it is empty you have the local one.
  Do not run `claude mcp get lattice` to find out: it prints the agent token
  in full, into your transcript. What you write there waits for the owner in Review or on Home;
  there is no dev mode and no `restart` tool.
- **The local server on port 3100 (`npm run dev`) is where the code is
  tried.** Its map is a scratch copy: do not record the state of the work
  there. If your lattice tools still point at it, tell the owner, and they
  can import a backup of it into the hosted workspace.

At the start of a session:

1. With the lattice MCP tools: `view` with name `repo_work` and `repo` (the
   id the session hook gave, or `AlexReiner98/lattice`) for this repo's open
   work, and `search` for type `software.handoff` to read the latest handoff
   note.
2. The session hook has registered the session (it gives the run id; call
   `session_start` only if it did not). Say what you take on with
   `session_update`, and propose a new handoff note before you finish.
3. Make sure the local server is running before you change code
   (`npm run dev`; port 3100).
4. When you take on a task, issue or feature that has no estimate, give it
   one: `tokens_estimated` in its props (input and output, not counting
   cached re-reads). What the session actually uses is measured by the
   session hook and added to what the session is working on, so name your
   task with `session_update` before you start, and again when you move on.

Keep the map true as you go: when what you did or found settles something
that is still open (a task, an experiment, a decision made in practice),
change its status with the outcome and the evidence. Do not leave it open
with a note. Closing a decision or hypothesis is held for the owner to
confirm, so propose the answer; where the workspace applies agents' changes
as made (the hosted one does, since 8 Oct 2026) it takes effect at once and
the owner is notified, so settle only what the work or the owner has in fact
settled, with what was chosen and why.

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
- **Restart the local server yourself in dev mode.** After changing anything
  under `src/` or `packs/`, run `npm test` and `npm run typecheck`, then
  restart it and wait for `GET /health`: with the `restart` tool if your
  lattice tools are the local server's, otherwise
  `curl -X POST http://127.0.0.1:3100/agent/restart -H "content-type: application/json" -d "{}"`. If it does not come back, the
  reason is in `runs/dev-server.log`; fix the code and it starts again on the
  next file change. Without dev mode (no `restart` tool), ask the owner.
- **Test where the owner can watch.** Try things on the local server (port
  3100), and keep the owner's screen with you when they have it open there:
  `show` before each step worth seeing (a change you make already moves it). Say in the reason that it is a test, and undo what you
  made when you are done (`undo` with the change set). Drive a browser only
  when you need to click, and then a visible one on that same server.
- **Listen for the owner.** What they do in the web UI (a decision made, an
  edit, an approval) is addressed to you as much as a chat message is. The
  `watch` tool answers the moment they change something: call it once for
  `latest`, then run it in the background with `after` and `wait_seconds`, act
  on what it returns, and start it again. The prompt hook also tells you, with
  the owner's next message, what they did since you last heard.
- **A throwaway server is for what the live one cannot take:** token identity,
  schema changes, launches, and anything that destroys or floods data. Always
  give it its own data folder:
  `LATTICE_PORT=3199 LATTICE_DATA=<temp folder>/data node src/server.ts`
  (add `LATTICE_AUTH=tokens` to test identity). Delete it afterwards. Never
  point a second server at `data/`; the lock refuses it.
- **Before changing the database schema, take a backup** with the `backup`
  tool (the server also writes one every 6 hours, to `backups/default/`), then
  confirm the entity and event counts are unchanged after the restart. Never copy `data/` while the
  server runs and call it a backup.
- **One write path.** Every change to entities and relations goes through
  `Lattice.change` / `apply`. Sessions, claims and notifications are the only
  writes that skip approval, because they are operational state.
- **Visibility is enforced by the database** (row level security in
  `src/db.ts`). Do not add application-side visibility filters; if something
  must cross the privacy line, add a narrow `security definer` function.
- **Types live in pack files** under `packs/`. Fields the system maintains are
  marked `"system": true`.
- **The UI has no build step and no framework.** Plain files in `ui/`.
- **Dependencies stay at three** (`@electric-sql/pglite`,
  `@modelcontextprotocol/sdk`, `zod`) unless the owner agrees to another.

## UI rules

The UI is for a person glancing at it, and most of what it shows was written
by agents, who write paragraphs. Every screen keeps to these (the owner's
goal, 8 Oct 2026: minimal, no walls of text, text never stacking vertically,
spatial where it can be):

- **One thing, one page.** An item has a single page, and every way to it
  (Home, a search, a link, an agent's `show`) leads to that same page, so a
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
- **A mark for a state.** Status, age, authority and counts are pills, marks
  and numbers, not sentences.
- **One or two actions in sight.** What is done rarely goes in a `menu`.
- **Draw it when it has a shape.** Structure, order and neighbourhood are
  pictures (the roadmap, the graph, an item's relations), with the list as
  the second view.
- **No explaining sentences on the page.** What a control is for is its
  tooltip.

Look at what you changed in a browser before you push it: the local server
serves the working tree.

## Checks before committing

```bash
npm test
npm run typecheck
```

The UI asks its questions in the page (`ask` and `tell` in `ui/app.js`), so
browser automation can answer them. Do not add `confirm`, `prompt` or `alert`.
