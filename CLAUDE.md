# Working rules

Where the work stands is kept on the owner's Archipelago map, the Focus
workspace, on the island "Rebuild on Cordis" (hub e_3pneg4cc). Read the hub
and its decisions before starting. Don't keep a second plan in files.

## Decided

- The kernel is the Cordis runtime and its loader, on the server and in the
  browser. Everything else is a pack at the same level: the graph, the schema,
  the history, the UI, the learning loop.
- The spec owns the interfaces packs talk through, and versions them. Any
  pack can be replaced; an interface cannot be changed silently.
- No human gates. Every change applies, and anything can be undone.
- No sandbox. Installing a pack means trusting it; when hosted, each
  workspace runs in its own process.
- History is a journal pack. Each change set is written in full (actor,
  authority, pack, reason, and its facts as `[op, id, field, value]`), and
  undo applies its inverse. The graph is the truth: nothing is rebuilt from
  the journal.
- No pack owns a part of the data. A grouping is a link or a query.

## The first build

A live harness view for Claude Code. Every say, refusal and action passes
through the `agent` service and is recorded by `exchange`. A verdict per run
says whether each node worked. The UI shows the tree, the live run and the
node, linked to each other.

## What does not apply here

The map tells every session some of the owner's preferences at the start.
These are about the old repository and do not apply here:

- Start sessions from the main archipelago checkout
- Iterate before full tests (the old `npm test` sets and the structure test)
- Layouts judged by eye, and drawing controls in the panel (the old canvas)
- Cross-island via a published finding, and nothing held in Archipelago
- Live site edits without screenshots (archipelago.tools)

The rest still holds: no PRs mid-work, plans as flows, diagrams not text,
a feature ships with its UI, social prose is the owner's, and own runs for
builders.

## Rules

- Every change goes through a declared action, whether a person or an agent
  makes it. A UI never writes directly.
- A pack's effects are revertible: when it unloads, everything it registered
  goes.
- Keep it small. A new idea becomes a pack, not kernel code.
