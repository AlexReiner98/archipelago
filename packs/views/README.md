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
home kind (`home`, default `map`) and the kinds that are tabs (`pinned`).

## Home

The one view tagged `home` opens first and tops the list: the newest view
item tagged `home`, else the home kind. The page has no home page of its
own.

## The picker

- **Tabs** in `top`: home, then the pinned (at most five), then the view
  shown if it isn't one. "Views" opens the list.
- **The list** in `over`: home and the pinned first, then the kinds, then
  a section for each item views are `part_of`, by its title. Typing
  filters by title and section. **Ctrl+K** opens it; arrows move, Enter
  picks, Esc closes.
- **The hash** names the view shown (`#map`, `#i_…`), so a link opens it.
  An older `#map/map` link opens that kind.
- **`here.view`** set by something else (an agent, a panel) shows the
  view of that kind. `views.view` (page) says which view shows.
