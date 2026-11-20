# The spec

The interfaces packs talk through. Any pack can be replaced; these can't
be changed silently. Each contract is a TypeScript module (the types) and a
short doc. This is **edition 1, in draft**, while Alex shapes it.

| Contract | Capabilities | What it is |
|---|---|---|
| [graph](graph.md) | `graph.read` `graph.watch` `graph.stage` `graph.commit` | Bounded reads, live watch, the write chain |
| [action](action.md) | `action.register` `action.list` `action.invoke` | The one way anyone changes anything |
| [agent](agent.md) | `agent.node` `agent.tree` `agent.run` | Say, refuse, act. Places, nodes, runs |
| [exchange](exchange.md) | `exchange.append` `exchange.read` `exchange.watch` | One event per say, refusal and act |
| [slot](slot.md) | `slot.declare` `slot.fill` `slot.read` | UI composition: places in the UI that packs fill |
| [here](here.md) | `here.declare` `here.read` `here.set` | Shared ephemeral state: what is being looked at |
| [changeset](changeset.md) | (a format) | A change in full: header and facts `[op, id, field, value]` |

[common.ts](common.ts) holds the shared words; [index.ts](index.ts) puts
every capability's key and type in one map for a runtime to declare.

Two choices are open on the map, not decided here: the renderer behind
`slot`, and the place vocabulary in `agent`.

## Packs ask for capabilities

The kernel is the Cordis runtime and its loader. A capability is one key
in the Cordis context and what it means. A pack lists the capabilities it
uses in its `inject`, and whichever pack provides each key right now
satisfies it. A pack never names another pack, or a version of one. That
is what lets packs come, go and be swapped while the system runs: a
consumer doesn't know or care which provider it got.

- A capability the pack didn't ask for, it doesn't get. Nothing in these
  contracts hands one out as a side door; an action or a node that reads
  the graph has its pack inject `graph.read`.
- When nothing provides a capability, the packs that need it stay inactive
  until something does. That's the only failure mode, and it isn't an error.
- Capabilities are fine-grained so a pack's `inject` says what it does,
  and so the orchestrator can narrow one per pack through Cordis
  interception without reloading anything. `graph.commit` should be given
  only to the action pack, and `exchange.append` only to the provider of
  `agent.run`.

Every call that adds something (a node, an action, a watcher, a stage, a
slot fill, a `here` key) returns a `Dispose`, and the runtime makes it an
effect of the calling pack, so unloading the pack takes back everything it
added. Capabilities many packs contribute to (nodes, actions, stages,
slots) are brokers in Cordis's sense (§6.2): contributors come and go
without consumers reloading.

Calls that may cross a process are async.

## The spec is versioned, packs aren't

The spec has editions: 1, 2, 3… Packs don't declare versions of anything.

- Once an edition is accepted, a capability's meaning is fixed for good.
  Nothing about it changes, so nothing can change silently under a pack.
- A change old users couldn't ignore is a **new capability with a new
  key**. The old one is retired in that edition, and may still be provided
  alongside the new one for as long as packs use it.
- An addition is also a new capability, not a widening of an old one. A
  pack that wants the addition asks for it, and a pack that doesn't is
  unaffected.
- Vocabularies (places, node kinds, event kinds) are open: an edition may
  add terms, each marked with the edition it came in, and every consumer
  ignores a term it doesn't know.
- Each capability says the edition it arrived in (`since`) and, if
  retired, the edition and what replaces it. The list is the spec's
  history.
- Until edition 1 is accepted, its capabilities can still be edited:
  nothing has been built on them yet.

Cordis links by key alone and leaves versioning open (§6.6). It names two
problems: drift (a key's interface changing under a consumer) and
collision (two meanings for one key). Fixed meanings answer drift. The spec
owning every key in its namespaces answers collision; a pack's own keys
start with its id.
