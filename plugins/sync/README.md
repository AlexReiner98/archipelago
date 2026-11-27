# sync

Two maps synced, both ways: each gets what the other changed since they
last synced. For one person's maps on two machines, or a local map and a
hosted one: context iterated on one reaches the other.

```
npm run map -- sync <map|url> [--map name] [--dry] [--keep theirs] [--token t]
```

Syncs map `live` (or `--map`) with another map served here by name, or a
server's bridge by url, its token in `--token` or `ARCHIPELAGO_SYNC_TOKEN`
(`Authorization: Bearer`). `--dry` says what would go and writes nothing.

## The log is what syncs

The log is the truth (decided 27 Nov 2026, [history](../history/README.md)),
so a map sends its log: the change sets in its journal after the cursor the
other map last had (`history.since`), never the graph's last thousand. A
log with a hole (folded, or lost) is refused, and so is a first sync from a
log that doesn't reach back to the map's first change: `history.verify`
says which.

```
sync.status on both ──▶ each map's log since the other last had it
  first run ──▶ join: both logs replayed to items and made one
  after     ──▶ plugins' new items paired or copied; everyone else's sets
                with ids swapped through the pairs ──▶ plan (merge.ts)
──▶ writes applied on the other map (sync.apply) ──▶ sync.mark: cursors, pairs, report
```

([run.ts](run.ts)) Each copy is a change set of its own on the map that
took it: its actor is `agent:sync/<the other map's id>`, its authority the
first set's, its reason `From <map>: <the first reason>`. So the journal
keeps it, the Activity view shows it, and `history.undo` takes it back. An
undo is a change like any other, so it syncs too. Those copies are left out
when the map sends its log back. A set the other map's schema refuses is
held there (`schema.quarantined`) and named in the report.

## The first run: a join

Two maps that grew apart hold the same things under different ids (a
context filter made on each, a tool's words). The first run replays both
logs to items and makes them one ([merge.ts](merge.ts) `join`):

- An item with the same id on both is one item.
- Else items are paired by type and title, and a link by its type and its
  ends once they are paired, where one item on each map has that name. A
  name more than one item has on a map is left unpaired (`ambiguous`), and
  each is copied.
- Where a pair differs, the kept map's fields go to the other: the map it
  is run from, unless `--keep theirs`.
- What one map alone has is copied to the other, its id kept.

Pairs are kept on both maps, per peer (`sync.pairs`). Every later run swaps
ids through them, in a set's items and in its values (a link's ends).

## A map's plugins do their own work

A set made by a map's own plugin (`plugin:<id>`: a seed, a tool's words, a
voice, a plugin's upkeep) isn't copied: the other map runs its own plugins.
What such a set makes is paired with the other map's item of the same type
and title, or copied where it has none. A person's or an agent's change to
that item later syncs like any other, onto the other map's own.

## When both changed it

After the join, the later change wins, **field by field**, by commit time:

- Two fields of one item changed on different maps: both stay.
- One field changed on both: the later value is written on both. The
  earlier is in the journal of the map that had it, so an undo brings it
  back. The run names each one: the item, the field, both values and which
  stayed.
- An item taken away on one map and changed on the other: if the change
  is later, the item comes back whole, as the map that kept it has it; if
  the removal is later, it goes on both.
- A copy retracts what the map holds now, not what the sender saw, so it
  never fails with `graph.conflict`. A field already so writes nothing,
  and a set left with nothing to write is skipped.

There are no holds: every change applies, and anything can be undone.
Commit times come from each map's own clock.

## Actions

| Action | Does |
|---|---|
| `sync.status` `{}` | This map's sync id and name, and each peer: its cursor, when they last synced, and that run's report. Writes nothing |
| `sync.apply` `{ writes }` | Makes `{ id, field, value? }`, `{ id, whole: fields }` and `{ id, remove: true }` true here, as one change set |
| `sync.pairs` `{ peer, after?, limit? }` | Ids paired with a peer's, `[this map's, the peer's]`, a page at a time. Writes nothing |
| `sync.mark` `{ peer, name, cursor?, report?, pairs?, only? }` | Keeps how far a peer has had this map's log, the run's report, and new pairs (at most 500 a call; `only`: the pairs alone). Writes nothing to the map |

The map's id, the cursors and the pairs are in `sync.sqlite` beside the
map, not in the graph: they are about syncing, not the map's content, and
would sync themselves otherwise.

## On the page

[view.ts](view.ts): a line in the header, `⇄ hosted · 4 min ago · 2
conflicts`, for the map last synced with; opened, every peer with its last
run's sets in and out and each field both maps changed, with the value
kept. Nothing on a map that never synced.

Injects `graph.read` and `action.register` (server), `action.invoke` and
`slot.fill` (page). Tested in `test/sync.test.ts`.
