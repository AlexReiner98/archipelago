# Bar

Find's input in the bar and the terms it is made of. A root pack: its parts
change only through a root re-pin, never by the refiner.

| Part | Slot | Code |
|---|---|---|
| `bar.query` | `bar.find` | `parts/query/line.js` |
| `bar.rows` | `bar.find.rows` | `parts/query/rows.js` |

Both were `ui/query-bar.js` and the modules beside it (`query-light`,
`lit-by`, `term-kinds`, `term-pick`, `picker-rank`, `only-words`), gone from
`ui/` on 13 Nov 2026 (task e_yxkdcdh6).

## The line and the rows

`bar.query` says the lens in one line in find: each part by its word and as
many of its terms as fit (the host counts the rest), a term of Find lighting
what it brought on the canvas, the walk's steps never cut, and how many are
drawn. A press on it opens find, and while find is open `bar.rows` draws a
row for each part above it (Find, Only, Not, Walk, the limit). A term's ×
takes it out; a row's count of what did not fit shows them all; a row's + is
a menu of kinds, then the things of that kind, those used here first. Each
step that leads on is a pick, so the menu stays open; the last step's
choices are buttons. Every change is a new lens the part names as the page's
address (`go`).

- `bar.js`: what both draw, and what each gesture does (`heard`).
- `line.js`, `rows.js`: each part, drawing with `bar.js`.
- `terms.js`: a term's sort and words, a term added or taken out.
- `kinds.js`: the kinds a term is made from, as steps.
- `rank.js`, `lit-by.js`, `only-words.js`: what is offered first, what a
  term brought, Only's plain words.

Each is handed what the query slots hand (`docs/packs.md`): the canvas's
lens (Home's when no query is up), the answer in brief, the names of the
items the lens names; and the schema's words and the style's numbers.

## What stays the host's

The band over the canvas (the `bar` frame slot) and the lens in words that
the page's own modules ask for by name (`hooks.lensSaid`, `hooks.fitBar`,
`hooks.lights`) are `packs/surface/page/bar-band.js`; the canvas mounts the
two parts (`packs/surface/page/canvas.js`).

Find's choices are the find pack's, and the layout a view is drawn in is the
slot `bar.layouts`.
