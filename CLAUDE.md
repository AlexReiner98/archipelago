# Working on Archipelago with an agent

This file is read by Claude Code (and is a fair guide for any contributor,
human or agent) when working in this repository. The
[guide](guide/README.md) explains the ideas; this is how changes are made.

## How it is built

- The kernel is the Cordis runtime and its loader, on the server and in the
  browser. Everything else is a plugin at the same level: the graph, the schema,
  the history, the UI, the learning loop.
- The spec ([spec/](spec/README.md)) owns the interfaces plugins talk through,
  and versions them. Any plugin can be replaced; an interface cannot be changed
  silently.
- No human gates. Every change applies, and anything can be undone.
- No sandbox. Installing a plugin means trusting it.
- History is a journal plugin. Each change set is written in full (actor,
  authority, plugin, reason, and its facts as `[op, id, field, value]`), and
  undo applies its inverse. The graph is the truth: nothing is rebuilt from
  the journal.
- No plugin owns a part of the data. A grouping is a link or a query.
- This repository holds everything one person needs on their own machine, a
  basic map UI included.
- Nothing private is ever committed: no tokens, no local paths, no personal
  names, and no one's own content such as skills, memory or map data. Data
  stays in the ignored `.data/` folder. Tests use neutral fixtures
  (`C:\Users\me`, `/home/me`, `pat@example.org`).

## Rules

- Every change goes through a declared action, whether a person or an agent
  makes it. A UI never writes directly.
- A plugin's effects are revertible: when it unloads, everything it registered
  goes.
- Keep it small. A new idea becomes a plugin, not kernel code.
- The spec is the contract between plugins, and it is versioned. A change to
  it is discussed first (in an issue) and says which capability and edition
  it changes.
- A plugin's code comes with its tests, in `test/<plugin>.test.ts`: input in,
  what it records or answers out.
- Every read of the graph or the exchange is bounded: ids given, or a page
  with a limit and a cursor (`LIMIT_MAX` in `spec/graph.ts`).
- Docs change in the same commit as the code: the plugin's README, the
  interface's `spec/<name>.md`, and `spec/README.md` when the list changes.
- A feature ships with the UI that shows it working.

## Checking a change

- `npm run check` (TypeScript, no emit) passes before you finish.
- Run the tests you touched, `node --test test/<plugin>.test.ts`, and the
  whole set (`npm test`) before a pull request.
- To see a change in the browser, `npm run dev` (it writes no skill or
  memory file, so it never competes with a live server) and open
  http://127.0.0.1:5280/app/. Node runs the TypeScript directly: there is no build.
- When 5280 is taken (another checkout, a worktree), `npm run dev` says so
  in one line, and `npm run map -- serve`
  serves a map named after the branch, copied from `live` when there is one,
  on any free port, and prints where; `npm run map -- ls` lists every server
  ([guide](guide/live-and-dev.md), "Maps by name").

## Setting it up for someone

When a person asks you to set Archipelago up, or to run a map they will
keep, follow the README's "Set it up to keep":

- Ask them where their map should live, before anything is cloned: it is
  their choice, and the map is kept in that folder for as long as they keep
  it (the clone, and the live worktree beside it that serves map `live`,
  whose data is in `~/.archipelago/maps/live`). Offer a folder they already keep code in as an example; don't
  choose for them. Never set a map up in a folder that goes away: the
  system's temp folder, a folder an app made for your session (a scratch
  workspace), or a session's own worktree (`.claude/worktrees/`). If your
  session started in one, say so when you ask.
- `npm install`, `npm run live:setup`, `npm run live:start`; open the
  address it prints (any free port; `npm run live:status` says it again).
- Connect the clone, not the live worktree: `connect.here { folder: <the
  clone> }`, or the empty map's line. `connect.here` writes the folder's
  hooks and MCP server; to look first, `connect.folder` reads.
- Tell them to start their next session in the clone: that folder reports
  to the map, and your own session may not.
- Their own folders stay theirs: don't touch a server, branch or folder
  another session is using.
