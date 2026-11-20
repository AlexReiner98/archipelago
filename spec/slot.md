# slot (draft)

How the UI is put together out of packs. A pack declares a slot (a hole in
its UI) and other packs fill it. The whole UI is one slot, `root`, filled
by whichever shell pack is loaded. Types: [slot.ts](slot.ts).

## Capabilities

| Key | Gives |
|---|---|
| `slot.declare` | Declare a slot |
| `slot.fill` | Fill one |
| `slot.read` | What fills each slot, for the renderer |

## Slots and fills

- `declare({ name, merge, props })`: a slot, named under the declaring
  pack (`harness.node`), with the props every fill gets.
- `fill({ slot, id, view, rank })`: a component in a slot.
- `many` shows every fill, by rank then pack id. `one` shows the fill the
  config tree names for the slot, else the highest rank. There is no
  conflict to settle: a choice is config, and config can be changed back.
- A fill for an undeclared slot waits, shown nowhere, until a pack
  declares it. That's the same as a Cordis consumer waiting for its
  provider, and it means load order never matters.
- Both return disposers. When a pack unloads, its slots and fills go, and
  so does everything mounted in them.

## The renderer: open

One renderer draws every pack's components, so `View` has one meaning.
**Open as a question to Alex.** Web Components are out, because a
`customElements.define` can't be undone. What the choice has to give:

- A component unmounts completely, with nothing left registered.
- A component can render another slot inside itself (`<Slot name=… />`),
  which is how the shell leaves holes for packs.
- Reading `here` and watching the graph re-render it, and its
  subscriptions are disposed when it unmounts.
- A pack's module can be swapped (HMR) without reloading the page.

The candidates are on the question. Until it's settled, `View` is typed as
a function of props whose result only the renderer reads.

## What it isn't

Slots hold UI only. Actions, nodes and write stages have their own
brokers ([action](action.md), [agent](agent.md), [graph](graph.md)); this
isn't a general-purpose registry.
