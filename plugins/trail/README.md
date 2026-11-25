# trail

One run opened into a graph of its own, for the Landscape to draw beside the
map: its turns in order, each turn's tool calls, and the nodes the map said
in it. Each tool call carries the ids its input and output name, so the
Landscape links it to the items on the map it touched. Proposed in
[#22](https://github.com/AlexReiner98/archipelago/issues/22).

A run is not an item on the map, and neither is its trail. This plugin reads
the run's events from `exchange.read`, then follows them on `exchange.watch`,
and keeps the answer in the page key `trail.graph`, as
`{ run, title, earlier, turns }`. It writes nothing to the map.

## Which run

The run in focus: `here.run`, whoever set it (the Context interface, a run
picked in Activity). A click on a session's pentagon on the Landscape sets
`here.run` to that session's run. With no run in focus, there is no trail.

## What a trail holds

| Part | From |
|---|---|
| A turn | each `prompt` act, up to the next; what came before the first prompt is `start` |
| A tool call | each `tool` act: the tool's short name (`query`, `act items.set`, `Bash`), whether it was `ok`, and up to 20 ids its input and output name |
| A decision | a person allowed or denied a tool call: drawn as an act (`denied Bash`), an approval, never a decision about the work |
| A said node | each `say`, `refuse` and `gated` event in the turn, once per node and kind, with a count |

## Rules

- **A projection, not a record.** Every trail is made again from the exchange
  when a run is opened. Deleting the plugin loses nothing.
- **No text.** Only tool names, node names and ids are kept, never what was
  said or done.
- **Bounded.** Events are read a page at a time (`LIMIT_MAX`), at most
  `TRAIL_PAGES` (40) pages, and the latest `TRAIL_LIMIT` (400) are kept.
  What came before them is one count, `earlier`.
- **Live.** A live run's new events are added as they come, and the trail is
  set again at most every half second.
- **Picking.** A click on a tool call that touched items on the map goes to
  the first of them (`here.item`), so the panels follow.
- **Revertible.** Turning the plugin off clears `trail.graph`, and the
  Landscape is as it was.

How the Landscape draws it, as ghosts that nothing on the map links to, is in
[field](../field/README.md).

Tests: [test/trail.test.ts](../../test/trail.test.ts).
