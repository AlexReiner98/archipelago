# loader

The config tree as a capability. Edition 7. Types: [loader.ts](loader.ts).

| Key | Gives |
|---|---|
| `loader.tree` | The tree now and as it started, each entry's state, edits, a watch |

The kernel's loader provides it, in each runtime: the page's and the
server's. In Cordis the loader is a plugin too, so plugins can edit the tree
the same way the host does.

- **`base()`** is the tree the host started with: `app/boot.ts` on the page.
  It's the template a person's changes lie over.
- **`edit(change)`** applies a new tree. Each fiber changes the least it can:
  a plugin turned off unloads, a new config reloads it, a move only reorders.
  `change` gets the tree copied entry by entry with configs shared (a
  server's config holds functions, which can't be cloned): give an entry a
  new config rather than change one in place.
- Injecting it means trusting the plugin with every other plugin. A UI never
  edits through it directly: a person's change is an action (`page.set`,
  or `switch.set` for both runtimes), which writes an item, and a plugin
  applies that item ([plugins/page](../plugins/page/README.md),
  [plugins/switch](../plugins/switch/README.md)). That way the change is journaled
  and undone like any other.
