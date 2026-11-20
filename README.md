# Archipelago (next)

Software that agents and people build together, live, out of interchangeable
packs, around a shared map of the work.

- **Everything is a pack**: the graph, the schema, the UI and the learning
  loop. Packs join, leave and reload while the system runs, and when a pack
  leaves, every trace of it goes too, its UI included. The runtime follows
  [Cordis](https://arxiv.org/abs/2608.25512): revertible effects and reactive
  dependencies.
- **The contracts are the product.** Any pack can be replaced. The interfaces
  packs talk through (`agent`, `graph`, `slot`, `here`) are versioned and owned
  by the spec.
- **No gates.** Every change applies at once, and anything can be undone.
- **The map teaches the harness.** Everything the map says to an agent, and
  what the agent does in return, is recorded and judged. What works is kept
  and what doesn't is retired, through packs that a person and an agent refine
  together.

## Status

Early. The first build is a live **harness view** for Claude Code sessions. It
shows what is said to the agent, where it was said, by which pack, and whether
it worked.

## Licence

MIT
