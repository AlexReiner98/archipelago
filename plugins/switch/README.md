# switch

An on/off switch on each card of the Plugins view ([plugins/docs](../docs/README.md)),
for the page's plugins and the server's alike. Each flip is one change set,
shown in activity like any other: flipping it back undoes it.

```
switch ─▶ switch.set ─▶ page item (as page.set writes it) ─▶ page follows   (plugins/page)
                     └▶ server item                       ─▶ switch follows (loader.tree)
```

| File | Runs | What it is |
|---|---|---|
| [server.ts](server.ts) | server | `switch.set`, the flavour `server`, and following it. Injects `types.define`, `graph.read`, `graph.watch`, `action.register`, `loader.tree` |
| [view.ts](view.ts) | page | The switch: a fill of `docs.card.head`. Injects `action.invoke`, `slot.fill` |
| [ties.ts](ties.ts) | both | What stands on what between cards, what stops, what is needed, what a card leaves without a type |

- **`switch.set`** takes `{ page?, server?, on }`: entry ids of each
  runtime's config tree, and `on` (`null`: as the template has it). The
  page's go into the item `page.set` writes; the server's into an item of
  the flavour `server`, which this plugin lays over the tree the server
  started with. One change set either way: `history.undo` takes it all
  back, and both runtimes follow.
- **A card is one switch.** It turns every entry of the card (`entries`,
  read by the docs plugin from each runtime's `loader.tree`) on or off.
- **What else stops** shows on the switch before you flip it: every running
  card that stands on it, however far down. A card stands on the plugins it
  uses and on the plugin whose slot it fills.
- **What it leaves** shows too. An on card's tip says how many items its
  kinds hold (the counts on its card): turned off, they stay on the graph
  unchanged, but no view shows them until it is back on. An off card says
  how many it left without a type, beside its switch, from
  `schema.untyped` ([plugins/schema](../schema/README.md)): one read for
  every card, again whenever a card is turned on or off. Without the schema
  plugin nothing is shown.
- **Needed** shows instead of a switch on what the Plugins view, the switch,
  the page following its item, undo and the frame stand on: turning one
  off here would stop the way back. An agent can still call `switch.set`.
- **Undo is flipping it back.** Each flip is its own change set in
  activity, where `history.undo` takes any of them back too.

## The way back is locked

The switch never turns off the server plugins that turning things back on
needs: `graph`, `action`, `types`, `page`, `switch`, `history`, `bridge`,
`docs`, `docs-tool` and `mcp` (`LOCKED` in server.ts). `switch.set` refuses
the whole call if it asks for one, and at start an item that says one is
off is not followed. A host adds its own in the switch's config,
`locked: [...]` (its sign-in and gateway), since the off state is kept on
the graph and would come back at every start.
