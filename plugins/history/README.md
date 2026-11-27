# history

The journal. A record stage on the graph's write chain
([spec](../../spec/graph.md)): it calls `next`, then writes the committed
change set in full (actor, authority, plugin, action, reason, run, and its
facts as `[op, id, field, value]`) with its inverse, so it never records a
change that failed. Kept in SQLite (`config.db`), or in memory without one.

| Action | Does |
|---|---|
| `history.undo` `{ change }` | Writes the inverse of a committed set as a new one, marked `undoes` |
| `history.list` `{ item?, run?, limit?, after? }` | Entries newest first; `item` narrows to the sets touching one item (its fields, or a link to or from it), else `run` to one run's. Writes nothing |
| `history.since` `{ after?, limit? }` | Entries oldest first, after a seq: the log as it was written, a page at a time, with `begins`, the first seq the journal holds. Writes nothing |
| `history.verify` `{}` | Replays the log (snapshots, then entries) into items and compares each with the graph's tables, read by id: `complete` (the log begins at the first change and holds the last), `differ` and up to 20 `examples`. Writes nothing |
| `history.get` `{ change }` | One entry; writes nothing |
| `history.snapshots` `{ limit?, after? }` | What older entries folded into; writes nothing |

- `history.undo` is the action name the spec reserves. The action plugin sets
  the new set's `header.undoes`. Undo goes down the chain like any change:
  if a field it touches has moved since, the graph refuses it with
  `graph.conflict` (undo the later change first). Undoing an undo redoes,
  and the original stands again. A set already undone is refused with
  `history.undone`.
- **The log is the truth** (decided 27 Nov 2026). The journal keeps every
  change set, and the graph's tables are its projection: replayed in order
  from nothing, the log makes every item. `history.verify` checks that it
  does. A map whose journal began after its first change (`begins` above 1)
  has a log that doesn't reach back; `verify` says so, and a first sync
  refuses it ([sync](../sync/README.md)).
- Sets committed before the stage was on the chain (other plugins' first
  writes as the map starts, or while history was off) are recorded when it
  loads, from the graph's recent sets (`graph.since`, the last thousand):
  the log misses none the graph still has.
- Nothing folds unless `keep` is set. Then, once more than `keep + fold`
  entries are kept, the oldest `fold` fold into one snapshot: the seqs it
  covers, its actors, plugins and actions, and its net facts. The log still
  rebuilds the items, but a folded set can't be undone alone
  (`history.compacted`), and a map synced from a cursor inside a fold can't
  be sent what it folded.

Injects `graph.stage`, `graph.read` and `action.register`. Node only.
