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
| Page, adapter, bridge | any free ones, from 5300 (`live:status` says which) | 5280, 5281, 5282 |
| Data | map `live`: `~/.archipelago/maps/live/`, the real one | `app/.data/` here, copied from live on demand |
| Writes skill and memory files | yes | no (`--no-write`) |
| Who reports to it | the folders connected to it, by its name (`connect.here`) | sessions started with `plugins/claude-code/settings.json` |

## Live

```
npm install
npm run live:setup        # the worktree at main's head, its own npm ci
npm run live:start        # map live from the worktree; also live:stop, live:status
```

`live:setup` refuses a checkout in a folder that goes away (the system's
temp folder, one an app made for one session, a session's own worktree),
since the live code and the connected folder would go with it;
`--here-anyway` goes on regardless.

Live is map `live` ([Maps by name](#maps-by-name)), served by the
worktree's code: `live:start` is `npm run map -- up --map live --no-watch`
run there, and `live:stop` is `map down live`. Open the address it prints.
Live runs from its own worktree, so
`live:start` tells it the checkout you set it up from
(`ARCHIPELAGO_CHECKOUT`): its empty map offers to connect this folder, and
`connect.here` with no folder connects it, not the worktree. Sessions
started here then report to live by name, at whatever port it takes.

An older live kept its map in `<worktree>/app/.data/` and ran on 5180. The
first `live:start` with no map `live` yet stops that server and moves its
data in (`--from`), with the folders it had connected: their hooks and MCP
server are rewritten to report to map `live` by name. The old folder is
left as it was, as a backup. `live:status` says when an older live still
answers on 5180.

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
back. Each move is a line in `promotions.log` in map live's folder, which
`rollback` reads. The map is outside the worktree, so it stays across
moves. A commit from before maps by name (no `scripts/archipelago.ts`)
can't serve map live, so `promote` and `rollback` refuse one.

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

## Maps by name

Live above is one map served by name; dev is tied to its checkout and fixed
ports. Any map can be served by name, so any number of servers run side by
side and none of them clash: a dev checkout, a fresh clone, a session's
worktree testing a plugin.

```
npm run map -- serve                  # this checkout's code, a map named after its branch, any free port
npm run map -- serve --map try --from live   # a named map, copied from another on its first start
npm run map -- up --map live          # detached: outlives the terminal or preview that started it
npm run map -- ls                     # every server: map, port, commit, checkout, the folders that report to it
npm run map -- down try
npm run map -- go                     # jump in: live running, the folder you are in connected, its page open
```

`npm link` in a clone puts all of this on the PATH as `archipelago`
([bin/archipelago.mjs](../bin/archipelago.mjs)): `archipelago ls`,
`archipelago down try`, and `archipelago` alone for `go`.

| Piece | Is | Kept in |
|---|---|---|
| Code | a checkout at a commit, holding no data | wherever it is cloned |
| Map | a named data folder | `~/.archipelago/maps/<name>/` (`ARCHIPELAGO_HOME`) |
| Server | one code serving one map, on any free port | `~/.archipelago/servers/<name>.json` while it runs |
| Connection | "this folder reports to map *name*", never a port | the folder's `.claude/settings.local.json` and `.mcp.json` |

- A second server for a map that runs is refused, naming the one that does.
- With no `--map`, the map is named after the branch (`claude/x` is
  `claude-x`) and starts as a copy of `live` when a map of that name exists.
  `--from` takes another map's name (a copy) or a data folder, such as an
  older live's `../archipelago-live/app/.data` (moved in: that server's
  connected folders come with it, and report to the new map).
- A folder reports to one map. A map copied from live leaves live's
  connected folders to live, and `connect.here` refuses a folder whose files
  name another map, naming it ([plugins/connect](../plugins/connect/README.md),
  "One map per folder").
- The `map` command runs from a checkout that has it (current `main`, or
  the live worktree): an older checkout answers "Missing script: map".
- A folder connected from such a map's page (`connect.here`) reports to it by
  name: its hooks run `plugins/claude-code/hook.ts --map <name>` and its MCP
  server is `plugins/claude-code/proxy.ts <name>`, which find the map in the
  registry on each call. A session follows the map to a new port, and does
  nothing while the map is down; its files stay when the server stops.
- The page's header says which map, commit and checkout it is
  ([plugins/serving](../plugins/serving/README.md)).
