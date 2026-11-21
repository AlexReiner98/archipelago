# docs

What each running pack is for and what it adds, read from the packs
themselves, never typed. The reference behind it holds what each loaded
pack injects and provides (with the spec contract and edition of each key),
the actions it declared and their inputs, the places its nodes speak at, the
slots it declares and fills, and its config. When a pack changes, so does
its reference.

| File | Runs | What it is |
|---|---|---|
| [read.ts](read.ts) | both | `reference(runtime, sources)`: one entry per loaded pack, from the runtime's fibers, `action.list`, `agent.tree`, `slot.read` and the spec's capability lists |
| [index.ts](index.ts) | server | The pack `docs`: provides `docs.read` (`packs()`, `watch(on)`). Injects `action.list`, `agent.tree` |
| [tool.ts](tool.ts) | server | The pack `docs-tool`: the MCP tool `packs` (`mcp.host`), so agents read the same reference. No input: a line per pack; `pack`: its whole entry |
| [view.ts](view.ts) | page | The pack `docs`: the read-only Packs view (`#docs`), one card per pack (a pack with a server and a page half is one card): what it is for and what it adds, in plain words, no wiring. Packs with a problem first |
| [cards.ts](cards.ts) | page | What a card shows: what a pack adds, its state in words, the filter, the order |

- **A card is composable.** Its title line is the slot `docs.card.head` and
  its body `docs.card`, both `many`; each fill gets `{ pack }`, the pack's
  entry. This pack fills the body: what it is for, then what it adds
  (views, kinds of item, what it lets you do, how much it says to agents).
  An on/off switch is another pack's fill in the head.
- **What it is for** is the first sentence of the pack's README, wiring
  cut (`aboutOf`). A README that opens with what it provides shows none:
  that is drift for the docs checks to find.
- **It only looks.** It reads the runtime it runs in (its fibers: a pack's
  `inject`, what it `provided()`, its state, config and child packs), and
  invokes no action. A fiber's state has no event, so `watch` also looks
  for a change every second (`config.every`).
- **Config is shown as it is**, except functions (`ƒ`) and fields whose name
  says secret (`token`, `password`, `auth`, ...: `•••`).
- `docs.read` is the pack's own key, like `verdict.read`; the bridge serves
  it.
