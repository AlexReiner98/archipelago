# profile

Not every node fits every run. Business rules, CAD skills and one repo's
UI rules are kept, but said only in the runs they fit. A profile names
which runs those are, and which nodes they hear. Types: [profile.ts](profile.ts).

Edition 5 (Alex, 20 Nov 2026). The spec owns the read side only, so the
pack that keeps profiles can be replaced. What a profile is on the map,
how it matches and how it holds nodes are that pack's.

## Capability

| Key | Gives |
|---|---|
| `profile.read` | Which profiles a run is in, whether it hears a node, what a profile holds |

- `of(run)`: the profiles a run is in, read from its [facts](agent.md#facts):
  those it matches (`by: match`), then what each is part of (`by: part`).
- `hears(run, node)`: whether the run hears the node, and why not. A node
  in no profile is heard by every run.
- `nodes(profile)`: the nodes loaded now that a profile holds, and those it
  takes out.
- `watch(on)`: profiles or their members changed.

## Who uses it

Effects belong to other packs; the profile pack never knows what they do
with a profile.

- The profile pack's own [gate](agent.md#gates) holds a node back from a
  run that doesn't hear it.
- The written pack writes a profile's skill or memory files into the
  folders of the runs that hear them, not the home folder.
- The harness view shows a run's profiles; the reflex tree, a profile's
  nodes.
