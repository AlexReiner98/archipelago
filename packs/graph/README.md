# graph

The graph, minimal: items and links in memory, kept in one JSON file
(`config.file`) and read back on load. Provides `graph.read`, `graph.watch`,
`graph.stage` and `graph.commit` ([spec](../../spec/graph.md)).

- Commits go one at a time down the stages, in config-tree order, to the
  store. The store applies a set whole or refuses it with `graph.conflict`
  (a `+` on a field holding another value, or a `-` of a value it doesn't
  hold).
- The last `config.keep` (1000) committed sets stay in memory for `since`
  and for watchers resuming `after` a cursor. Journalling them is history's.
- No schema, no history yet: those are their own packs.
