# profile

Which runs a node is for. Business rules, CAD skills and one repository's
UI rules are kept, but said only in the runs they fit. Provides
`profile.read` ([spec/profile.md](../../spec/profile.md)) and a gate
([spec/agent.md](../../spec/agent.md#gates)). The rules are in
[model.ts](model.ts).

## On the map

On the map a profile is an **umwelt** (Alex, 23 Nov 2026): what a run
senses of the map. The pack, its actions and `profile.read` keep the name
profile, as the harness pack kept its own.

| | |
|---|---|
| `umwelt` | A base: `shadow` (the first: only records), `on` (holds), closed `off`. Fields `match`, `members`, `fallback`, `leave_out` (what Claude Code is to leave out of its runs: the [lean](../lean/README.md) pack's) |
| `in_umwelt` | Any item → the umwelt that holds it. With places, the link is said there itself (below) |
| `out_of_umwelt` | An item → an umwelt it is taken out of |
| `uses` | An item → an umwelt: runs with that item in their facts (a repo, a hub) are in it |
| `part_of` | An umwelt → a larger one: a run in the part is in the whole |

### Said through its link

Any item, of any type, is context by query: `members` holds what its line
finds. An `in_umwelt` link can also say how the item is activated, in its
own fields: `at` (the places: `tool:Bash`, `file:packs/**`,
`session_start`), `kind` (how it is said here: `instruction` is standing,
said first at `session_start`; absent, what the item is), `when`, `refuse`, `say` (`listed` or `whole`), `repeat`
(`every`), `trial` and `retired`. A link with places is a node of its own
(the [words](../words/README.md) pack's), whose source is the link, and
this umwelt alone holds it: one item can be said at different places in
different umwelts. Retiring it there (`retired: true`, or unlinking) leaves
the item as it is.

### Renamed on load

`profile.umwelt` gives every item of type `profile`, `in_profile` or
`out_of_profile` its new type, up to 500 of each per change set. The pack
runs it on load while any are left, on Alex's authority; `history.undo`
takes a change set back.

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
- A profile with `fallback: true` is the workspace's default: a run that no
  profile places is in it, and in what it is part of. A run something else
  places isn't, and dropping it (`profiles_drop`) leaves the run failing open.
- A run hears a node held by a profile it is in; an exclusion in one of its
  profiles wins.
- A profile in `shadow` holds nothing: the gate's hold is a trial, recorded
  as a `gated` event with `trial`, and the node is still said.
- A miss in a run, at a place a held node listens at, is told on the
  profiles (`profile.missed`: a finding about them and the node).

## Moving a run

`profile.place {run, profile}` puts a run in one profile: it begins the
run again with `profiles` naming it and `profiles_drop` every other
profile the run matches now (earlier drops kept), as the `run` tool's
`profiles` and `drop` would. The Sensory interface calls it from an agent's
profile. A run's facts are on the exchange, not the graph, so it writes no
change set: to undo, place the run back (its output gives `was`).

Injects `graph.read`, `graph.watch`, `types.define`, `agent.tree`,
`agent.gate`, `agent.run`, `exchange.read`, `exchange.watch`,
`action.register`, `action.invoke`.
