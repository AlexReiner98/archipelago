# views

A view is one item holding a whole arrangement of the page. Pick one and
the page changes to it; nothing is written, so picking is looking.

```
view item ─▶ center (here.view) + settings (here keys) + arrange (slot.arrange) ─▶ the page
```

| File | Runs | What it is |
|---|---|---|
| [pick.ts](pick.ts) | both | The flavour `view`, and the list: home, tabs, sections, search |
| [apply.ts](apply.ts) | page | Shows a view, taking the last one back |
| [index.ts](index.ts) | server | Defines the flavour. Injects `types.define` |
| [view.ts](view.ts) | page | The picker. Injects `slot.fill`, `slot.read`, `slot.arrange`, `here.*`, `find.index` |

## A view item

The flavour `view` (base record). An agent makes one with `items.create`
and takes it back with `history.undo`.

| Field | Holds |
|---|---|
| `center` | The fill in center, `pack/name` (`map/map`, `field/field`) |
| `here` | Settings: `here` keys set while it shows (`{ "find.query": "in:i_…" }`) |
| `arrange` | Fill to a region, a slot or `"off"`, laid over the page's while it shows |
| `tags` | Words: `home`, `pinned` |

A view whose center fill isn't loaded is left out. Leaving a view clears
the settings it set that the next one doesn't.

## Seeded: one view per kind

Every fill in center is a view with no item, titled by the fill, with the
id `map` (its pack), or `pack/name` when a pack has two. Config names the
home kind (`home`, default `field`) and the kinds listed next (`pinned`).

## Home

The one view tagged `home` opens first and tops the list: the newest view
item tagged `home`, else the home kind. The page has no home page of its
own.

## The picker

- **One picker** in `top`, and no tabs: the title of the view shown, with
  ▾. It opens the list. The bar stays the same however many views there
  are (21 Nov 2026).
- **The list** in `over`: home first, then views tagged `pinned`, then the kinds, then
  a section for each item views are `part_of`, by its title. Typing
  filters by title and section; arrows move, Enter picks, Esc closes.
- **Ctrl+K** is the command line's: the views are offered there through
  find's `find.offer`, beside the items, so one key goes to either (21 Nov
  2026).
- **The hash** names the view shown (`#map`, `#i_…`), so a link opens it.
  An older `#map/map` link opens that kind.
- **A view whose pack reloads** (a hot update, a pack switched off and on)
  is gone for a moment: it stays picked with its hash, and shows again as
  soon as its fill does. Only if it is still gone after 2 s does home stand
  in, the hash kept, so a reload opens it. Picking another view drops it.
- **Opening on a view not loaded yet** (`firstView`): the page waits up to
  3 s for the hash's view, as its pack may load after home's. If it is
  still not there, home stands in and the hash's view is held the same
  way: the hash is kept, and the view shows as soon as its pack loads. The
  hash is never dropped for home.
- **`here.view`** set by something else (an agent, a panel) shows the
  view of that kind; not while the shown view's own fill is gone, when the
  frame is only standing another fill in for it. `views.view` (page) says which view shows.
- **A picked view fades in** ([fade.ts](fade.ts)) through the page's own
  ground: a cover of the background colour fades in over half of
  `switch_ms` (450), the view changes under it and lays itself out for
  `switch_wait_ms` (200), and the cover fades away over the other half. The
  old view and the new are never drawn over each other, and the new one's
  first unsettled frames are never seen. Both are the pack's config;
  `switch_ms: 0` or reduced motion changes it at once. The list itself fades
  in over 200 ms and goes under the cover with the view it was over.
