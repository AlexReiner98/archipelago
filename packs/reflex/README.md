# reflex

The reflex tree: every node the map says to agents, as one circular tree
grown from its root, lit live as the agent works. Fills `shell.main` as the
view "Reflex tree", beside Harness and Map. The design is the old repo's
reflex_view pack and its lens "Reflex tree": its sizes and numbers are
`STYLE` in layout.ts, its colours and hues the style's tokens
(spec/style.md).

- **Shape** (layout.ts, pure, tested in test/reflex.test.ts). Every node in
  `agent.tree` hangs under one root, at its first place:
  - tool, then the MCP server, then the tool;
  - file, then its glob's top two folders;
  - memory, then its scope;
  - skill, then each part of its name;
  - session start, prompt and reply end, each a bough of its own.

  "By pack" hangs it from its pack and then its kind. Nodes said nowhere
  (`at: []`) are left out until "show never said". Each subtree gets a
  share of the circle by its leaves, a ring out a level, wider than tall.
  The ring grows until leaves' names clear each other.
- **Live** (`exchange.watch`, every run). A say runs a blue light from the
  root to its node, and a refusal a red one. An act sparks amber on the
  deepest bough of its place, or red when it failed. "Replay" plays the
  run shown again. Under reduced motion only the names light.
- **Marks.** A dot has its pack's hue: the map's words purple, what grow
  learned gold, the other packs the lens's hues. It is hollow while its
  item is a trial. A ring gives its verdict in the run shown
  (`verdict.read`): blue held, red failed, dashed grey quiet. The run is
  `here.run`, else the newest.
- **Linked.** A click on a node sets `here.node`: its way from the root
  lights, a card shows it, and the harness view opens on it. Drag to move,
  wheel to zoom, double-click to fit.
- It only shows; it invokes no action. It injects `slot.fill`, `here.*`,
  `agent.tree`, `exchange.read`, `exchange.watch`, `verdict.read`,
  `graph.read` and `graph.watch`. Unloading it removes the view and its
  styles.
