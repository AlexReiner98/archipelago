# arrange

The Landscape arranged into a context filter's tree: the map's own items are seen
making the tree a run in that context filter hears. Type `context:<title>` on the
find line (underscores for spaces, `context:Map_habits`).

This plugin asks `profile.hears` which nodes a run in only that context filter hears,
lays them out as the Context interface does (`treeOf` and `radial` from
[plugins/harness/layout.ts](../harness/layout.ts)), and sets the page key
`arrange.tree` ([arrange.ts](arrange.ts)):

| Field | Holds |
|---|---|
| `profile` | The context filter's title |
| `items` | Each item on the map the tree holds (a node's `source`, or the item its context filter link brings), and its place |
| `wires` | Every branch, root first, as points |
| `boughs` | Each bough (a place, a channel, a folder) and its name, with its placement as the context view places it (`label`: turn, along, across, anchor) |
| `ghosts` | Nodes no item on the map holds, and their names, placed the same way |
| `nameText` | The size the names were placed for, in the tree's units |
| `names` | Each item's name as the context view places it, for the tree to draw as the item lands |

The Landscape ([field](../field/README.md)) keeps only those items, pulls
each to its place with its `tree` behaviour, and draws the branches and
names under them as they arrive. With no context filter named, the key is cleared
and the Landscape is itself again. A map change that leaves the tree the
same sets nothing.

A node said through an `in_context_filter` link has the link as its source: the
item the link brings (its `from`) flies, read through `graph.read` in
bounded pages. Only items the Landscape shows can fly; the words plugin's
`node` items (an undeclared type) stay ghosts.

Injects `find.index`, `here.read`, `here.set`, `here.declare`,
`agent.tree`, `profile.read`, `profile.hears` and `graph.read`.
