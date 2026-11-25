# find

Page side. The map as the page holds it, the query, and the line that sets
it.

- Provides `find.index`: every item and link of a type defined now
  (`types.read`), read in bounded pages through `graph.read` and kept live
  by `graph.watch` (an item it didn't hold that a change gives a shown type,
  such as a node moved to a record, is read whole); `run(query)` answers a query over it (query.ts).
- Declares `find.query` (page): the query the canvas draws. Its line, in
  the region `top` while Map or Landscape shows, sets it; anything else may too.
- Provides `find.line`: the line, to draw anywhere (the
  [command line](../command/README.md) draws it on Ctrl+K), and `jump(id)`.
- Provides `find.offer`: another plugin puts rows in the command line, between
  the terms and the items, each run when picked and gone with its plugin. The
  views plugin offers its views there.

## Suggestions

As you type, the line offers what fits the word being typed
(suggest.ts), terms first and then items:

- a key (`ty` → `type:`), a side, a type, a status; after a key, its
  values; after `in:` `near:` `id:`, items by title.
- items whose titles hold every word. Picking one jumps to it.

↑↓ move, Enter picks, Escape closes. A term goes into the line.

## A jump

`jump(id)` sets `here.item`, so the item page opens in its slot. The
query stays if it draws the item, else it becomes `near:<id>`, so every
view shows the item among its neighbours. From a view that does not draw
the query, it opens Map.

| Term | Matches |
|---|---|
| words | titles holding every word |
| `is:open` `is:closed` | the status's side in its base |
| `status:x` `type:x` | a status; a type or its base |
| `in:<id>` | the item and all that is part_of it (an id, or a title, underscores for spaces) |
| `near:<id>` | the item and what it is linked to (an id, or a title: `near:Frontend`) |
| `id:<id>` | the item |

An empty line is `is:open`. At most 150 items come back, and the links
among them. Writes nothing.

The suggestions list and the count follow the query once it holds still for `LIST_WAIT_MS` (220), so typing does not flicker them; the list fades in over 140 ms as it opens and out over `LIST_OUT_MS` (140) as it closes.
