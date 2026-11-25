# page

Changing the page's plugins as an action, so a person and an agent do it the
same way and either can undo it.

```
page.set ─▶ the page item (field plugins) ─▶ page copy of the map ─▶ overlay on boot.ts ─▶ loader.tree.edit
```

| File | Runs | What it is |
|---|---|---|
| [overlay.ts](overlay.ts) | both | The flavour `page` (of record, field `plugins`), `merge` and `overlay` |
| [index.ts](index.ts) | server | `page.set`, the action, and `record`, the write it makes, shared with `switch.set` ([plugins/switch](../switch/README.md)). Injects `types.define`, `graph.read`, `action.register` |
| [view.ts](view.ts) | page | Lays the item's changes over the tree the page started with. Injects `find.index`, `loader.tree` |

- **`page.set`** takes `{ plugin, on?, config?, after? }`, where `plugin` is an
  entry id of the page's tree ([app/boot.ts](../../app/boot.ts)).
  - `on: false` turns the plugin off, `on: true` on (a plugin the template has
    off, like the examples), and `on: null` puts it back as the template has it.
  - `config` lays keys over its config; `null` clears every change to it.
  - `after` places it after a sibling: `""` first, `null` back where it was.
- **One item holds every change,** keyed by entry id. Each call is one change
  set, and `history.undo` takes it back. The page follows either way.
- **Rearranging is config too.** For example, `{ plugin: "renderer", config:
  { arrange: { "item/page": "left" } } }` moves a fill
  ([spec/frame.md](../../spec/frame.md)).
- **The template is never changed.** `boot.ts` stays the default, and the
  item only holds what differs from it. An id the template lacks is ignored.
- Turning `find` or `page` off stops the page from following later changes.
  The item still holds them, and a fresh page applies them.
- An item written before spec edition 11 holds its changes in `packs`; it
  is read as `plugins`, and the next change moves it there (and its title
  to "The page's plugins").
