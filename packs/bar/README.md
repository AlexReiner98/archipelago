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
answer (`answer`: items and links) it ranks by what is used here and says
what each term brought; where it hands `names` (titles of the ids the lens
names) it names those items.

## Waiting on the runtime

The old modules stay in `ui/` until the runtime carries what they did that a
part cannot: the lens algebra other modules import (`added`, `filterSaid`),
the slot drawn in place of `drawQuery`, the answer handed to `bar.find`,
lighting what a term brought on the canvas, a row that fits, and a stepped
picker. Until then the picker is drawn inline in its row.

Find's choices are the find pack's, and the layout a view is drawn in is the
slot `bar.layouts`. What each slot hands a part is in `docs/packs.md`.
