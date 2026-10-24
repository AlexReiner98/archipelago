# Glossary

One word for each idea, everywhere a person or an agent reads: the UI, tool
and view descriptions, the docs. The code may still use an older name (the
schema keeps its table names, and tools, JSON fields and pack ids are renamed
later, if at all); each entry says where the idea lives in the code. A check in
`npm test` counts the retired words in the UI and the tool text, and the
count only goes down.

## The words

**the map.** Everything a workspace holds: its items and the links between
them, with the log of how each came to be. The log is the truth; the items
and links a page reads are its projections. In the code: one workspace's
database (`src/schema.ts`).
Replaces *knowledge graph*.

**the log.** The workspace's record of every change, appended to and never
rewritten, from which everything read is projected (`docs/log.md`). It is a
set of **streams**: the fact stream holds each applied change as one
**entry**, a header (who, when, why, on whose authority, the rule that
decided it) and its **facts**, each one value of one field of one item or
link asserted or retracted; every entry carries the hash of the one before.
The pending stream holds held changes; the operational streams (sessions,
claims, notifications, settings and the like) are kept by their pack's
retention rules. A **projection** is a table kept current from the log in
the same transaction: items, links, the review queue, the part_of closure.
In the code: `log_entry`, `log_fact` and `log_op`, appended in `src/log.ts`,
projected in `src/replay.ts`. Replaces *event log* for the record of
changes; an *event* is still what a pack's handler hears.

**item.** One thing on the map: a task, a person, a decision, a document, a
view. It is a small **head** and its fields. The head is what the store needs
to hold any item: id, kind, type, title, body (its note), visibility, and when
it was made, changed and archived. Everything else is a field its kind or type
declares (`src/head.ts`). In the code: a row of the `entity` table, `Entity`
in `src/pelago.ts`, read with `get`. Replaces *entity*.

**link.** A typed tie from one item to another: `depends_on`, `part_of`,
`waits_on`. In the code: a row of the `relation` table, projected from the
log's facts about the link (`r_…`); link types are a pack's `links`, the
roots in `packs/core/pack.json`. Replaces *relation* (still the name of the
table and of the `relation` field that identifies a link in `unlink`).

**kind.** One of the seven broad sorts every type belongs to: actor, aim,
work, question, record, occurrence, place. The kernel reasons by kind, never
by a pack's type. In the code: the core pack's root types; a type's `kind`, as the
registry gives it (`reg.type(id).kind`, `src/packs.ts`), and an item's, kept
in its row (`entity.kind`), read without walking the type's ancestry. A kind
is never a fact in the log: it is read from the type.

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
also called views; one declared with a `lens` is a **lens preset**,
answered by the lens query like any view on the map.

**drawing.** The code that draws one form of view (list, flow, grid, time,
architecture): shipped by a pack (`drawings` in its pack file), run in the
sandbox (`ui/draw.html`), answering with marks the page checks
(`docs/drawings.md`). Replaces *shape* where a shape meant this; the field
that names it is still `shape`.

**pack.** A folder under `packs/` with a `pack.json`, its manifest of
fifteen keys (`docs/packs.md`): the types, links, rules, views, actions,
handlers, drawings and styles of one way of working, and what it may reach.
Which packs a workspace has is a fact in its log. In the code:
`src/manifest.ts` reads a manifest, `src/packs.ts` loads them. Replaces
*type pack*; a pack whose reach includes `server` is still a pack.

**change.** A set of ops (create, update, link, unlink, archive, restore,
merge, define_type, forget) sent with a reason and an authority, applied
whole or held for a person as a proposal. The one way to write the map. In
the code: `Archipelago.change` in `src/pelago.ts`, the `change` tool; once
applied it is a change set, one entry in the log, which `undo` reverses with
an entry of its own. A **forget** is the one change that cannot be undone:
it destroys the item's key, so what it said is gone from the log, the
projections and every backup that needs that key.

**rule.** A condition, kept as data in a pack file, that decides whether a
change applies, waits for a person or is refused: the only thing that does.
It reads who acts, which op, kind, type, capability or fields, the change of
status and the visibility, and answers hold, refuse or the fields it
requires. One the pack declares liftable names the workspace setting that
lifts it (`lifted`); a setting does nothing else. A held change names the
rule that held it. The kernel's own (an agent's change waits, settling a
question, code that runs, publishing, backups, forgetting, a pack writing
outside its reach) are core's. A rule with a `stream` and a `keep` instead
is a **retention rule**: it says which facts go to an operational stream and
how long that stream keeps them (`src/retention.ts`). In the code: `rules` in
a pack file, `RuleDef` and `decide` in `src/rules.ts`.

## Retired words

| Retired | Say |
| --- | --- |
| entity | item |
| relation | link (a link type, for its kind of tie) |
| knowledge graph | the map |
| type pack | pack |
| picture, where it means a view | view |
| shape, where it means a drawing | drawing |
