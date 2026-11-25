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

- **The Context interface**: each Claude Code session, live or replayed, on
  the tree of what the map told it, where, by which plugin, and whether it
  worked.
- **Context filters**: an item on the map that decides what a session is
  told. A session joins one by its match rule, such as `cwd:*landing-page`.
- **Plans, decisions and rules**: kept as items and links you and your agents
  both read and change.

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
you there). The map is kept in `app/.data/`, which git ignores.

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
the agent the map's tools. Open **the Context interface** to watch the run
live, and give the session something to plan:

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
- A file outside it is written only once you put it on the map: a skill
  or memory file adopted onto the map is written from its words from then
  on (and goes back as it was when the plugin that writes it unloads), and
  a context filter's `leave_out` goes into its runs'
  `<folder>/.claude/settings.local.json`, and a folder connected from the
  page gets the map's hooks and MCP server in its `.claude/settings.local.json`
  and `.mcp.json`, kept out of git. Each is taken out again, leaving what
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

Early. The graph, its plugins and the **Context interface** for Claude Code
are the first build. More plugins follow in the open, each a new thing built
on the same map.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To change Archipelago itself while your
own sessions keep reporting to a stable copy, see
[Live and dev](guide/live-and-dev.md). Plugins are code that runs with the
server's rights, so only load plugins you trust; security reports go through
[SECURITY.md](SECURITY.md).

## Licence

MIT
