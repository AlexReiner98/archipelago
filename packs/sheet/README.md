# Sheet

The sheet over the canvas, an item's one page. A root pack: its parts change
only through a root re-pin, never by the refiner, because what keeps a person
in control here stays protected (decision e_gyzm7rj3).

Its parts, to be declared here with their code (task e_zhxd9bhb):

| Part | Slot | From |
|---|---|---|
| `sheet.frame` | `sheet` | `ui/item.js`, `ui/item-sections.js`, `ui/screens.js` |
| `sheet.fields` | `sheet.fields` | `ui/fields.js`, `ui/field-edit.js` |
| `sheet.links` | `sheet.links` | `ui/link-pick.js`, `ui/item-links.js` |
| `sheet.draft` | `sheet.draft` | `ui/draft.js`, `ui/note-count.js` |

`sheet.frame` opens the three slots under it. Other packs' sections sit below
the fields and above history (e_axz9au5f), and the page carries two menus, the
part's and the frame's (e_dd7gdy8z); what is done rarely to the item is the
slot `item.menu`. What each slot hands a part is in `docs/packs.md`.
