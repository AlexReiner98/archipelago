# command

Page side. Ctrl+K (⌘K) opens the find line over the page, from any view,
in the region `over`.

- Type a name: the first item is ready, and Enter jumps to it (find's
  `jump`: the item page opens, the view shows it).
- ↑↓ move; a term goes into the line; Enter with no item sets the query.
- Escape, a click outside or Ctrl+K again closes it.

Declares `command.open` (page): whether it is open. The keys set it, and
so may anything else, an agent included. Injects `find.line`: the
suggestions and the jump are find's. Writes nothing.
