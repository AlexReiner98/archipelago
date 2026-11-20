# Archipelago (next)

Software that agents and people build together, live, out of interchangeable
packs, around a shared map of the work.

- **Everything is a pack**: the graph, the schema, the UI and the learning
  loop. Packs join, leave and reload while the system runs, and when a pack
  leaves, every trace of it goes too, its UI included. The runtime follows
  [Cordis](https://arxiv.org/abs/2608.25512): revertible effects and reactive
  dependencies.
- **The contracts are the product.** Any pack can be replaced. The interfaces
  packs talk through (`agent`, `graph`, `slot`, `here`) are versioned and owned
  by the spec, in [spec/](spec/README.md).
- **No gates.** Every change applies at once, and anything can be undone.
- **The map teaches the harness.** Everything the map says to an agent, and
  what the agent does in return, is recorded and judged. What works is kept
  and what doesn't is retired, through packs that a person and an agent refine
  together.

## Status

Early. The first build is a live **harness view** for Claude Code sessions. It
shows what is said to the agent, where it was said, by which pack, and whether
it worked.

## Running it

One process ([app/server.ts](app/server.ts)) runs the server's packs (graph,
action, exchange, agent, verdict, words, loaded, written, grow, the Claude
Code adapter, the bridge) and the page's dev server. The page's own packs
(bridge client, here, renderer, shell, harness) are in
[app/boot.ts](app/boot.ts).

It runs twice, so that editing the code never touches what real sessions
report to:

| | Live | Dev |
|---|---|---|
| Runs | a fixed commit, from its own git worktree (`../archipelago-next-live`, or `ARCHIPELAGO_LIVE`) | this checkout |
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
