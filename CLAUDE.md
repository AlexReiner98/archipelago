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
  Check before you rely on it: `claude mcp get lattice` says which server
  you have, and without the variables it is the local one. What you write there waits for the owner in Review or on Home;
  there is no dev mode and no `restart` tool.
- **The local server on port 3100 (`npm run dev`) is where the code is
  tried.** Its map is a scratch copy: do not record the state of the work
  there. If your lattice tools still point at it, tell the owner, and they
  can import a backup of it into the hosted workspace.

At the start of a session:

1. With the lattice MCP tools: `view` with name `repo_work` for this repo's
   open work, and `search` for type `software.handoff` to read the latest
   handoff note.
2. Register what you take on with `session_start` and `session_update`, and
   propose a new handoff note before you finish.
3. Make sure the local server is running before you change code
   (`npm run dev`; port 3100).

Keep the map true as you go: when what you did or found settles something
that is still open (a task, an experiment, a decision made in practice),
change its status with the outcome and the evidence. Do not leave it open
with a note. Closing a decision or hypothesis is held for the owner to
confirm, so propose the answer.

## Rules

- **You are an agent, not the owner.** Changes you make go through `change`.
  Under `npm start` they wait as proposals; under `npm run dev` they apply at
  once, so check them before you send them. Either way, never approve, reject,
  launch or manage tokens by calling the CLI or `/api` yourself: those carry
  the human's authority.
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

## Checks before committing

```bash
npm test
npm run typecheck
```

The UI asks its questions in the page (`ask` and `tell` in `ui/app.js`), so
browser automation can answer them. Do not add `confirm`, `prompt` or `alert`.
