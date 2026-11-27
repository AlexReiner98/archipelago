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
| `history.checkpoint` `{}` | Keeps the whole map at the seq it reads it at (`graph.all`, a page at a time, each page written as it is read, so memory holds one page; read again if a change lands meanwhile): from then on the log is the checkpoint and every entry after it. Writes nothing to the map |
| `history.state` `{ after?, limit? }` | The latest checkpoint's items, `{ id, fields }` by id, a page at a time, with its `seq`. Writes nothing |
| `history.verify` `{}` | Replays the log (snapshots, then entries) into items and compares each with the graph's tables, read by id: `complete` (the log begins at the first change and holds the last), `differ` and up to 20 `examples`. Writes nothing |
| `history.at` `{ at?, ids?, limit?, after? }` | The map as it was at a point: the log replayed to it, items `{ id, fields }` (by `ids`, with `missing`, else every item by id, a page at a time). Writes nothing |
| `history.diff` `{ from, to?, limit?, after? }` | The map at `from` against the map at `to` (default now), by item id, a page at a time: each item made, changed or gone, each field before and after, and the sets between that touched it (at most 10), with `sets` and `total`. Writes nothing |
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
- **A log begun late gets a checkpoint.** On load, after taking in what the
  graph still has, a journal whose entries don't reach back to the first
  change (or that has a hole: the graph no longer holds what came after its
  last set) keeps a checkpoint of the whole map at the seq now. The log is
  then that checkpoint and every entry after it: `history.verify` replays
  from it, and a first sync reads it ([sync](../sync/README.md)). The
  entries before it stay, for the record and undo.
- **A point in the log** (`history.at`, `history.diff`): a seq; `c<seq>`,
  the map as that set left it; an ISO time or date, the last set committed
  at or before it (a bare date is its first instant, UTC); or `now`. The
  log can't say what came before it begins or its checkpoint
  (`history.before`), nor tell apart the sets inside a fold
  (`history.compacted`): a point there is refused. A diff runs over the
  map at both points, so a field set and set back in between is no change,
  and an undo and what it undid cancel out. These are transaction time,
  what the map held then; when something was true in the world is a field
  on the item (a record's `as_of`).
- Nothing folds unless `keep` is set. Then, once more than `keep + fold`
  entries are kept, the oldest `fold` fold into one snapshot: the seqs it
  covers, its actors, plugins and actions, and its net facts. The log still
  rebuilds the items, but a folded set can't be undone alone
  (`history.compacted`), and a map synced from a cursor inside a fold can't
  be sent what it folded.

Injects `graph.stage`, `graph.read`, `graph.all` (edition 12) and `action.register`. Node only.

## The Then view

Page side, [view.ts](view.ts): the view "Then" asks `history.diff` from a
point (a change set, a time, or a quick pick: an hour ago, today, a week
ago) to now or another point, and draws each item that differs: + made,
~ changed, − gone, each field from its value then to its value after, and
the sets between that touched it. ▸ shows the item whole at both points
(`history.at`). The point it compares from is the page key `history.from`,
so another view opens it at a change: Activity's "since" on a change set
opens it from just before that set. Its words are pure in
[then.ts](then.ts). Injects `slot.fill`, `here.*` and `action.invoke`;
it only reads.
