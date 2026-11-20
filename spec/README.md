# The spec

The interfaces packs talk through. Any pack can be replaced; these can't
be changed silently. Each one is a TypeScript module (the types) and a short
doc. Both are versioned together.

| Contract | Version | What it is |
|---|---|---|
| [agent](agent.md) | 0.1.0 | Say, refuse, act. Places, nodes, runs |
| [exchange](exchange.md) | 0.1.0 | The event for each say, refusal and act, and the stream of them |
| [changeset](changeset.md) | 0.1.0 | A change in full: header and facts `[op, id, field, value]` |
| [graph](graph.md) | 0.1.0 | Bounded reads, live watch, the write chain |
| [action](action.md) | 0.1.0 | The one way anyone changes anything |
| [slot](slot.md) | 0.1.0 | UI composition: places in the UI that packs fill |
| [here](here.md) | 0.1.0 | Shared ephemeral state: what is being looked at, now |

[common.ts](common.ts) holds the words they share (ids, actors, authority,
pages, refusals, `Dispose`).

Every version is 0.x: these are drafts while Alex shapes them. Two choices
are open on the map, not decided here: the renderer behind `slot`, and the
place vocabulary in `agent`.

## How they sit on the runtime

The kernel is the Cordis runtime and its loader. A contract is a **service**
in Cordis's sense: an interface behind a key in the context. A pack that
implements it provides the key; a pack that uses it lists the key in its
`inject`. When the provider leaves, its consumers go inactive and come back
when a provider returns. Nothing here assumes which pack provides what.

Every call that adds something to the system (a node, an action, a watcher,
a write stage, a slot fill, a `here` key) returns a `Dispose`. The runtime
makes each one a Cordis effect of the calling pack, so unloading the pack
takes back everything it registered. That is the rule "a pack's effects are
revertible", made concrete.

Services that many packs contribute to (the agent's nodes, the actions, the
write chain, the slots) are **brokers** (Cordis §6.2): contributors register
through the broker and consumers never reload when one comes or goes.

Calls that may cross a process are async.

## Versions

Cordis matches services by key name only and leaves versioning open
(§6.6). The spec adds it, as follows.

- Each contract has a semver version, exported as `contract` from its
  module.
- **Patch**: the doc changed, the types didn't.
- **Minor**: something was added that old consumers can ignore: an optional
  field, a new place, a new event kind, a new optional method. Old
  providers still satisfy new consumers that don't use the addition.
- **Major**: anything else. Renaming, removing, narrowing, or changing what
  a field means.
- A provider registers under `name@major` (for example `graph@1`), and says
  its exact version. Two majors can be provided side by side, so a pack can
  move across a break at its own pace.
- A consumer declares a range (`graph: ^1.2`). The loader checks it when the
  consumer loads. A consumer whose range isn't met **stays inactive**, as it
  would with a missing dependency, and the loader says why. It never runs
  against a version it didn't ask for.
- While a contract is 0.x, each minor counts as a major (`^0.1` means
  `0.1.x`), as in npm.
- Changing a contract is a commit to this folder that changes the version.
  A change to the types without a version change is a bug.
