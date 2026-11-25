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
| `history.get` `{ change }` | One entry; writes nothing |
| `history.snapshots` `{ limit?, after? }` | What older entries folded into; writes nothing |

- `history.undo` is the action name the spec reserves. The action plugin sets
  the new set's `header.undoes`. Undo goes down the chain like any change:
  if a field it touches has moved since, the graph refuses it with
  `graph.conflict` (undo the later change first). Undoing an undo redoes,
  and the original stands again. A set already undone is refused with
  `history.undone`.
- Once more than `keep + fold` entries are kept (5000 + 1000), the oldest
  `fold` fold into one snapshot: the seqs it covers, its actors, plugins and
  actions, and its net facts. A folded set can't be undone alone
  (`history.compacted`).
- The graph is the truth. Nothing is rebuilt from the journal, and losing
  it loses only the record and undo.

Injects `graph.stage` and `action.register`. Node only.
