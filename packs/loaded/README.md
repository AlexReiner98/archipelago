# loaded

What a harness loads into a run, as nodes: a skill's text and memory files
(CLAUDE.md, CLAUDE.local.md, MEMORY.md). They shape a run as much as
anything the map says, so each is a node said at its place, judged per run
like any node, and shown in the harness view's tree. Injects `graph.read`,
`graph.watch`, `agent.node` and `action.register`.

| Place | Reached when |
|---|---|
| `skill:<name>` | a skill's text loads (`skill:anthropic-skills:docs` for a plugin's) |
| `memory:<scope>/<path>` | a memory file loads; scope `project`, `local`, `user`, `auto` or `managed`, the path with `/` and `~` for home |

These are open-vocabulary places ([spec/agent.ts](../../spec/agent.ts)):
not in edition 1's `PLACES`, so an adapter reaches them without listing
them in `reaches`. Whether they join `PLACES` is a question to Alex on the
map ("skill: and memory: places in the spec?"). They record; the map can't
speak to the agent there, since the harness has already loaded the text.

- **Nodes.** Each graph item of type `loaded` (`title`, `kind`: skill or
  memory, `place`, `path`) is a node at its one place that says what was
  loaded there: the moment's input `text`. The items outlive restarts, so
  the tree keeps every skill and memory file runs have loaded.
- **`loaded.note`** (`place`, `kind`, `title`, `path`): makes the item the
  first time its place is seen, and changes nothing after. The adapter
  calls it before reaching the place; the pack follows the graph as each
  change commits, so the node is there by the time the action returns.
- **Judging.** Nothing goes wrong at a load itself, so a loaded node is
  failed only by misses its `misses` (a field on its item) name, wherever
  in the run they stand (`covers` in the verdict and grow packs). Without
  `misses` it stays quiet: the record says how often it was loaded.

The Claude Code adapter finds loads in the transcript ([its README](../claude-code/README.md)).
