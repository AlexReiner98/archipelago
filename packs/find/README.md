# find

Page side. The map as the page holds it, the query, and the line that sets
it.

- Provides `find.index`: every item and link of a type defined now
  (`types.read`), read in bounded pages through `graph.read` and kept live
  by `graph.watch`; `run(query)` answers a query over it (query.ts).
- Declares `find.query` (page): the query the canvas draws. Its line, in
  `map.bar`, sets it; anything else may too.

| Term | Matches |
|---|---|
| words | titles holding every word |
| `is:open` `is:closed` | the status's side in its base |
| `status:x` `type:x` | a status; a type or its base |
| `in:<id>` | the item and all that is part_of it |
| `near:<id>` | the item and what it is linked to |
| `id:<id>` | the item |

An empty line is `is:open`. At most 150 items come back, and the links
among them. Writes nothing.
