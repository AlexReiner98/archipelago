# profile

Not every node fits every run. Business rules, CAD skills and one repo's
UI rules are kept, but said only in the runs they fit. A profile names
which runs those are, and which nodes they hear. Types: [profile.ts](profile.ts).

Edition 5 (20 Nov 2026); `profile.hears` edition 11 (25 Nov 2026). The spec owns the read side only, so the
plugin that keeps profiles can be replaced. What a profile is on the map,
how it matches and how it holds nodes are that plugin's.

## Capability

| Key | Gives |
|---|---|
| `profile.read` | Which profiles a run is in, whether it hears a node, what a profile holds |
| `profile.hears` (11) | Whether a run hears a node, a strict profile giving its runs only what it holds |

- `of(run)`: the profiles a run is in, read from its [facts](agent.md#facts):
  those it matches (`by: match`), then what each is part of (`by: part`).
- `hears(run, node)`: whether the run hears the node, and why not. A node
  in no profile is heard by every run.
- `nodes(profile)`: the nodes loaded now that a profile holds, and those it
  takes out.
- `watch(on)`: profiles or their members changed.

`profile.hears` (edition 11) has one call, `hears(run, node)`, as
`profile.read`'s except that a strict profile gives its runs only what it
holds: a node in no profile is held back from a run in a strict profile.
The plugin decides which profiles are strict, and which nodes are the map's
to hold back. It is a capability of its own, not a change to `profile.read`,
because edition 5 promised that a node in no profile is every run's; a
plugin that relied on that keeps it.

## Who uses it

Effects belong to other plugins; the profile plugin never knows what they do
with a profile.

- The profile plugin's own [gate](agent.md#gates) holds a node back from a
  run that doesn't hear it, strict profiles counted.
- The written plugin writes a profile's skill or memory files into the
  folders of the runs that hear them, not the home folder.
- The harness view shows the profiles a run is in, each live agent's
  profile under it, and over its tree what any one profile holds back
  (`profile.hears` for a run in only that profile).
