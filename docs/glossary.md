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
log's facts about the link (`r_…`); link types are a pack's `links`, each a
flavour of one of core's roots (`packs/core/pack.json`), the meanings the
kernel reads. `link` is the plain wire, drawn before a meaning is known:
nothing is a flavour of it. Replaces *relation* (still the name of the
table and of the `relation` field that identifies a link in `unlink`).

**kind.** One of the seven broad sorts every type belongs to: actor, aim,
work, question, record, occurrence, place. The kernel reasons by kind, never
by a pack's type. In the code: the core pack's root types; a type's `kind`, as the
registry gives it (`reg.type(id).kind`, `src/packs.ts`), and an item's, kept
in its row (`entity.kind`), read without walking the type's ancestry. A kind
is never a fact in the log: it is read from the type.

**type.** What an item is within its kind (`task`, `repo`),
with its statuses and fields. A pack ships its types as presets; a type is
also an item on the map, of core's `type` (a link type, of `link_type`):
one with a preset's id is the owner's version of it (its title, note and
added fields over the preset's; retired, no new item is made of it), one
with a name and no preset is the workspace's own, `local.<name>`. In the
code: `TypeDef` in `src/packs.ts`, the items laid over the packs in
`src/type-overlay.ts`. A flavour is a type that extends another.

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
it: a filter, of terms that add seeds and terms that must all hold of them,
a walk along links and a limit; `src/lens-flat.ts`)
drawn in a **style** (how it looks; `src/styles.ts`). Both are items, so a
view is kept on the map and changed like anything else. Replaces *picture*
where a picture meant this (an *image* is a picture file, such as a test's
screenshot). The read tools a pack declares (`views` in a pack file) are
also called views; one declared with a `lens` is answered by a read of the
kernel's that it names (the flat lens, the graph, the tree, attention...).

**theme.** A style's colours (its `theme` field): a few given, the rest
worked out from them as data (a mix, or a contrast held), finished on the
server so every page and agent reads the same (`src/colours.ts`). A theme a
pack ships is a style preset used once the owner keeps a version of it; a
person's own is a style kept about their person item, read last on the pages
they see. A published page keeps the colours it was published with.

**drawing.** The code that draws one form of view (list, flow, grid, time,
architecture): shipped by a pack (`drawings` in its pack file), run in the
sandbox (`ui/draw.html`), answering with marks the page checks
(`docs/drawings.md`). Replaces *shape* where a shape meant this; the field
that names it is still `shape`.

**Find, Only, Not, Walk, Limit.** The parts of a lens, by the words the
query bar and an agent's answer give them (decision e_drt4g872). **Find** is
what adds: words, a type, a tag, a link and its end, an item, in an item
(all that is part of it, at any depth); any of them (the find bar's words
are one Find term). **Only** is what must all hold of what Find finds: a
type, or within an item. **Not** is what is left out of everything but an
item named: closed, system, or a type. **Walk** is the links followed from
what Find finds, each out (→), in (←) or either way (↔), ×steps. **Limit**
is the most items drawn, said as how many of it. In the code: the filter's
`text`, `types`, `ids`, `links`, `in`; `only`, `within`; `exclude`; `walk`;
`limit` (`src/lens-flat.ts`). Replaces *search*, *nodes* and *edges* where
the bar meant these.

**canvas.** The page's one flat plane, where every item a lens reaches is a
node and every link a wire; depth is never drawn (`docs/canvas.md`). A
**saved canvas** is a lens and a style kept on the map, listed on Home. In
the code: `ui/canvas.js`; a saved canvas is an item of core's system type
`lens` (`src/lens-saved.ts`, `ui/canvases.js`).

**sheet.** The panel that opens over the canvas from the side, holding one
item's page (or a new item, the Workspace page, a screen, For you). In the
code: `#sheet` in `ui/index.html`, routed by `ui/app.js`.

**tag.** What items belong with, named in a word or two: an item of core's
`tag` type, tied by a `tagged` link, any number to an item. A lens filters by
one (`tagged <tag>`); the house style draws no wire for it.

**place.** Where a person put an item on a canvas: one per canvas and item,
kept in the places stream, never an item or a link, and never meaning
anything. In the code: `src/canvas-places.ts`, `places` and `places_put`.

**ghost.** A held change drawn where it would land on the canvas: a faint
node, a dashed wire, a badge. In the code: `ui/ghosts.js`.

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

**instruction.** What an agent is told, as an item: as a style is how things
look, an instruction is what an agent is asked to do. A pack ships it as a
preset; one kept on the map with the preset's id is the owner's version of
it, and one kept about a repository is said only there. Its `for` says where
it is said (session start, the rules file a project is handed, a tool's
description). In the code: core's `instruction` type, `src/instructions.ts`,
`src/working-rules.ts` (`docs/agents.md`).

**reply.** What an agent did between the owner's message and the moment it
stops: how many times it read and surveyed the map, showed the owner
something, changed the map, edited a file, committed and pushed, as its
session's hook counts them from the transcript. A rule with `on:
"reply_ended"` reads those (and one fact of the map, which of the reply's
commits are unaccounted for) and asks the agent, once a turn, to go on
before it stops; it never decides a change. The owner turns one off with
its switch on the Workspace page's Checks card. In the code:
`src/reply-rules.ts`, `src/replies.ts`, `src/commits.ts`.

**run trailer.** The line `Archipelago-Run: <run>` at the end of a commit a
session makes, naming the run it is registered as, so the commit can be
traced to its session. Added by the commit-msg hook the setup installs. In
the code: `scripts/pelago-setup.mjs`, read by `packs/github/account.js`.

**accounted for.** A commit is accounted for once the map holds a commit item
for its full sha, with a settles link to each item it settles, or none. The
check "Every commit accounted for" on the main branch is red until every
commit in a push or pull request is; a session is asked to account for
its own commits before its reply and its run end. A pushed commit nobody
accounted for within an hour is made a commit item with `accounted` false,
which is the owner's attention (reason `unaccounted`) until someone sets it
true with its links. In the code: `commit` and
`settles` (`packs/software/pack.json`), `packs/github/account.js`.

## Retired words

| Retired | Say |
| --- | --- |
| entity | item |
| relation | link (a link type, for its kind of tie) |
| knowledge graph | the map |
| type pack | pack |
| picture, where it means a view | view |
| shape, where it means a drawing | drawing |
| search, nodes, edges, where the query bar meant a part of a lens | Find, Only, Not, Walk |
