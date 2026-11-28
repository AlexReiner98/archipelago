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
  values; after `in:` `near:` `id:`, items by title; after `as_of:`, today's date to edit.
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
| `as_of:<date>` | records true in the world then: `as_of` on or before it, and no `valid_to` or one after it; an item with no `as_of` fails it ([record](../record/README.md)) |

An empty line is `is:open`. At most 150 items come back, and the links
among them. Writes nothing.

## Why nothing

A query that finds nothing says why, in its result: `missing`, the words no
title in its pool holds (the pool is the map, or what `in:` `near:` `id:`
give); or else `empty_by`, the term that left nothing (`id:nope`,
`status:blocked`, `as_of:2010-01-01`). When every word is in some title but
no one title holds them all, it names neither. There are no synonyms:
matching stays strict, so "nothing" is an honest "not on the map under that
word", and the reader picks another word. The line shows it beside its count
(`no title holds “zebra”`), and mcp's `query` answer carries both fields.

The suggestions list and the count follow the query once it holds still for `LIST_WAIT_MS` (220), so typing does not flicker them; the list fades in over 140 ms as it opens and out over `LIST_OUT_MS` (140) as it closes.
