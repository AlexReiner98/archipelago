# docs

What each running pack is for and what it adds, read from the packs
themselves, never typed apart from them; and the Guide, read from the
repository's own Markdown. The reference behind it holds
what each loaded pack injects and provides (with the spec contract and
edition of each key), the actions it declared and their inputs, the kinds
of item it defines, the places its nodes speak at, the slots it declares
and fills, its config, its `about`, and whether it is built in.

| File | Runs | What it is |
|---|---|---|
| [read.ts](read.ts) | both | `reference(runtime, sources)`: one entry per loaded pack, from the runtime's fibers, `action.list`, `types.read`, `agent.tree`, `slot.read` and the spec's capability lists; `activityOf` a run's events per pack |
| [index.ts](index.ts) | server | The pack `docs`: provides `docs.read` (`packs()`, `watch(on)`, `guide()`, `chapter(path)`), with items per kind (`graph.read`) and the newest run (`exchange.read`) |
| [files.ts](files.ts) | server | The guide's chapters from the files: `guide(root)` in order, `read(root, path)` one of them |
| [markdown.ts](markdown.ts) | both | Markdown into blocks (`parse`, `inline`, `chapter`), and where a link points (`resolve`, `slug`) |
| [tool.ts](tool.ts) | server | The pack `docs-tool`: the MCP tool `packs` (`mcp.host`), so agents read the same reference. No input: a line per pack; `pack`: its whole entry |
| [view.ts](view.ts) | page | The pack `docs`: the read-only Packs view (`#docs`) |
| [page.ts](page.ts) | page | A pack's own page: its sections, fills of `docs.page` |
| [cards.ts](cards.ts) | page | What the view shows: one card per folder, its counts, the lists, what uses what, a state in words, an action's input in words |
| [guide.ts](guide.ts) | page | The pack `guide`: the Guide view (`#guide`), and a section on each pack's page in Packs that opens its README |
| [prose.ts](prose.ts) | page | Markdown blocks drawn as Preact, never set as markup |

## The Packs view

Shaped like other apps' plugin lists (VS Code, Chrome, Obsidian, Home
Assistant, WordPress): a card is the line the pack declares and counts of
what it adds; details are a click away and problems show only when there
are any.

- **One card per pack as a person sees it:** the packs in one folder (a
  server half and a page half, a pack and its tool) are one card, named
  for the folder (`byFolder`). What uses what is read in each runtime
  before the halves join, so the page's bridge is no tie on the server.
- **What it is for** is the pack's own `about` (`Pack` in
  [runtime/core.ts](../../runtime/core.ts)), one plain sentence for a
  person. A test holds every pack in this repository to it.
- **Counts that open, live where they can be:** views (each opens its
  tab), parts of views, items of its kinds on the map (each kind opens the
  Map on it, through `find.query`), kinds of link, actions, nodes for
  agents (opens the sensory interface), what it did in the newest run (opens the
  run in the sensory interface, through `here.run`), and how many packs use it.
- **Lists:** needs attention (waiting or failed) first, only when there
  are any; then features; then the foundation, the packs that provide
  one of the spec's interfaces. Each by name. A pack added from outside
  this repository (the fiber's `source` isn't under its root) is tagged.
- **A pack's page** opens from its name (`docs.pack`, a `here` key): what
  it adds with counts, its actions and what each takes in words, where
  its nodes speak, the newest run, the packs it stands on and that use it,
  and its wiring last, folded.
- **Composable.** A card's title line is the slot `docs.card.head`, its
  body `docs.card`, a pack's page `docs.page`, all `many`; each fill gets
  `{ pack, all }`. This pack fills the body and the page. The on/off switch
  is the [switch pack](../switch/README.md)'s fill in the head.
- **Entries.** Each card holds its entries in each runtime's config tree
  (`entries`: id, side, off), read from `loader.tree`'s status by position,
  so a switch knows what to turn.

## The Guide

What a new person reads, from the files as the running server holds them,
so it can't drift from them (`docs.read.guide()`, `docs.read.chapter(path)`).

- **In order:** the path that [guide/README.md](../../guide/README.md)
  lists (what Archipelago is, first run, concepts, writing a pack,
  profiles and the harness, the spec), then the spec's contract docs in
  the order [spec/README.md](../../spec/README.md) links them, then every
  pack folder's README by name. Only those files can be read.
- **No walls of text:** a chapter's lead is open; each `##` section is
  folded to its first lines (one short paragraph starts open), and a click
  opens it. Contents are one line each; at 640 px or less they are one
  picker.
- **Links stay in the Guide:** a link to another chapter opens it at its
  heading (`guide.open`, a `here` key: `path#anchor`); one out of the
  repository opens a tab; another file of the repository is named, not
  opened.
- **Linked with Packs:** a pack's README opens its page in Packs
  (`docs.pack`); a pack's page there has a section, a fill of `docs.page`,
  that opens its README here.
- **Tested:** [test/guide.test.ts](../../test/guide.test.ts) holds the
  order, the Markdown read, and that every link in every chapter resolves,
  its heading included.

## How it reads

- **It only looks.** It reads the runtime it runs in (its fibers: a pack's
  `about`, `inject`, what it `provided()`, its state, config, `source`
  and child packs, and `loader.tree`'s status), and invokes no action. A fiber's state has no event,
  so `watch` also looks for a change every second (`config.every`); a
  change on the map or the exchange is told at most that often.
- **Reads are bounded:** one page of at most 100 items per kind (past it,
  `100+`), the newest run only, one page of its events.
- **Config is shown as it is** to agents, except functions (`ƒ`) and
  fields whose name says secret (`token`, `password`, `auth`, ...: `•••`).
- `docs.read` is the pack's own key, like `verdict.read`; the bridge serves
  it.
