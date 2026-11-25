# exchange

One event for each thing that passes between the map and an agent. It's
what the harness view streams live and what the verdict plugin judges a run
by. Types: [exchange.ts](exchange.ts).

## Capabilities

| Key | Gives |
|---|---|
| `exchange.append` | Record an event (the provider of `agent.run` only) |
| `exchange.read` | Runs and events, bounded |
| `exchange.watch` | Events live |

## The event

| Field | |
|---|---|
| `run`, `seq` | which run, and its order in that run (from 1, no gaps) |
| `time` | when |
| `place` | where in the run (see [agent](agent.md)); absent for `begin`, `end`, and a miss about the run itself |
| `direction` | `to_agent` (the map spoke) or `from_agent` (the agent did) |
| `kind` | `begin`, `end`, `say`, `refuse`, `act`, `miss`; `compact` (edition 3); `gated` (edition 5, a gate held the node back) |
| `node` | the node that spoke |
| `plugin` | the plugin the node or action belongs to |
| `text` | what was said, the refusal's words, or the error |
| `act` | for `act`: kind, by, input, output, ok |

`miss` is a fault in the exchange itself (a node threw, or refused where it
couldn't), so it's told apart from the agent getting something wrong, which
is an `act` with `ok: false`.

## The service

- `append(event)`: the agent service records each event. It's the only
  caller.
- `runs(page)`, `events(run, page)`: the record, bounded like every read.
- `said(node, page)`: a node's events across runs, for the node's page.
- `watch(filter, on)`: live, by run, node, plugin or kind. Returns a
  disposer.

## Where the events live

The exchange plugin decides how it stores events. They're a record of what
passed, not items on the map, so they don't go through actions or the
journal. What the verdict plugin concludes from them (a verdict per run and
node) is written to the graph through an action like any other change.
