# The spec

The interfaces plugins talk through. Any plugin can be replaced; these can't
be changed silently. Each contract is a TypeScript module (the types) and a
short doc.

<!-- contracts: written by scripts/contracts.ts from the spec -->
This is **edition 11**. A capability that came after edition 1 shows the edition it came in.

| Contract | Capabilities | What it is |
|---|---|---|
| [graph](graph.md) | `graph.read` `graph.watch` `graph.stage` `graph.commit` | The graph plugin stores items and links. |
| [action](action.md) | `action.register` `action.list` `action.invoke` `action.attest` (11) | Every change goes through a declared action, whether a person or an agent makes it. |
| [agent](agent.md) | `agent.node` `agent.tree` `agent.run` `agent.facts` (5) `agent.gate` (5) | Everything the map says to an agent and everything the agent does passes through one service. |
| [exchange](exchange.md) | `exchange.append` `exchange.read` `exchange.watch` | One event for each thing that passes between the map and an agent. |
| [slot](slot.md) | `slot.declare` `slot.fill` `slot.read` `slot.arrange` (8) | How the UI is put together out of plugins. |
| [scene](scene.md) | `layout.region` `scene.layer` `scene.view` | How large graphs are drawn. |
| [here](here.md) | `here.declare` `here.read` `here.set` | What is being looked at, now. |
| [types](types.md) | `types.define` `types.read` `types.mark` (10) `types.acyclic` (11) | What kinds of item and link the map holds. |
| [profile](profile.md) | `profile.read` (5) `profile.hears` (11) | Not every node fits every run. |
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
`types.acyclic`, kinds of link a plugin holds acyclic, which the schema plugin
keeps from closing a loop ([types](types.md)), and `action.attest`, a
change made on a test's word at the version of its inputs
([action](action.md)), an `action.input` refusal that says how to fix
the input, a fix per path and the input fixed (`InputRefusal`,
[action](action.md)), and a person's `decision` on a run's reply, at
`reply_end`, with the facts `item` and `version` a call follows
([agent](agent.md)), and `profile.hears`, whether a run hears a node
when a strict profile gives its runs only what it holds; `profile.read`
keeps its edition 5 meaning ([profile](profile.md)).
Edition 11 also renames the word `pack` to `plugin` everywhere it is
spelt (`PluginId`, `PluginRef`, and the field `plugin` of `Caller`, the
change set `Header`, `Refusal`, `ActionInfo`, `NodeInfo`,
`ExchangeEvent` and `ExchangeFilter`, `Change`, `LoaderEntry` and
`LoaderStatus`, `FillInfo` and `slots()`, `TypeInfo` and `LinkInfo`),
its meaning unchanged (`RENAMED` in [common.ts](common.ts)). Edition 10 adds
`types.mark`, the shape each base is drawn in, named by its plugin, and two
mark shapes, pentagon and hexagon ([types](types.md), [style](style.md));
from it a contract's `Capabilities` map is frozen one key at a time, as its
list is. Edition 9 adds the style token `harness`, the colour of what the
harness gave an agent rather than the map ([style](style.md)). Edition 8 adds `slot.arrange`, an arrange laid over the
page's while a plugin holds it, so a view moves fills without a reload
([slot](slot.md)).

## Plugins ask for capabilities

The kernel is the Cordis runtime and its loader. A capability is one key
in the Cordis context and what it means. A plugin lists the capabilities it
uses in its `inject`, and whichever plugin provides each key right now
satisfies it. A plugin never names another plugin, or a version of one. That
is what lets plugins come, go and be swapped while the system runs: a
consumer doesn't know or care which provider it got.

- A capability the plugin didn't ask for, it doesn't get. Nothing in these
  contracts hands one out as a side door; an action or a node that reads
  the graph has its plugin inject `graph.read`.
- When nothing provides a capability, the plugins that need it stay inactive
  until something does. That's the only failure mode, and it isn't an error.
- Capabilities are fine-grained so a plugin's `inject` says what it does,
  and so the orchestrator can narrow one per plugin through Cordis
  interception without reloading anything. `graph.commit` should be given
  only to the action plugin, and `exchange.append` only to the provider of
  `agent.run`.

Every call that adds something (a node, an action, a watcher, a stage, a
slot fill, a `here` key) returns a `Dispose`, and the runtime makes it an
effect of the calling plugin, so unloading the plugin takes back everything it
added. Capabilities many plugins contribute to (nodes, actions, stages,
slots) are brokers in Cordis's sense (§6.2): contributors come and go
without consumers reloading.

Calls that may cross a process are async.

## What the spec asks of the runtime

Three things, all of them plain Cordis:

1. **Registrations are the caller's effects.** Whatever a plugin adds
   through a capability goes when the plugin unloads.
2. **Providers know their caller from its context.** A provider reads the
   calling plugin, and the actor and run where interception set them
   (`Caller` in common.ts). No call takes "who I am" as an argument, so no
   plugin can claim to be another or speak for a person. Sign-in intercepts
   a person's page with them as actor; the harness adapter makes one child
   context per run with the agent and the run.
3. **The config tree orders everything.** Where contributions need an order
   (write stages, nodes' words, slot fills), it is the contributing plugins'
   order in the config tree (`byPosition`), then the order each plugin
   registered in. There are no ranks or priorities: reordering is moving
   an entry, and a `one` slot shows the first fill.

`here` is the one place the spec leaves the Cordis way on purpose: see
[here](here.md).

## The spec is versioned, plugins aren't

The spec has editions: 1, 2, 3… Plugins don't declare versions of anything.

- Once an edition is accepted, a capability's meaning is fixed for good.
  Nothing about it changes, so nothing can change silently under a plugin.
- A change old users couldn't ignore is a **new capability with a new
  key**. The old one is retired in that edition, and may still be provided
  alongside the new one for as long as plugins use it.
- An addition is also a new capability, not a widening of an old one. A
  plugin that wants the addition asks for it, and a plugin that doesn't is
  unaffected.
- Vocabularies (places, node kinds, event kinds) are open: an edition may
  add terms, each marked with the edition it came in, and every consumer
  ignores a term it doesn't know.
- Each capability says the edition it arrived in (`since`) and, if
  retired, the edition and what replaces it. The list is the spec's
  history.
- A word can be renamed, meaning kept: `RENAMED` in common.ts says the
  word, what it reads now and the edition. Every accepted entry is read
  with the rename applied, so the rename is recorded, never silent, and
  the frozen entries stay as they were accepted.
- Editions 1 to 11 are accepted (edition 1 on 20 Nov 2026, up to 9 on
  23 Nov 2026, the first public release, 10 the same day, and 11 on
  25 Nov 2026): their capabilities' meanings are
  fixed. `ACCEPTED` in common.ts says up to which edition.
- A test holds it: `test/spec-frozen.test.ts` compares every accepted
  type, capability and term with `test/spec-frozen.json` and fails on any
  change. Accepting an edition (`node scripts/spec-surface.ts --accept`)
  adds what it brought and never rewrites what is there.

Cordis links by key alone and leaves versioning open (§6.6). It names two
problems: drift (a key's interface changing under a consumer) and
collision (two meanings for one key). Fixed meanings answer drift. The spec
owning every key in its namespaces answers collision; a plugin's own keys
start with its id.
