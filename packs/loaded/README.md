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

These are edition 2 places in `PLACES` ([spec/agent.ts](../../spec/agent.ts)),
and the Claude Code adapter lists them in `reaches`. This pack records a
load the map hasn't adopted yet; once the map writes the file
([packs/written](../written/README.md)), the map's node says it instead.

- **Nodes.** Each graph item of type `loaded` (`title`, `kind`: skill or
  memory, `place`, `path`) is a node at its one place that says what was
  loaded there: the moment's input `text`. The items outlive restarts, so
  the tree keeps every skill and memory file runs have loaded.
- **`loaded.note`** (`place`, `kind`, `title`, `path`): makes the item the
  first time its place is seen, and changes nothing after. The adapter
  calls it before reaching the place; the pack follows the graph as each
  change commits, so the node is there by the time the action returns.
- **Adopted.** An item whose `adopted` names a node (set by
  `written.adopt`) registers nothing: that node says it, and `loaded.note`
  answers with it.
- **Judging.** Nothing goes wrong at a load itself, so a loaded node is
  failed only by misses its `misses` (a field on its item) name, wherever
  in the run they stand (`covers` in the verdict and grow packs). Without
  `misses` it stays quiet: the record says how often it was loaded.

The Claude Code adapter finds loads in the transcript ([its README](../claude-code/README.md)).
