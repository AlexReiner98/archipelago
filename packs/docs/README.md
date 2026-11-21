# docs

What each running pack is for and what it adds, read from the packs
themselves, never typed apart from them. The reference behind it holds
what each loaded pack injects and provides (with the spec contract and
edition of each key), the actions it declared and their inputs, the kinds
of item it defines, the places its nodes speak at, the slots it declares
and fills, its config, its `about`, and whether it is built in.

| File | Runs | What it is |
|---|---|---|
| [read.ts](read.ts) | both | `reference(runtime, sources)`: one entry per loaded pack, from the runtime's fibers, `action.list`, `types.read`, `agent.tree`, `slot.read` and the spec's capability lists |
| [index.ts](index.ts) | server | The pack `docs`: provides `docs.read` (`packs()`, `watch(on)`). Injects `action.list`, `agent.tree`, `types.read` |
| [tool.ts](tool.ts) | server | The pack `docs-tool`: the MCP tool `packs` (`mcp.host`), so agents read the same reference. No input: a line per pack; `pack`: its whole entry |
| [view.ts](view.ts) | page | The pack `docs`: the read-only Packs view (`#docs`) |
| [cards.ts](cards.ts) | page | What a card shows: its counts, the lists, a state in words, the filter |

## The Packs view

Shaped like other apps' plugin lists (VS Code, Chrome, Obsidian, Home
Assistant, WordPress): a card is the line the pack declares and counts of
what it adds; details are a click away and problems show only when there
are any.

- **What it is for** is the pack's own `about` (`Pack` in
  [runtime/core.ts](../../runtime/core.ts)), one plain sentence for a
  person. A test holds every pack in this repository to it.
- **Counts that open:** views (each opens its tab), parts of views,
  kinds of item (each opens the Map on it, through `find.query`),
  actions, things said to agents (opens the Reflex tree), and how many
  packs use it.
- **Lists:** needs attention (waiting or failed) first, then built in
  (loaded from this repository: the fiber's `source` is under its root),
  then added from elsewhere.
- A pack with a server half and a page half (the bridge, docs) is one
  card.
- **A card is composable.** Its title line is the slot `docs.card.head`
  and its body `docs.card`, both `many`; each fill gets `{ pack, all }`.
  This pack fills the body. An on/off switch is another pack's fill in
  the head.

## How it reads

- **It only looks.** It reads the runtime it runs in (its fibers: a pack's
  `about`, `inject`, what it `provided()`, its state, config, `source`
  and child packs), and invokes no action. A fiber's state has no event,
  so `watch` also looks for a change every second (`config.every`).
- **Config is shown as it is** to agents, except functions (`ƒ`) and
  fields whose name says secret (`token`, `password`, `auth`, ...: `•••`).
- `docs.read` is the pack's own key, like `verdict.read`; the bridge serves
  it.
