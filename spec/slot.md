# slot

How the UI is put together out of packs. A pack declares a slot (a hole in
its UI) and other packs fill it. The whole UI is one slot, `root`, filled
by whichever frame pack is loaded, and the page's six regions are slots
too ([frame](frame.md)). Types: [slot.ts](slot.ts).

## Capabilities

| Key | Gives |
|---|---|
| `slot.declare` | Declare a slot |
| `slot.fill` | Fill one |
| `slot.read` | What fills each slot, for the renderer |

## Slots and fills

- `declare({ name, merge, props })`: a slot, named under the declaring
  pack (`harness.node`), with the props every fill gets.
- `fill({ slot, name, view })`: a component in a slot, as the calling
  pack's.
- Fills are in the config-tree order of their packs. `many` shows them
  all in that order; `one` shows the first. To show another, move its
  pack's entry or disable the one in front. There are no ranks and no
  conflicts to settle: order is config, and config can be changed back.
- A fill for an undeclared slot waits, shown nowhere, until a pack
  declares it. That's the same as a Cordis consumer waiting for its
  provider, and it means load order never matters.
- A fill may carry `when`: it shows only while `here` matches. The
  broker's `arrange` config may move it to another slot or hide it
  ([frame](frame.md)).
- Both return disposers. When a pack unloads, its slots and fills go, and
  so does everything mounted in them.

## The renderer

Decided by Alex: **panels are Preact** function components, written with
htm so there's no build step. The renderer pack provides the one copy
every pack uses, and fills `root` with nothing but a mount point for the
frame. Web Components are out, because a `customElements.define` can't be
undone.

- A component unmounts completely; its hook cleanups are its disposers.
- A component renders another slot inside itself with the shared `Slot`
  from `slot.read` (`<Slot name=… />`), which is how a frame or a view
  leaves holes for packs.
- Reading `here` or watching the graph re-renders it, and its
  subscriptions go when it unmounts.

**The graph is not drawn with components.** DOM stalls at a few thousand
nodes. The graph is one [scene](scene.md) surface: a WebGL2 canvas owned by
the scene pack, filled by packs with layers, and placed on the page as an
ordinary panel.

## What it isn't

Slots hold UI only. Actions, nodes and write stages have their own
brokers ([action](action.md), [agent](agent.md), [graph](graph.md)); this
isn't a general-purpose registry.
