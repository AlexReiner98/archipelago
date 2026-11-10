# Archipelago

[![Tests](https://github.com/AlexReiner98/archipelago/actions/workflows/tests.yml/badge.svg?branch=main)](https://github.com/AlexReiner98/archipelago/actions/workflows/tests.yml)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/hero-dark.svg">
  <img alt="A living map of all your work: islands drawn in stacked rows, parting round the title and its line, from a chat to a structured model that keeps you, your team, and your agents on the same page." src="brand/hero-light.svg">
</picture>

**Agent memory for human brains: your agent's plans and decisions as a map you read, correct, share.**

*Early: built and used daily by its author; expect rough edges.*

AI is speeding up lots of tasks, but more speed is only helpful if you're
moving in the right direction. Making a map before you execute helps identify
risks and dependencies, and makes it easy to keep track as people and agents
work.

One shared map means anyone can pick up the work at any time, from anywhere.
Detailed history makes it possible to analyze how projects actually
developed, what was missed, and how to improve.

The site is [archipelago.tools](https://archipelago.tools/?ref=github).

## How it works

Archipelago is a small unopinionated core, the rest is yours to shape.

**People stay in control.** Agents do much of the work, and you decide what
needs your approval. Every change records the source of authority, and what
is applied can be undone. [You stay in charge](https://archipelago.tools/in-charge?ref=github)

**The log is the truth.** Every change is added to one log and never
rewritten. Undo, history, live updates and backups all read the same record.
[docs/log.md](docs/log.md)

**Everything is an item, every item has a type.** Every type extends one of
seven kinds. Because Archipelago is built around those kinds, what works on
the types we ship works just as well on a type you add.

**Plugin architecture.** Packs are where opinion enters the system. Create a
pack with the item types, link types, view styles, and features you need. A
type, view or rule of yours works like the ones that ship.
[Write a pack](https://archipelago.tools/write-a-pack?ref=github)

**One surface for people and agents.** You and your agents use the map
through the same tools. What an agent is told is kept on the map, where you
can read and change it. [The agent tools](https://archipelago.tools/tools?ref=github)

**One way to read.** A query is a filter, a walk and a limit, and a view is a
query with its layout. You and your agents read the same query.

## Host it yourself

Archipelago is one Node 24 server and a persistent disk, MIT licensed, with
everything included. The database is embedded; for a team, keep the maps on a
Postgres server instead. If you'd rather not run a server, the
[Quickstart](https://archipelago.tools/quickstart?ref=github) has it running for you in
about five minutes.

```bash
git clone https://github.com/AlexReiner98/archipelago.git
cd archipelago
npm install
npm start
```

Open `http://127.0.0.1:3100`, go to **Workspace** and type your name under
Owner. To look around first, `npm run demo` opens a map of Archipelago itself
on port 3200, its data kept apart.

## Connect your agent

Ask it:

> Install Archipelago from https://app.archipelago.tools/connect/install

Or paste one line in a terminal. On Windows (PowerShell):

```powershell
irm https://app.archipelago.tools/connect/install.ps1 | iex
```

On macOS or Linux:

```bash
curl -fsSL https://app.archipelago.tools/connect/install.sh | sh
```

It connects Claude Code, Codex and Cursor where it finds them, and opens your
browser once to sign in to your workspace on archipelago.tools (the
[Quickstart](https://archipelago.tools/quickstart?ref=github) makes one).
ChatGPT and Grok Bot are connected in their own apps; the
[install page](https://app.archipelago.tools/connect/install) says how. From
then on each session starts on your map, handed the open work the sessions
before it left there and why each piece needs attention. For a server of your
own, the same page is at `/connect/install` on it.

Then say:

> Put this project in Archipelago, with the three things I am working on as
> tasks, and tell me what you would do first.

Your tasks appear on the map right away. To take anything back, open
**Changes** and choose **Undo**. Any other MCP client works the map at
`/mcp` on the same server.

To keep the hooks and working rules in the project's own files instead, run
this in its folder with your server running:

```bash
node -e "fetch('http://127.0.0.1:3100/connect/setup.mjs').then(r=>r.text()).then(t=>import('data:text/javascript,'+encodeURIComponent(t)))"
```

It lists what it will write (`.mcp.json`, a few hooks, working rules in
`CLAUDE.md`) and asks first. Add ` -- --dry-run` to only see the list, or
` -- --remove` to take it out.

## Read on

- [Host it yourself](https://archipelago.tools/self-host?ref=github) and
  [Hosting](docs/reference.md#hosting): every setting and limit.
- [Reference](docs/reference.md): every screen, tool, view, setting and limit.
- [Agents held to the map](docs/agents.md): how an agent is told, checked and
  reconciled.
- [Packs](docs/packs.md): the manifest, key by key, and
  [docs/layouts.md](docs/layouts.md): layouts and the sandbox.
- [The log](docs/log.md): what is stored, and how everything else is read
  from it.
- [Glossary](docs/glossary.md): the one word for each idea.
- [CONTRIBUTING.md](CONTRIBUTING.md) to work on Archipelago itself. It is
  published as it is, with no promise of answers or fixes.
- [SECURITY.md](SECURITY.md) to report a security problem in private.

Copyright 2026 Aperture Design Tools Inc. [MIT License](LICENSE).
