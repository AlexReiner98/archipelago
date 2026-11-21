# profile

Which runs a node is for. Business rules, CAD skills and one repository's
UI rules are kept, but said only in the runs they fit. Provides
`profile.read` ([spec/profile.md](../../spec/profile.md)) and a gate
([spec/agent.md](../../spec/agent.md#gates)). The rules are in
[model.ts](model.ts).

## On the map

| | |
|---|---|
| `profile` | A base: `shadow` (the first: only records), `on` (holds), closed `off`. Fields `match`, `members` |
| `in_profile` | A node item → the profile that holds it |
| `out_of_profile` | A node item → a profile it is taken out of |
| `uses` | An item → a profile: runs with that item in their facts (a repo, a hub) are in it |
| `part_of` | A profile → a larger one: a run in the part is in the whole |

`members` is a find-line over nodes: `at:file:packs/**`, `at:skill:rhino*`,
`kind:`, `pack:`, words in the title. `match` is a find-line over a run's
facts (`remote:github.com/a/*`), an optional extra. Same key: any; different
keys: all.

## Rules

Decided (20 Nov 2026, all five):

- A run is in a profile when one of its fact values is an item `uses`
  links to it (the git pack's `repo`, the hub pack's `hub`), or the
  profile itself (the `run` tool's `profiles`). `profiles_drop` takes one out.
- A node in no profile is heard by every run, and a run in no profile hears
  every node (fail open).
- A run hears a node held by a profile it is in; an exclusion in one of its
  profiles wins.
- A profile in `shadow` holds nothing: the gate's hold is a trial, recorded
  as a `gated` event with `trial`, and the node is still said.
- A miss in a run, at a place a held node listens at, is told on the
  profiles (`profile.missed`: a finding about them and the node).

Injects `graph.read`, `graph.watch`, `types.define`, `agent.tree`,
`agent.gate`, `exchange.watch`, `action.register`, `action.invoke`.
