# document

The Document view: a part of the map read top to bottom as one page. For
someone who wants to read a plan, not walk a graph: each section an item
with its note, what is part of it nested beneath, work as a checklist.

| File | Runs | What it is |
|---|---|---|
| [outline.ts](outline.ts) | both | What goes where, in what order: pure, rows and links in, an outline out |
| [marks.ts](marks.ts) | page | Each item's mark, by the spec's rule (spec/style.md): shape from the base, side from the status |
| [index.ts](index.ts) | page | The view `Document` in `center`. Injects `find.index`, `here.*`, `slot.fill` |

## What it reads

- **The sections** are a view's `document.sections` (item ids, in order),
  a `here` key this plugin declares; without them, the items its query
  (`find.query`) finds that are part of none of the others.
- **Under each item,** what is `part_of` it, at any depth, each once.
  Siblings keep the order found, except that one comes after what it
  `depends_on`.
- **Read once.** A part whose title is a heading of its holder's note
  (the note's `## Week 1 — set up` and the part "Launch — Week 1 — set
  up") was split out of that note: the note reads it, in its own
  order, and the part is left out. A title cut at 60 characters still
  matches the heading it begins.
- **What holds now.** A closed item that is not work (a superseded
  record) is left out, with what is under it. Work stays, done or not.
- **Work is one line:** its title, or, where the title is its note's first
  paragraph cut short, that paragraph whole. The rest of its note is on its
  page.

## A view of it

A view item (plugins/views) with `center: "document/document"` and, in its
`here`, `document.sections`. Notes show whole: nothing folds, since a
document is read through. A note's pictures (images in Markdown,
plugins/item/README.md) draw at the page's width with their caption, and
print with it, each kept on one page. A title opens its item (`here.item`); the
contents line at the top jumps to a section. Printed, it is the document
alone.
