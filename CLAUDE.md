# Lattice: working rules for agent sessions

Lattice is a typed map of people, work and dependencies, used by a human and by
AI agents through the same tools. README.md describes what it does; this file
is how to work on it.

## Where things stand

The state of this build is kept in Lattice itself, not in this file. At the
start of a session:

1. Make sure the server is running (`npm start`, port 3100).
2. With the lattice MCP tools: `view` with name `repo_work` for this repo's
   open work, and `search` for type `software.handoff` to read the latest
   handoff note. If the session-start hook is working you were already given
   the open work.
3. Register what you take on with `session_update`, and propose a new handoff
   note before you finish.

## Rules

- **You are an agent, not the owner.** Changes you make go through `change`
  and wait as proposals. Never approve, reject, launch or manage tokens by
  calling the CLI or `/api` yourself: those carry the human's authority.
- **Never test against the real map.** `data/` is the owner's live map. To
  exercise the server or the UI, start a throwaway one:
  `LATTICE_PORT=3199 LATTICE_DATA=<temp folder>/data node src/server.ts`
  (add `LATTICE_AUTH=tokens` to test identity). Delete it afterwards.
- **Back up `data/` before changing the database schema**, then confirm the
  entity and event counts are unchanged after the restart.
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
