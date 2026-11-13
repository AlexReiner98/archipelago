# Bar

Find's input in the bar and the terms it is made of. A root pack: its parts
change only through a root re-pin, never by the refiner.

| Part | Slot | Code | Was |
|---|---|---|---|
| `bar.query` | `bar.find` | `parts/query/` | `ui/query-bar.js`, `ui/query-light.js`, `ui/lit-by.js`, `ui/term-kinds.js`, `ui/term-pick.js`, `ui/picker-rank.js`, `ui/only-words.js` |

## bar.query

The lens the canvas draws, said in one line; pressed, a row for each of its
parts (Find, Only, Not, Walk, the limit). A term's × takes it out; a row's +
offers its kinds, then the things of that kind, those used here first. Every
change is a new lens the part names as the page's address (`go`).

- `index.js`: the part: what it draws, and what each gesture does (`heard`).
- `terms.js`: a term's sort and words, the lens in words, a term added or taken out.
- `kinds.js`: the kinds a term is made from, as steps.
- `rank.js`, `lit-by.js`, `only-words.js`: what is offered first, what a
  term brought, Only's plain words.

It is handed the page's address (the lens, how many were drawn), the
schema's words and the style's numbers. Where the host also hands the
answer (`answer`: items and links) it ranks by what is used here and a term
of Find lights what it brought (`lights`); where it hands `names` (titles
of the ids the lens names) it names those items. A row's terms are as many
as fit (`fits`). A row's + is a menu: each step that leads on is a pick, so
the menu stays open, and the last step's choices are buttons.

## Waiting on the runtime

The old modules stay in `ui/` until the runtime takes the lens algebra
other modules import (`added`, `filterSaid`, task e_926g89jb), splits the
band from `drawQuery` and fills `bar.find` with this part, hands the
answer, the names and the rows' slot (e_gaa2ubge), and takes the lighting
`lights` asks for (`hooks.lights`, set in `ui/query-light.js` for now) with
the canvas's view.

Find's choices are the find pack's, and the layout a view is drawn in is the
slot `bar.layouts`. What each slot hands a part is in `docs/packs.md`.
