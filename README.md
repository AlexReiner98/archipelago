# Archipelago

**Sculpt the landscape around your agents:** build views into their world, so
you can decide how they plan, remember, and evolve.

<video src="guide/images/archipelago-intro.mp4" poster="guide/images/archipelago-intro.jpg" controls muted playsinline width="100%" title="Archipelago in 86 seconds: the Landscape, a context filter, a Claude Code session watched live in the context interface, its change undone, and a plugin switched off and back"></video>

## What it is

- **Landscape**: one shared memory for you and your agents, as a typed graph
  of the items and links you both add.
- **Context interface**: each agent session, live or replayed, on the tree of
  what the map tells it: what it was told, where, by which plugin, and
  whether it worked.
- **Context filter**: an item on the map that decides what a session is told.
  A session joins one by its match rule, such as `cwd:*landing-page`.
- **Plugins**: everything is one, so an agent can add views, features and
  types without knowing the whole codebase ([Concepts](guide/concepts.md)).
  Inspired by DeepSeek Harness.

## What it is for

- See what your agents are told, and change it.
- Keep their plans, decisions and rules on one map you can read.
- Keep what helps them, and retire what doesn't.
- Undo anything an agent or a plugin did.

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

In the same folder, start a session that reports to your map, without
touching your own settings:

```
claude --settings plugins/claude-code/settings.json --mcp-config plugins/claude-code/mcp.json
```

Its hooks report each prompt, tool call and answer, and its MCP server gives
the agent the map's tools. Open **the Context interface** to watch the run
live, and give the session something to plan:

> Plan the next release of this project on the map: each step an item,
> linked in the order they depend on each other.

The steps appear on the **Landscape** as the agent adds them.

To have every session report, a map with no run shows on the **Landscape**
the lines to copy into `~/.claude/settings.json`;
[First run](guide/first-run.md) has more.

## Your data

- Everything stays on your machine. The hooks post to your own server on
  `127.0.0.1`, and the server calls nothing outside it: no telemetry, no
  account.
- `npm run serve` writes only to `app/.data/`. Delete that folder and the
  map is gone.
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

Early. The first build is the **Context interface** for Claude Code sessions:
what is said to the agent, where it was said, by which plugin, and whether it
worked.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To change Archipelago itself while your
own sessions keep reporting to a stable copy, see
[Live and dev](guide/live-and-dev.md). Plugins are code that runs with the
server's rights, so only load plugins you trust; security reports go through
[SECURITY.md](SECURITY.md).

## Licence

MIT
