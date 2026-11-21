# harness

The harness view: what the map says to an agent, what the agent does, and
whether each thing said works. Fills `shell.main` with three panes, linked
through `here`.

| Pane | Shows |
|---|---|
| Tree | Every node in `agent.tree`, by place or by pack; its mark in the run looked at, and how often it was said |
| Run | One run live: map → agent on the left, agent → map on the right, one line per event |
| Node | Its words, places, pack, kind, record, and its verdict per run |

Marks (the style's verdict glyphs, spec/style.md): ✓ held, ✕ failed,
○ quiet, · not said; ⊘ a refusal, ● an act, ✕ an
act that didn't work. A red edge on an event: it failed the node picked.

- A click on a node sets `here.node`; the run lights its firings. A click on
  an event sets `here.event` and `here.node`; the tree lights its node. The
  run is `here.run`, or the newest.
- A node made from a map item (`source`) has its words edited here, through
  `words.set`, when something provides it; the next say uses them. Any other
  node shows what it last said.
- Injects `slot.fill`, `here.*`, `agent.tree`, `exchange.read`,
  `exchange.watch`, `verdict.read`, `action.list`, `action.invoke`,
  `graph.read`, `graph.watch`. Unloading it removes the view and its styles.
