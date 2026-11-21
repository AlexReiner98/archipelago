# loader

The config tree as a capability. Edition 7. Types: [loader.ts](loader.ts).

| Key | Gives |
|---|---|
| `loader.tree` | The tree now and as it started, each entry's state, edits, a watch |

The kernel's loader provides it, in each runtime: the page's and the
server's. In Cordis the loader is a plugin too, so packs can edit the tree
the same way the host does.

- **`base()`** is the tree the host started with: `app/boot.ts` on the page.
  It's the template a person's changes lie over.
- **`edit(change)`** applies a new tree. Each fiber changes the least it can:
  a pack turned off unloads, a new config reloads it, a move only reorders.
- Injecting it means trusting the pack with every other pack. A UI never
  edits through it directly: a person's change is an action (`page.set`),
  which writes an item, and the `page` pack applies that item
  ([packs/page](../packs/page/README.md)). That way the change is journaled
  and undone like any other.
