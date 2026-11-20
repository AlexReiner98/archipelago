# here 0.1.0

What is being looked at, now. It's how the harness view's three panes stay
linked: picking a node in the tree sets `here.node`, and the node pane and
the live run both follow. Types: [here.ts](here.ts).

## Keys

The spec declares four so that packs that have never met agree on them:

| Key | Holds |
|---|---|
| `here.item` | the item being looked at |
| `here.run` | the run being looked at |
| `here.node` | the node being looked at |
| `here.event` | the exchange event being looked at |

A pack declares any others under its own name, with a scope:

- `page`: one open page.
- `person`: everything the person has open, and the agents working for
  them. An agent sets `here.item` to show the person something.

## Not an action

`set` writes straight to `here`, not through an action. `here` is not data:
it isn't on the map, it isn't journalled, it's gone when nobody holds it,
and there's nothing to undo. The rule that a UI never writes directly is
about the graph, and holds: anything that should last is an action.

`watch(key, on)` calls `on` with the value now and then every change, and
returns its disposer.
