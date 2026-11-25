# replay

A trial node is judged on past runs before it waits for live ones. The
[grow](../grow/README.md) plugin writes a trial node from a miss; the
[keep](../keep/README.md) plugin promotes it after 3 held runs. This plugin
finds recorded runs where the node's place came up, and plays each again
with the node said ([scripted](../scripted/README.md)'s `replay`), so the
[verdict](../verdict/README.md) plugin judges it there as it judges any run.

| Step | How |
|---|---|
| Which runs | The newest `scan` (default 50) recorded runs, replays left out. Not the run the node was written in (`from_run`), not a run it was already said in live, not one already replayed with it said. A run's place came up when one of its acts, or something said in it, stands at a place the node listens at; an act stands at its files too (`file_path`, `path`, `notebook_path`, relative to the run's folder). |
| How many | Up to `per` (default 3) replays a node, newest run first, one at a time. |
| When | As a trial node comes into the tree, and for those there when the plugin loads; `auto: false` waits to be asked. |
| Judged | Each replay is a run of its own, harness `scripted`, with the fact `replay_of`: its acts as they were recorded, the map asked again. The verdict plugin keeps its record apart (`verdict.read`'s `replayed`), and keep's rule table says how much one counts. |

A replay can't show the node preventing its miss: the agent's side is what
happened then, and it never heard the node. A miss that came after the node
would have been said is judged failed there, as the verdict plugin judges,
but keep counts a replayed failure toward nothing.

Plugins that answer to a run's misses leave a replay alone: the grow plugin
asks nothing in one (its misses were asked about in the recorded run), and
the profile plugin tells no `profile.missed` from one.

## Actions

| Action | Does |
|---|---|
| `replay.trial` `{ node, runs? }` | Replays recorded runs for a loaded node (its item id). Without `runs`, up to `per` in all; with it, that many more. Answers each replay made: the recorded run (`of`) and the replay's own `run` |

## Where it shows

The node pane of the Context interface ([keep.ts](../harness/keep.ts),
[node.ts](../harness/node.ts)) shows the live record and the replayed one
beside it, and each replayed run's verdict marked `replayed`, under the
recorded run it plays.

Injects `scripted.play`, `exchange.read`, `verdict.read`, `agent.tree`,
`graph.read` and `action.register`. Node only.
