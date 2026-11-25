# agent

Provides `agent.node`, `agent.tree` and `agent.run` ([spec](../../spec/agent.md)).
Injects `exchange.append`, so it waits until an exchange is loaded.

- A node's id is `plugin/name`, the plugin taken from the registering context.
  A second node of the same id is refused.
- `reach` asks every node whose `at` matches a reached place, all at once,
  and answers in config-tree order. A place pattern matches by family; in
  its argument `*` stays within a path segment and `**` doesn't.
- Each say, refusal and act is appended to the exchange. A node that
  throws, or refuses where refusing can't stop anything, is a `miss`.
- A run the plugin doesn't know (it began before the plugin reloaded) is taken
  up as it is, with a miss saying so: a reload never breaks a run.
- A say whose node already said other words in this context at the same
  kind of place (`prompt`, `tool:`, `file:` …) is recorded with
  `detail.reworded: true`: the node was reworded while the run heard it.
  A `repeat: "every"` node is never marked. A compaction forgets it, as it
  does what was said.
