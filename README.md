# Archipelago (next)

**Sculpt the landscape around your agents.**

Build views into their world, so you can decide how they plan, remember, and
evolve.

- It gives each agent what it needs and the actions it can take, and records
  both, with everything the agent does.
- What works is kept. What doesn't is retired.
- What a run is given depends on the run.
- Its types, rules, views and interface are defined while it runs, and
  removed without residue.
- Every part sits behind a versioned contract ([spec/](spec/README.md)) and
  can be replaced.

## Status

Early. The first build is a live **harness view** for Claude Code sessions. It
shows what is said to the agent, where it was said, by which pack, and whether
it worked.

## Running it

One process ([app/server.ts](app/server.ts)) runs the server's packs (graph,
action, exchange, agent, verdict, words, loaded, written, grow, keep, the Claude
Code adapter, the bridge) and the page's dev server. The page's own packs
(bridge client, here, renderer, frame, views, harness) are in
[app/boot.ts](app/boot.ts).

To reach the map's MCP server from claude.ai or the Claude phone app, the
[gateway](packs/gateway/README.md) (page + 3, off unless set up) signs the
owner in with OAuth behind a tunnel.

It runs twice, so that editing the code never touches what real sessions
report to:

| | Live | Dev |
|---|---|---|
| Runs | a fixed commit, from its own git worktree (`../archipelago-live`, or `ARCHIPELAGO_LIVE`) | this checkout |
| Hot reload | off | on |
| Page, adapter, bridge | 5180, 5181, 5182 | 5280, 5281, 5282 |
| Data | `<worktree>/app/.data/`, the real one | `app/.data/` here, copied from live on demand |
| Writes skill and memory files | yes | no (`--no-write`) |
| Who reports to it | every session, through the user-level hooks and MCP server | sessions started with `packs/claude-code/settings.json` |

### Live

```
npm install
npm run live:setup        # the worktree at main's head, its own npm ci
npm run live:start        # also live:stop, live:status
```

Open http://127.0.0.1:5180/app/. Point the user-level hooks and MCP server
at it ([packs/claude-code/README.md](packs/claude-code/README.md), "Every
session"): the hook command runs the worktree's `packs/claude-code/hook.ts`,
not this checkout's.

To move live to new code:

```
npm run promote               # main's head
npm run promote -- <commit>   # or any commit
npm run rollback              # back to the commit before the last move
```

`promote` refuses when this checkout has uncommitted changes or the tests
(and `npm run check`) fail at the commit, run in a throwaway worktree. Then
it stops live, checks the commit out in the worktree (installing packages if
the lockfile changed), and starts it again; if it doesn't come up, it goes
back. Each move is a line in `promotions.log` in live's data, which
`rollback` reads. Live's data is ignored by git, so it stays across moves.

### Dev

```
npm run dev:copy          # live's data into app/.data (dev stopped)
npm run dev:start         # detached, also dev:stop, dev:status
npm run serve             # or in this terminal
```

Open http://127.0.0.1:5280/app/ and start Claude Code against it:

```
claude --settings packs/claude-code/settings.json --mcp-config packs/claude-code/mcp.json
```

That session reports to dev as well as to live, through the user-level
hooks.

## Licence

MIT
