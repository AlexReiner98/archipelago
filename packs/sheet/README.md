# Sheet

The sheet over the canvas, an item's one page. A root pack: its parts change
only through a root re-pin, never by the refiner, because what keeps a person
in control here stays protected (decision e_gyzm7rj3).

Its parts are the host's (e_gyzm7rj3: the frame, field editing, link picking
and settling stay the host's), so their code is in `page/`, loaded with the
page and pinned by this root's hash, not run in a worker (task e_zhxd9bhb):

| Part | Slot | Code |
|---|---|---|
| `sheet.frame` | `sheet` | `page/item.js`, `page/item-sections.js`, `page/screens.js` |
| `sheet.fields` | `sheet.fields` | `page/fields.js`, `page/field-edit.js` |
| `sheet.links` | `sheet.links` | `page/link-pick.js`, `page/item-links.js` |
| `sheet.draft` | `sheet.draft` | `page/draft.js`, `page/note-count.js` |
| `sheet.follow` | `sheet` (`reading`) | `page/sheet-follow.js` |

`sheet.frame` opens the three slots under it. Other packs' sections sit below
the fields and source and above history (e_axz9au5f), and the page carries two
menus, the part's and the frame's (e_dd7gdy8z); what is done rarely to the item
is the slot `item.menu`. What each slot hands a part is in `docs/packs.md`.

The app asks for what is here by name, never by file: `hooks.drawScreen` (a
screen on Home or a nav page) and `hooks.sheetAside` (the share of the page an
open sheet takes).

## Still to do

- A manifest form for a host part: `parts` holds worker parts only
  (`packs/loader/kernel/ui-parts.ts` wants modules entered at `index.js`), so
  these are named here, not in `pack.json`.
- `sheet.follow` as a worker part, once the runtime hands the sheet slot its
  `reading`: today the page measures the scroll itself.
