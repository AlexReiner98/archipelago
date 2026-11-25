# Live and dev

For working on Archipelago itself while your own Claude Code sessions report
to it. To try it, [First run](first-run.md) is enough.

## Two copies

The server runs twice, so that editing the code never touches what real
sessions report to:

| | Live | Dev |
|---|---|---|
| Runs | a fixed commit, from its own git worktree (`../archipelago-live`, or `ARCHIPELAGO_LIVE`) | this checkout |
| Hot reload | off | on |
| Page, adapter, bridge | 5180, 5181, 5182 | 5280, 5281, 5282 |
| Data | `<worktree>/app/.data/`, the real one | `app/.data/` here, copied from live on demand |
| Writes skill and memory files | yes | no (`--no-write`) |
| Who reports to it | every session, through the user-level hooks and MCP server | sessions started with `plugins/claude-code/settings.json` |

## Live

```
npm install
npm run live:setup        # the worktree at main's head, its own npm ci
npm run live:start        # also live:stop, live:status
```

`live:setup` refuses a checkout in a folder that goes away (the system's
temp folder, one an app made for one session, a session's own worktree),
since live's data would go with it; `--here-anyway` goes on regardless.

Open http://127.0.0.1:5180/app/. Live runs from its own worktree, so
`live:start` tells it the checkout you set it up from
(`ARCHIPELAGO_CHECKOUT`): its empty map offers to connect this folder, and
`connect.here` with no folder connects it, not the worktree. Sessions
started here then report to live. To have every session report, wherever
it runs, point the user-level hooks and MCP server at it
([plugins/claude-code/README.md](../plugins/claude-code/README.md), "Every
session"): the hook command runs the worktree's `plugins/claude-code/hook.ts`,
not this checkout's.

## Moving live

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

## Dev

```
npm run dev:copy          # live's data into app/.data (dev stopped)
npm run dev:start         # detached, also dev:stop, dev:status
npm run dev               # or in this terminal (serve without writing)
```

Open http://127.0.0.1:5280/app/ and start Claude Code against it:

```
claude --settings plugins/claude-code/settings.json --mcp-config plugins/claude-code/mcp.json
```

That session reports to dev as well as to live, through the user-level
hooks.
