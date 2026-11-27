# Archipelago

**A typed knowledge graph that you and your agents share, and that you can
build on.** Declare the kinds of things your work is made of, and the views,
rules and tools that work with them are plugins on top.

https://github.com/user-attachments/assets/33d78d55-55c4-43cb-be13-d03aef9581a8

## What it is

- **The map**: one typed graph of items and links, the same for a person and
  an agent, drawn on the **Landscape**. Plugins declare the kinds of item and
  link ([types](spec/types.md)).
- **One way to change it**: every change, whoever makes it, goes through a
  declared action. History keeps each change set whole, and anything can be
  undone.
- **Agents use the same tools you do**: its MCP server gives an agent the
  map's actions and queries, and records what it was told and what it did.
- **Plugins all the way down**: the graph, the schema, history, views and the
  page itself are plugins, added and removed while it runs. An agent can add
  one without knowing the whole codebase ([Concepts](guide/concepts.md)).
  Inspired by DeepSeek Harness.

## What it is for

A base to build on: model a domain as types, then add the views and tools
that work on it. Each of these is a plugin on the same map:

- **Plans, decisions and rules**: kept as items and links you and your agents
  both read and change.
- **The shared plan**: agents working on one repository hold the files
  they write, and wait for each other, on the map.
- **The learning loop** ([archipelago-loop](https://github.com/AlexReiner98/archipelago-loop)), a plugin folder of its
  own: the Context interface (each Claude Code session, live or replayed, on
  the tree of what the map told it, where, and whether it worked), context
  filters that decide what a session is told, and the nodes that grow and
  retire from what worked.

More is coming over the next weeks, built on the map in the open.

## Quickstart

- [Node.js](https://nodejs.org/) 22.18 or later (it runs the TypeScript
  directly and keeps the map in `node:sqlite`; no build step).
- [Claude Code](https://docs.claude.com/en/docs/claude-code), to connect an
  agent to it.

```
git clone https://github.com/AlexReiner98/archipelago.git
cd archipelago
npm install
npm run serve
```

Open http://127.0.0.1:5280/app/ (or http://127.0.0.1:5280/, which sends
you there). The map is kept in `app/.data/`, which git ignores. If 5280 is
already taken, it says so in one line and starts nothing;
`npm run map -- serve` runs on free ports instead. That is enough to try
it; for a map you mean to keep, set it up as below.

## Set it up to keep

The live map is kept in `~/.archipelago/maps/live/`, and the code that
serves it in a worktree beside your clone, which is the folder your
sessions report from. Where the clone lives is your choice: clone into a
folder you keep, such as the one you keep code in. Not the system's temp
folder, a folder an app made for one session, or a Claude Code session's
own worktree (`.claude/worktrees/`): those go away with the session, and
the live code and the connected folder with them. `npm run serve` says so
when it starts in one (its map, in `app/.data/`, would go too), and
`live:setup` refuses one.

Then run the live copy, the one your sessions report to:

```
cd <the folder you chose>/archipelago
npm install
npm link                  # once: the archipelago command, from any folder
archipelago               # map live set up and running, this folder connected, its page open
```

`archipelago` is safe to run any time, from any folder you work in: it
sets live up and starts it only when needed, connects that folder, and
opens the page. After a restart, run it again. A connected session that
starts while live is down says so in one line. Its steps, one at a time:

```
npm run live:setup        # once: a worktree at main beside this one (../archipelago-live)
npm run live:start        # map live, detached: it outlives the terminal; also live:stop, live:status
```

Open the address `live:start` prints (any free port; `live:status` says it
again). Live runs a fixed commit with hot reload off, keeps its map in
`~/.archipelago/maps/live/`, outside any checkout, and offers to
connect the checkout you set it up from (this one, not its own worktree):
click **Connect Claude Code in archipelago** on the empty map. Sessions
started in that folder report to it from then on. Edit and test here
(`npm run dev` on 5280 never touches live), and move live to new code with
`npm run promote` ([Live and dev](guide/live-and-dev.md)).

**If an agent sets it up for you,** these are its steps: it asks you where
your map should live before it clones anything (your choice, not its),
never works in a folder that goes away, starts live, and connects that
folder with `connect.here { folder }` (the page's line does the same). A
session that began in a temporary folder then tells you to start your
next session in the clone, since it is the folder that reports to the map.

## Connect Claude Code

The empty map has one line: **Connect Claude Code in archipelago**. Click
it, then start a new Claude Code session in this folder, in a terminal or
the desktop app. Connecting is an item on the map: the history shows it,
undo takes it back, and **disconnect** beside it takes it out.

In a terminal you can instead start one session that writes nothing (the
way under `npm run dev`, which writes no files):

```
claude --settings plugins/claude-code/settings.json --mcp-config plugins/claude-code/mcp.json
```

Either way, its hooks report each prompt, tool call and answer, and its MCP server gives
the agent the map's tools. Activity shows the run live (with the
[learning loop](https://github.com/AlexReiner98/archipelago-loop) loaded, the Context interface shows what it was told
too). Give the session something to plan:

> Plan the next release of this project on the map: each step an item,
> linked in the order they depend on each other.

The steps appear on the **Landscape** as the agent adds them.

To have every session report, add the hooks to `~/.claude/settings.json`
and the MCP server to your user config
([plugins/claude-code](plugins/claude-code/README.md));
[First run](guide/first-run.md) has more.

## Your data

- Everything stays on your machine. The hooks post to your own server on
  `127.0.0.1`, and the server calls nothing outside it: no telemetry, no
  account.
- The map is kept in `app/.data/`. Delete that folder and the map is gone.
- A file outside it is written only once you put it on the map: a folder
  connected from the page gets the map's hooks and MCP server in its
  `.claude/settings.local.json` and `.mcp.json`, kept out of git (the
  [learning loop](https://github.com/AlexReiner98/archipelago-loop), when loaded, also writes the skill and memory
  files adopted onto the map, and what a context filter leaves out). Each is taken out again, leaving what
  was there, when it is undone or the server shuts down (Ctrl+C). `npm run dev` writes
  none of them.
- Connecting every session adds Archipelago's hooks to
  `~/.claude/settings.json` and its MCP server to Claude Code's user config,
  and keeps everything else in them.

## How it is built

- It gives each agent what it needs and the actions it can take, and records
  both, with everything the agent does.
- What works is kept. What doesn't is retired.
- Its types, rules, views and interface are plugins, added and removed while
  it runs, without residue.
- Every part sits behind a versioned contract ([spec/](spec/README.md)) and
  can be replaced.

One process ([app/server.ts](app/server.ts)) runs the server's plugins and the
page's dev server; the page's own plugins are in [app/boot.ts](app/boot.ts).
The [guide](guide/README.md) walks through the concepts and how to write a
plugin.

## Status

Early. The graph and its plugins are the first build; the **Context
interface** for Claude Code is in the [learning loop](https://github.com/AlexReiner98/archipelago-loop). More plugins follow in the open, each a new thing built
on the same map.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To change Archipelago itself while your
own sessions keep reporting to a stable copy, see
[Live and dev](guide/live-and-dev.md). Plugins are code that runs with the
server's rights, so only load plugins you trust; security reports go through
[SECURITY.md](SECURITY.md).

## Licence

MIT
