# docs

The reference, read from the running packs, never typed: what each loaded
pack injects and provides (with the spec contract and edition of each key),
the actions it declared and their inputs, the places its nodes speak at, the
slots it declares and fills, and its config. When a pack changes, so does
its reference.

| File | Runs | What it is |
|---|---|---|
| [read.ts](read.ts) | both | `reference(runtime, sources)`: one entry per loaded pack, from the runtime's fibers, `action.list`, `agent.tree`, `slot.read` and the spec's capability lists |
| [index.ts](index.ts) | server | The pack `docs`: provides `docs.read` (`packs()`, `watch(on)`). Injects `action.list`, `agent.tree` |
| [tool.ts](tool.ts) | server | The pack `docs-tool`: the MCP tool `packs` (`mcp.host`), so agents read the same reference. No input: a line per pack; `pack`: its whole entry |
| [view.ts](view.ts) | page | The pack `docs`: the read-only Packs view (`#docs`), one card per pack, the server's through the bridge and the page's own |
| [cards.ts](cards.ts) | page | What a card shows: an action's input field by field, the filter, the tally |

- **A card is composable.** Its title line is the slot `docs.card.head` and
  its body `docs.card`, both `many`; each fill gets `{ pack }`, the pack's
  entry. This pack fills the body (contracts, actions, places, slots,
  config). An on/off switch is another pack's fill in the head.
- **It only looks.** It reads the runtime it runs in (its fibers: a pack's
  `inject`, what it `provided()`, its state, config and child packs), and
  invokes no action. A fiber's state has no event, so `watch` also looks
  for a change every second (`config.every`).
- **Config is shown as it is**, except functions (`ƒ`) and fields whose name
  says secret (`token`, `password`, `auth`, ...: `•••`).
- `docs.read` is the pack's own key, like `verdict.read`; the bridge serves
  it.
