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

## Rules

- Every change goes through a declared action, whether a person or an agent
  makes it. A UI never writes directly.
- A pack's effects are revertible: when it unloads, everything it registered
  goes.
- Keep it small. A new idea becomes a pack, not kernel code.
