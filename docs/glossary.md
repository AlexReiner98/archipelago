# Glossary

One word for each idea, everywhere a person or an agent reads: the UI, tool
and view descriptions, the docs. The code may still use an older name (the
schema keeps its table names, and tools, JSON fields and pack ids are renamed
later, if at all); each entry says where the idea lives in the code. A check in
`npm test` counts the retired words in the UI and the tool text, and the
count only goes down.

## The words

**the map.** Everything a workspace holds: its items and the links between
them, with the log of how each came to be. In the code: one workspace's rows
in the `entity`, `relation` and `event` tables (`src/schema.ts`).
Replaces *knowledge graph*.

**item.** One thing on the map: a task, a person, a decision, a document, a
view. It is a small **head** and its fields. The head is what the store needs
to hold any item: id, kind, type, title, body (its note), visibility, and when
it was made, changed and archived. Everything else is a field its kind or type
declares (`src/head.ts`). In the code: a row of the `entity` table, `Entity`
in `src/pelago.ts`, read with `get`. Replaces *entity*.

**link.** A typed tie from one item to another: `depends_on`, `part_of`,
`waits_on`. In the code: a row of the `relation` table; link types are a
pack's `relations`, the roots in `packs/core/pack.json`. Replaces *relation*
(still the name of the table, of a pack file's key and of the `relation`
field that identifies a link in `unlink`).

**kind.** One of the seven broad sorts every type belongs to: actor, aim,
work, question, record, occurrence, place. The kernel reasons by kind, never
by a pack's type. In the code: the core pack's root types; a type's `kind`, as the
registry gives it (`reg.type(id).kind`, `src/packs.ts`), and an item's, kept
in its row (`entity.kind`), read without walking the type's ancestry.

**type.** What an item is within its kind (`work.task`, `software.repo`),
with its statuses and fields. Declared in a pack file's `types`, or by a
workspace with `define_type`. In the code: `TypeDef` in `src/packs.ts`.
A flavour is a type that extends another.

**field.** A named value an item holds, declared by its kind or type: a due
date, an outcome, a url. Every field written is checked against its
declaration; one the type does not declare is refused. In the code: the item's
`props`, checked against `FieldDef` (`src/fields.ts`). Also *prop* in the JSON.
Four fields the kinds declare are kept in columns of the row, not in props, so
the store can index them and row-level security read them: status (with
`is_open`), owner, confidence and source (`"column": true` in
`packs/core/pack.json`). A kind that does not declare one has none: a person
has no owner, a view no confidence. A value longer than 4000 characters is
refused unless its field is declared `"large": true`, which only a type of the
system kind may do: a drawing's code, a story's steps, a stylesheet.

**view.** A named way of looking at part of the map: a **lens** (what is in
it: which kinds, from where, how far, along which links; `src/lens.ts`)
drawn in a **style** (how it looks; `src/styles.ts`). Both are items, so a
view is kept on the map and changed like anything else. Replaces *picture*
where a picture meant this (an *image* is a picture file, such as a test's
screenshot). The read tools a pack declares (`views` in a pack file) are
also called views.

**drawing.** The code that draws one form of view (list, flow, grid, time,
architecture): shipped by a pack (`drawings` in its pack file), run in the
sandbox (`ui/draw.html`), answering with marks the page checks
(`docs/drawings.md`). Replaces *shape* where a shape meant this; the field
that names it is still `shape`.

**pack.** A folder under `packs/` with a `pack.json`: the types, links,
rules, views, drawings and styles of one way of working, and any code it runs.
In the code: `src/packs.ts` loads them, `packs` lists them. Replaces *type
pack*; a pack granted server reach is still a pack.

**change.** A set of ops (create, update, link, unlink, archive, restore,
merge, define_type) sent with a reason and an authority, applied whole or
held for a person as a proposal. The one way to write the map. In the code:
`Archipelago.change` in `src/pelago.ts`, the `change` tool; once applied it is
a change set, which `undo` reverses.

**rule.** A condition, kept as data in a pack file, that decides whether a
change applies, waits for a person or is refused: the only thing that does.
It reads who acts, which op, kind, type, capability or fields, the change of
status and the visibility, and answers hold, refuse or the fields it
requires. One the pack declares liftable names the workspace setting that
lifts it (`lifted`); a setting does nothing else. A held change names the
rule that held it. The kernel's own (an agent's change waits, settling a
question, code that runs, publishing, backups) are core's. In the code:
`rules` in a pack file, `RuleDef` and `decide` in `src/rules.ts`.

## Retired words

| Retired | Say |
| --- | --- |
| entity | item |
| relation | link (a link type, for its kind of tie) |
| knowledge graph | the map |
| type pack | pack |
| picture, where it means a view | view |
| shape, where it means a drawing | drawing |
