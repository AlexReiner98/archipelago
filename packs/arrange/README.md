# arrange

The Landscape arranged into a context profile's tree: the map's own items
are seen making the tree a run in that profile hears. Type
`profile:<title>` on the find line (underscores for spaces,
`profile:Map_habits`).

This pack asks `profile.read` which nodes a run in only that profile hears,
lays them out as the Context interface does (`treeOf` and `radial` from
[packs/harness/layout.ts](../harness/layout.ts)), and sets the page key
`arrange.tree` ([arrange.ts](arrange.ts)):

| Field | Holds |
|---|---|
| `profile` | The profile's title |
| `items` | Each item on the map the tree holds (by a node's `source`), and its place |
| `wires` | Every branch, root first, as points |
| `boughs` | Each bough (a place, a channel, a folder) and its name |
| `ghosts` | Nodes no item on the map holds, and their names |

The Landscape ([field](../field/README.md)) keeps only those items, pulls
each to its place with its `tree` behaviour, and draws the branches and
names under them as they arrive. With no profile named, the key is cleared
and the Landscape is itself again. A map change that leaves the tree the
same sets nothing.

Only items the Landscape shows can fly into the tree. Items it doesn't show
(today, the words pack's `node` items, an undeclared type) stay ghosts.

Injects `find.index`, `here.read`, `here.set`, `here.declare`,
`agent.tree` and `profile.read`.
