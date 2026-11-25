# The spec

The interfaces packs talk through. Any pack can be replaced; these can't
be changed silently. Each contract is a TypeScript module (the types) and a
short doc.

<!-- contracts: written by scripts/contracts.ts from the spec -->
This is **edition 11**. A capability that came after edition 1 shows the edition it came in.

| Contract | Capabilities | What it is |
|---|---|---|
| [graph](graph.md) | `graph.read` `graph.watch` `graph.stage` `graph.commit` | The graph pack stores items and links and is the truth. |
| [action](action.md) | `action.register` `action.list` `action.invoke` `action.attest` (11) | Every change goes through a declared action, whether a person or an agent makes it. |
| [agent](agent.md) | `agent.node` `agent.tree` `agent.run` `agent.facts` (5) `agent.gate` (5) | Everything the map says to an agent and everything the agent does passes through one service. |
| [exchange](exchange.md) | `exchange.append` `exchange.read` `exchange.watch` | One event for each thing that passes between the map and an agent. |
| [slot](slot.md) | `slot.declare` `slot.fill` `slot.read` `slot.arrange` (8) | How the UI is put together out of packs. |
| [scene](scene.md) | `layout.region` `scene.layer` `scene.view` | How large graphs are drawn. |
| [here](here.md) | `here.declare` `here.read` `here.set` | What is being looked at, now. |
| [types](types.md) | `types.define` `types.read` `types.mark` (10) `types.acyclic` (11) | What kinds of item and link the map holds. |
| [profile](profile.md) | `profile.read` (5) | Not every node fits every run. |
| [loader](loader.md) | `loader.tree` (7) | The config tree as a capability. |
| [changeset](changeset.md) | (a format) | A change, written in full. |
| [frame](frame.md) | (a format) | The page around the canvas. |
| [style](style.md) | (a format) | The look every view shares. |

<!-- /contracts -->

[common.ts](common.ts) holds the shared words; [index.ts](index.ts) puts
every capability's key and type in one map for a runtime to declare.

Decided: panels are Preact, the graph is one WebGL2 scene
surface, and the spec owns the six places of edition 1 and edition 2's
`skill:` and `memory:`, where the map speaks through the files it writes.
Edition 3 adds the place `compact` and the person's acts, `decision` and
`notice` ([agent](agent.md)). Edition 4 says a node's same words once per
context (`repeat`, `again`). Edition 5 adds a run's facts and gates
([agent](agent.md)), and the read side of profiles ([profile](profile.md)). Edition 11 adds
`types.acyclic`, kinds of link a pack holds acyclic, which the schema pack
keeps from closing a loop ([types](types.md)), and `action.attest`, a
change made on a test's word at the version of its inputs
([action](action.md)), an `action.input` refusal that says how to fix
the input, a fix per path and the input fixed (`InputRefusal`,
[action](action.md)), and a person's `decision` on a run's reply, at
`reply_end`, with the facts `item` and `version` a call follows
([agent](agent.md)), and a strict profile: `profile.read`'s `hears`
holds back from its runs a node no profile holds ([profile](profile.md)). Edition 10 adds
`types.mark`, the shape each base is drawn in, named by its pack, and two
mark shapes, pentagon and hexagon ([types](types.md), [style](style.md));
from it a contract's `Capabilities` map is frozen one key at a time, as its
list is. Edition 9 adds the style token `harness`, the colour of what the
harness gave an agent rather than the map ([style](style.md)). Edition 8 adds `slot.arrange`, an arrange laid over the
page's while a pack holds it, so a view moves fills without a reload
([slot](slot.md)).

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

## What the spec asks of the runtime

Three things, all of them plain Cordis:

1. **Registrations are the caller's effects.** Whatever a pack adds
   through a capability goes when the pack unloads.
2. **Providers know their caller from its context.** A provider reads the
   calling pack, and the actor and run where interception set them
   (`Caller` in common.ts). No call takes "who I am" as an argument, so no
   pack can claim to be another or speak for a person. Sign-in intercepts
   a person's page with them as actor; the harness adapter makes one child
   context per run with the agent and the run.
3. **The config tree orders everything.** Where contributions need an order
   (write stages, nodes' words, slot fills), it is the contributing packs'
   order in the config tree (`byPosition`), then the order each pack
   registered in. There are no ranks or priorities: reordering is moving
   an entry, and a `one` slot shows the first fill.

`here` is the one place the spec leaves the Cordis way on purpose: see
[here](here.md).

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
- Editions 1 to 10 are accepted (edition 1 on 20 Nov 2026, up to 9 on
  23 Nov 2026, the first public release, and 10 the same day): their capabilities' meanings are
  fixed. `ACCEPTED` in common.ts says up to which edition.
- A test holds it: `test/spec-frozen.test.ts` compares every accepted
  type, capability and term with `test/spec-frozen.json` and fails on any
  change. Accepting an edition (`node scripts/spec-surface.ts --accept`)
  adds what it brought and never rewrites what is there.

Cordis links by key alone and leaves versioning open (§6.6). It names two
problems: drift (a key's interface changing under a consumer) and
collision (two meanings for one key). Fixed meanings answer drift. The spec
owning every key in its namespaces answers collision; a pack's own keys
start with its id.
