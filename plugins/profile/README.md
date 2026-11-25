# profile

Which runs a node is for. Business rules, CAD skills and one repository's
UI rules are kept, but said only in the runs they fit. Provides
`profile.read` ([spec/profile.md](../../spec/profile.md)) and a gate
([spec/agent.md](../../spec/agent.md#gates)). The rules are in
[model.ts](model.ts).

## On the map

On the map a profile is a **context filter** (since 23 Nov 2026): what a run
senses of the map. The plugin, its actions and `profile.read` keep the name
profile, as the harness plugin kept its own.

| | |
|---|---|
| `context_filter` | A base: `shadow` (the first: only records), `on` (holds), closed `off`. Fields `match`, `members`, `fallback`, `strict` (not set or true: its runs hear only what it holds of the map; `false`: open), `leave_out` (what Claude Code is to leave out of its runs: the [lean](../lean/README.md) plugin's), `budget_ratio` (spend over estimate past which its runs are asked once: the [budget](../budget/README.md) plugin's) |
| `in_context_filter` | Any item → the context filter that holds it. With places, the link is said there itself (below) |
| `out_of_context_filter` | An item → a context filter it is taken out of |
| `uses` | An item → a context filter: runs with that item in their facts (a repo, a hub) are in it |
| `part_of` | A context filter → a larger one: a run in the part is in the whole |

### Said through its link

Any item, of any type, is context by query: `members` holds what its line
finds. An `in_context_filter` link can also say how the item is activated, in its
own fields: `at` (the places: `tool:Bash`, `file:plugins/**`,
`session_start`), `kind` (how it is said here: `instruction` is standing,
said first at `session_start`; absent, what the item is), `when`, `refuse`, `say` (`listed` or `whole`), `repeat`
(`every`), `trial` and `retired`. A link with places is a node of its own
(the [words](../words/README.md) plugin's), whose source is the link, and
this context filter alone holds it: one item can be said at different places in
different context filters. Retiring it there (`retired: true`, or unlinking) leaves
the item as it is.

### Renamed on load

`profile.rename` gives every item of type `profile`, `in_profile`,
`out_of_profile`, `umwelt`, `in_umwelt` or `out_of_umwelt` its new type, up to 500 of each per change set. The plugin
runs it on load while any are left, on its own authority; `history.undo`
takes a change set back.

`members` is a find-line over nodes: `at:file:plugins/**`, `at:skill:rhino*`,
`kind:`, `plugin:` (`pack:` in a line saved before spec edition 11 reads
the same), words in the title. `match` is a find-line over a run's
facts (`remote:github.com/a/*`), an optional extra. Same key: any; different
keys: all.

## Rules

Decided (20 Nov 2026, all five):

- A run is in a profile when one of its fact values is an item `uses`
  links to it (the git plugin's `repo`, the hub plugin's `hub`), or the
  profile itself (the `run` tool's `profiles`). `profiles_drop` takes one out.
- A node in no profile is heard by every run, and a run in no profile hears
  every node (fail open).
- Changed 24 Nov 2026 (the owner): a saved profile is **strict** unless its
  item says `strict: false`. A run in a strict profile hears only what its
  profiles hold of the map: a node of the map's (the words plugin's) that no
  profile holds is held back from it, a `gated` event saying "Not held by
  <profile>, which gives its runs only what it holds". The nodes the plugins
  make in code (the map tools, the learning loop's ask, what changed since
  heard) still reach it. The fallback is strict too. An open profile
  (`strict: false`) keeps the old rule: what no profile holds is every
  run's.
- A profile with `fallback: true` is the workspace's default: a run that no
  profile places is in it, and in what it is part of. A run something else
  places isn't, and dropping it (`profiles_drop`) leaves the run failing open.
- A run hears a node held by a profile it is in; an exclusion in one of its
  profiles wins.
- A profile in `shadow` holds nothing: the gate's hold is a trial, recorded
  as a `gated` event with `trial`, and the node is still said.
- A miss in a run, at a place a held node listens at, is told on the
  profiles (`profile.missed`: a finding about them and the node). Not in
  a replay (a run with `replay_of`, the [replay](../replay/README.md)
  plugin's): its misses were told about in the recorded run.

## Moving a run

`profile.place {run, profile}` puts a run in one profile: it begins the
run again with `profiles` naming it and `profiles_drop` every other
profile the run matches now (earlier drops kept), as the `run` tool's
`profiles` and `drop` would. The Context interface calls it from an agent's
profile. A run's facts are on the exchange, not the graph, so it writes no
change set: to undo, place the run back (its output gives `was`).

Injects `graph.read`, `graph.watch`, `types.define`, `agent.tree`,
`agent.gate`, `agent.run`, `exchange.read`, `exchange.watch`,
`action.register`, `action.invoke`.
