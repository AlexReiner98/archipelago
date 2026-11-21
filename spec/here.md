# here

What is being looked at, now. It's how the harness view's three panes stay
linked: picking a node in the tree sets `here.node`, and the node pane and
the live run both follow. Types: [here.ts](here.ts).

## Capabilities

| Key | Gives |
|---|---|
| `here.declare` | Declare a key |
| `here.read` | Read and watch a key |
| `here.set` | Set or clear one |

## Keys

The spec declares five so that packs that have never met agree on them:

| Key | Holds |
|---|---|
| `here.item` | the item being looked at |
| `here.run` | the run being looked at |
| `here.node` | the node being looked at |
| `here.event` | the exchange event being looked at |
| `here.view` | the fill shown in the region `center`, as `pack/name` (edition 7, [frame](frame.md)) |

A pack declares any others under its own name, with a scope:

- `page`: one open page.
- `person`: everything the person has open, and the agents working for
  them. An agent sets `here.item` to show the person something.

## Not an action

`set` writes straight to `here`, not through an action. `here` is not data:
it isn't on the map, it isn't journalled, it's gone when nobody holds it,
and there's nothing to undo. The rule that a UI never writes directly is
about the graph, and holds: anything that should last is an action.

`set(key, value)` takes no "by": the change records the pack and actor from
the calling context.

## Callbacks, not context keys

In pure Cordis, shared state would be context keys that dependents inject,
and a change would reload them. `here` doesn't do that on purpose: a
selection changes on every click, and reloading every pack that looks at
it each time is far too heavy. Cordis also only notices a key whose
provider changes, not one overwritten in place. So `here` is a service:
`watch(key, on)` calls `on` with the value now and then every change, and
returns its disposer, which goes with the watching pack like any effect.
