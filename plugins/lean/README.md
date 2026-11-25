# lean

A profile can also hold back what Claude Code gives its runs: the MCP
servers and tools none of them use. What it would leave out is computed
and shown always ([harness](../harness/README.md): a given node's pane, and
a shadow's mark on the tree). It is written into the settings Claude Code
reads only when the profile is on and the server writes.

## What it leaves out ([plan.ts](plan.ts))

From `used.tools` over the profile's runs ([used](../used/README.md)):

- each MCP server none of them used, then each tool none used that isn't
  a server's already left out;
- nothing until the profile has 5 runs counted (`MIN_RUNS`);
- never `Read`, `Edit`, `Write`, `Bash`, `PowerShell`, `Glob`, `Grep`,
  `ToolSearch`, `Skill`, `Agent`, Claude Code's `DeferredToolPlaceholder`,
  or the map's own `archipelago` server (`KEEP_TOOLS`, `KEEP_SERVERS`).

## Actions

| Action | Input | Does |
|---|---|---|
| `lean.plan` | `profile?`, `run?` (each profile it is in) | Per profile: runs counted, `enough`, `leave` (`name`, `given`, `size`), `letters`, and `set`, what it leaves out now. Read only |
| `lean.set` | `profile`, `leave?` | Records what it leaves out on its `leave_out` field ([profile](../profile/README.md)): the plan as it is now, or the names given; `[]` leaves nothing out. A change set: `history.undo` takes it back |
| `lean-write.status` | | Files and entries written now, no paths. Only while the writer is loaded |

## Writing it ([write.ts](write.ts))

The writer (`lean-write`) is loaded only when the server writes (not with
`--no-write`, as the written plugin). For each profile that is on, what its
`leave_out` holds goes into `<cwd>/.claude/settings.local.json` of its
runs (the newest 50):

| Left out | Written |
|---|---|
| `tool:<name>` | `permissions.deny`: `<name>` |
| `mcp:<server>` | `permissions.deny`: `mcp__<server>`; `disabledMcpjsonServers`: `<server>` |

- **Only the run's project folder.** Never the home folder, a folder above
  it, anything under `~/.claude`, a drive's root, or a folder that isn't
  there; never the user's own settings.
- **A shared folder** gets only what every run there leaves out: a run in
  a profile that leaves nothing out, or in none, keeps everything.
- **Only its own.** An entry the file had is never taken out; a file it
  made goes when nothing else is in it. A file that isn't a JSON object is
  left alone and reported.
- **Revertible.** Undoing the `lean.set`, or the profile going off, takes
  its entries out at the next pass; unloading takes them all out. What it
  added is kept in a ledger (config `ledger`, a file in the data
  folder), so a crash is mended at the next load.

Injects `graph.read`, `exchange.read`, `profile.read`, `action.register`
(lean) and `graph.watch`, `exchange.watch` (the writer). Tested in
`test/lean.test.ts`.
