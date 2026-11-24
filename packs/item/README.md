# item

Page side: one page per item, in the region `right` while Map or Landscape
shows, for the item `here.item` names. It looks and undoes; nobody adds,
links or edits items by hand. Agents change the map through the items
actions, and the page follows live.

From the top:

- **Head:** the item's mark and title; its type and status under it.
- **Actions:** under the head, the slot `item.actions` (merge many), where
  another pack offers what to do with the item shown; each fill reads
  `here.item` and shows nothing for an item it has nothing for (the
  harness: a context filter's view).
- **Fields as marks:** one chip per field it has, by kind (`kind bug`,
  `due 2026-11-21`); a yes is the field's name, a no is left out, a long
  value is cut short with the whole in its tooltip. An `id` field opens
  the item it names.
- **The note**, in the map's dialect (Markdown): the first block leads,
  the rest of the lead folds under "more", and each heading is a section,
  folded. Lists, quotes, tables, code, **bold**, *emphasis*, web links,
  and item ids drawn by name with their mark, one click away.
- **Tied to:** neighbours by kind of link, what it points at (→) and then
  what points at it (←), six at a time per kind. A click opens one.
- **History:** the change sets that touched it (its fields, or a link to
  or from it), newest first, ten at a time: who, when, why, and what
  changed (`status todo → doing`, `linked → part of …`). Each has an
  undo, which writes its inverse as a new change; a refusal (a field has
  moved since) shows under it. An undone change is struck through.
- `inside` and `around` set the query to draw it with its parts or its
  neighbours.

| File | What it is |
|---|---|
| [index.ts](index.ts) | The pack: the page, filled in `right` beside Map and Landscape |
| [parts.ts](parts.ts) | The page's parts: note, marks, neighbours, history |
| [note.ts](note.ts) | The note read as lead, sections and inline spans. Pure |
| [read.ts](read.ts) | Marks, neighbours, a change's lines about the item, how long ago. Pure |
| [sheet.ts](sheet.ts) | Its sheet, style tokens only |

Injects `find.index`, `here.read`, `here.set`, `slot.fill` and
`action.invoke` (`history.list { item }` and `history.undo`, as the
person at the page). Without the history pack there is no history to show.
