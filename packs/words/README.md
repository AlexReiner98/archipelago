# words

Agent nodes whose words are on the map. Each graph item of type `node`
(`title`, `kind`, `at`, `words`, `refuse`) is registered as a node with the
item as its `source`. Its words are read from the graph at every say, so an
edit takes effect the next time it speaks.

| Action | Does |
|---|---|
| `words.set` `{ node, words }` | Changes what a node says |
| `words.add` `{ title, kind, at, words, refuse? }` | Adds a node |

A node whose item has `held` (a reason) is held as written: `words.set` and
`words.retire` refuse it, with the reason (`words.held`). The
[written](../written/README.md) pack sets it for the files the map writes.

`config.seed` lists nodes made through `words.add` when the graph has none.
Injects `graph.read`, `graph.watch`, `agent.node`, `action.register`,
`action.invoke`.
