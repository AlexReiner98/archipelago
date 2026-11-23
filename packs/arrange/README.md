# arrange

The Landscape arranged into an umwelt's tree: the map's own items are seen
making the tree a run in that umwelt hears. Type `umwelt:<title>` on the
find line (underscores for spaces, `umwelt:Map_habits`).

This pack asks `profile.read` which nodes a run in only that umwelt hears,
lays them out as the Context interface does (`treeOf` and `radial` from
[packs/harness/layout.ts](../harness/layout.ts)), and sets the page key
`arrange.tree` ([arrange.ts](arrange.ts)):

| Field | Holds |
|---|---|
| `profile` | The umwelt's title |
| `items` | Each item on the map the tree holds (a node's `source`, or the item its umwelt link brings), and its place |
| `wires` | Every branch, root first, as points |
| `boughs` | Each bough (a place, a channel, a folder) and its name |
| `ghosts` | Nodes no item on the map holds, and their names |

The Landscape ([field](../field/README.md)) keeps only those items, pulls
each to its place with its `tree` behaviour, and draws the branches and
names under them as they arrive. With no umwelt named, the key is cleared
and the Landscape is itself again. A map change that leaves the tree the
same sets nothing.

A node said through an `in_umwelt` link has the link as its source: the
item the link brings (its `from`) flies, read through `graph.read` in
bounded pages. Only items the Landscape shows can fly; the words pack's
`node` items (an undeclared type) stay ghosts.

Injects `find.index`, `here.read`, `here.set`, `here.declare`,
`agent.tree`, `profile.read` and `graph.read`.
