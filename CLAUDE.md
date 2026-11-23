# Working on Archipelago with an agent

This file is read by Claude Code (and is a fair guide for any contributor,
human or agent) when working in this repository. The
[guide](guide/README.md) explains the ideas; this is how changes are made.

## How it is built

- The kernel is the Cordis runtime and its loader, on the server and in the
  browser. Everything else is a pack at the same level: the graph, the schema,
  the history, the UI, the learning loop.
- The spec ([spec/](spec/README.md)) owns the interfaces packs talk through,
  and versions them. Any pack can be replaced; an interface cannot be changed
  silently.
- No human gates. Every change applies, and anything can be undone.
- No sandbox. Installing a pack means trusting it.
- History is a journal pack. Each change set is written in full (actor,
  authority, pack, reason, and its facts as `[op, id, field, value]`), and
  undo applies its inverse. The graph is the truth: nothing is rebuilt from
  the journal.
- No pack owns a part of the data. A grouping is a link or a query.
- This repository holds everything one person needs on their own machine, a
  basic map UI included.
- Nothing private is ever committed: no tokens, no local paths, no personal
  names, and no one's own content such as skills, memory or map data. Data
  stays in the ignored `.data/` folder. Tests use neutral fixtures
  (`C:\Users\me`, `/home/me`, `pat@example.org`).

## Rules

- Every change goes through a declared action, whether a person or an agent
  makes it. A UI never writes directly.
- A pack's effects are revertible: when it unloads, everything it registered
  goes.
- Keep it small. A new idea becomes a pack, not kernel code.
- The spec is the contract between packs, and it is versioned. A change to
  it is discussed first (in an issue) and says which capability and edition
  it changes.
- A pack's code comes with its tests, in `test/<pack>.test.ts`: input in,
  what it records or answers out.
- Every read of the graph or the exchange is bounded: ids given, or a page
  with a limit and a cursor (`LIMIT_MAX` in `spec/graph.ts`).
- Docs change in the same commit as the code: the pack's README, the
  interface's `spec/<name>.md`, and `spec/README.md` when the list changes.
- A feature ships with the UI that shows it working.

## Checking a change

- `npm run check` (TypeScript, no emit) passes before you finish.
- Run the tests you touched, `node --test test/<pack>.test.ts`, and the
  whole set (`npm test`) before a pull request.
- To see a change in the browser, `npm run serve` and open
  http://127.0.0.1:5280/app/. Node runs the TypeScript directly: there is no build.
