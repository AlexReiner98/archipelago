# command

Page side. Ctrl+K (⌘K) opens the find line over the page, from any view,
in the region `over`.

- Type a name: the first view or item is ready, and Enter goes to it. A
  view opens; an item is jumped to (find's `jump`: the item page opens,
  the view shows it). Views come from the views pack, through `find.offer`.
- ↑↓ move; a term goes into the line; Enter with no item sets the query.
- Escape, a click outside or Ctrl+K again closes it.

Declares `command.open` (page): whether it is open. The keys set it, and
so may anything else, an agent included. Injects `find.line`: the
suggestions and the jump are find's. Writes nothing.
