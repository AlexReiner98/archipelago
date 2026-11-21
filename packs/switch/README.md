# switch

An on/off switch on each card of the Packs view ([packs/docs](../docs/README.md)),
for the page's packs and the server's alike. Each flip is one change set,
shown in activity like any other, and undone the same way.

```
switch ─▶ switch.set ─▶ page item (as page.set writes it) ─▶ page follows   (packs/page)
                     └▶ server item                       ─▶ switch follows (loader.tree)
```

| File | Runs | What it is |
|---|---|---|
| [server.ts](server.ts) | server | `switch.set`, the flavour `server`, and following it. Injects `types.define`, `graph.read`, `graph.watch`, `action.register`, `loader.tree` |
| [view.ts](view.ts) | page | The switch: a fill of `docs.card.head`. Injects `action.invoke`, `slot.fill` |
| [ties.ts](ties.ts) | both | What stands on what between cards, what stops, what is needed |

- **`switch.set`** takes `{ page?, server?, on }`: entry ids of each
  runtime's config tree, and `on` (`null`: as the template has it). The
  page's go into the item `page.set` writes; the server's into an item of
  the flavour `server`, which this pack lays over the tree the server
  started with. One change set either way: `history.undo` takes it all
  back, and both runtimes follow.
- **A card is one switch.** It turns every entry of the card (`entries`,
  read by the docs pack from each runtime's `loader.tree`) on or off.
- **What else stops** shows on the switch before you flip it: every running
  card that stands on it, however far down. A card stands on the packs it
  uses and on the pack whose slot it fills.
- **Needed** shows instead of a switch on what the Packs view, the switch,
  the page following its item, undo and the frame stand on: turning one
  off here would stop the way back. An agent can still call `switch.set`.
- **Undo** sits beside a switch after it flips, until it is used.
