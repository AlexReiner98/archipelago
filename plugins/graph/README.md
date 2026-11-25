# graph

The graph: items and links in one SQLite database (`config.db`, Node's
built-in `node:sqlite`, no dependency), or in memory without one. Provides
`graph.read`, `graph.watch`, `graph.stage` and `graph.commit`
([spec](../../spec/graph.md)).

- `store.ts` keeps each item's fields as one JSON object, with its type and
  link ends indexed. Pages run in the order items were made, and no read
  returns more than `LIMIT_MAX`.
- Commits go one at a time down the stages, in config-tree order, to the
  store. The store applies a set whole, in one transaction, or refuses it
  with `graph.conflict` (a `+` on a field holding another value, or a `-` of
  a value it doesn't hold).
- The last `config.keep` (1000) committed sets are kept in the database, so
  `since` and watchers resuming `after` a cursor work across restarts, and
  change set ids go on from where they were. Journalling them is history's.
- `interchange.ts` writes a store out as change sets (JSON Lines of `+`
  facts) and reads them back in: the way a graph moves between stores.
  `node scripts/graph.ts` runs it by hand (export, import, from-json for the
  old JSON file, counts).
- No schema and no history here: those are their own plugins, joining the
  chain as stages ([history](../history/README.md)).
- `renamed.ts` reads what was written before spec edition 11, when a
  plugin was called a pack: a logged or exported change set's header
  `pack`, an exchange event's `pack`, an actor `pack:<id>` and an item's
  `packs` field all read as `plugin`, `plugin:<id>` and `plugins`. Nothing
  on disk is rewritten; the history journal and the exchange read through
  it too.
