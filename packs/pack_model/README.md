# Packs on the map

A pack is an item, and everything it declares is an item `part_of` it. Pack
files are how a pack ships and how a map begins; once installed, the map holds
the pack, and the registry is read from those items (feature e_k8nqby7n, the
owner, 19 Nov 2026). This file is the contract the registry (e_678v4axv),
install and upgrade (e_matgkkrt) and the floor (e_9skmrrnm) build on.

## Where the types live

The part types are **core's**, not this pack's: the kernel reads them, and the
kernel names no pack but core. Core already had `pack`, `type`, `link_type`,
`instruction` (and `reflex`, a flavour), `style`, `lens`, `layout`, `part`,
`screen` and `automation`; it now also has `rule` and `view`, and every part
type carries the fields below. This pack is an island pack, words only: it
keeps the ties between parts (`requires`, `flavour_of`, `stands_over`) and a view of
a pack's parts. Nothing the kernel decides reads these links: each is drawn
from a field that stays the truth.

## The pack item

| Field | Holds |
|---|---|
| title, note | The pack file's `title` and `description`. |
| `name` | The pack's id (`core`, `build`, `reflex`). |
| `version` | The file's `version`. |
| `manifest` | What the file declares that is no part: `id`, `version`, `requires`, `uses`, `actions`, `handlers`, `reach`, `kernel`, `app`, `shared`, `moved_from`. Every key that makes parts is left out (below). |
| `shipped` | `{ pack, version, hash, value }` of the file as a whole, `value` the manifest as above. |
| `runs` | Its code, `[{ path, hash }]`: `handler.js`, a kernel pack's modules, by path from the repository's root. |

A pack kept on the map with no file (core's "Kept as an item") has no
`shipped`; its parts are items as any other's.

## A part

Every declaration of a pack is one item, `part_of` its pack's item.

| Manifest key | Part type | Where its value goes |
|---|---|---|
| `types` | `type` | `spec` |
| `types`, an entry `{ of, fields }` | `type` | `spec`; `declares` is `of:<type>` |
| `links` | `link_type` | `spec` |
| `rules` | `rule` | `spec` |
| `views`, `form: "screen"` | `screen` | its own fields (`pieces`, `on`, `nav`, `home`) |
| `views`, any other | `view` | `spec` |
| `styles`, `type: "instruction"` | `instruction` | its own fields (`for`, `order`, ...); `body` the note |
| `styles`, `type: "lens"` | `lens` | its own fields (`filter`, `walk`, ...) |
| `styles`, a look | `style` | its own fields |
| `layouts` | `layout` | its own fields; the code by `runs` |
| `parts` | `part` | its own fields (`slot`, `reads`, `sends`, `opens`); the modules by `runs` |
| (none yet) | `automation` | its own fields |

Two families, then: a kind the map already held as items keeps its value in
its own fields, as today; a kind that lived only in files (type, link type,
rule, view) keeps it in `spec`, the declaration whole but its id, title and
description.

| Field | Holds |
|---|---|
| title, note | The declaration's `title` and `description` (an instruction's `body`). A rule with no title takes its id. |
| `declares` | Its id as its pack file gives it: `task`, `build.lane`, `agent_changes`, `of:task`. Unique within its pack. |
| `spec` | type, link type, rule, view: the rest of the declaration. |
| `shipped` | `{ pack, version, hash, value }`: the declaration exactly as the file held it, id, title and description included, and its hash. |
| `runs` | layout, part: `[{ path, hash }]`, the files it runs. |
| status | `current` (`kept` for a layout or part); `retired` when a later version of its pack drops it. |
| visibility | as its pack's item. |

## Hashes

- A declaration's or a manifest's `hash` is `sha256:` and the hex sha256 of
  its canonical JSON: keys sorted at every depth, no whitespace, arrays in
  their order, strings as `JSON.stringify` writes them.
- A file's `hash` in `runs` is `sha256:` and the hex sha256 of its bytes.
- A path is from the repository's root, with `/`: `packs/canvas/layouts/flow/index.js`.

## Upgrade: field by field

Install is a change like any other. An upgrade compares three values per
field: `shipped.value` (what it came with), the item now (the owner's), and
the new file's.

- Same hash: nothing to do.
- A field the item still holds as `shipped.value` had it takes the new file's.
- A field the owner changed stays theirs; where the file changed it too, the
  owner's is kept and the clash is said on the change.
- For `spec`, a field is a top-level key, and for a type each entry of
  `spec.fields` and of `spec.statuses` is a field of its own.
- `shipped` is then the new file's.

## The owner's version

The owner may edit a shipped part in place: that is an owner's edit, merged
as above. The older way stays readable: an item with `preset` naming a
part's `declares` is the owner's version of it, linked `stands_over` to it, and
read over it. A version of a floor rule only tightens it (the floor's lane
says what tightening is).

## The links

| Link | From, to | Drawn from |
|---|---|---|
| `part_of` (core's) | a part, its pack | made by install |
| `requires` | a pack or part, the part that provides the name | the pack's `requires`, a type's `extends` to another pack, `props.name` the name |
| `flavour_of` | a type or link type, its parent | `spec.extends` |
| `stands_over` | the owner's version, the shipped part | `preset` |

## Open

- The floor (e_9skmrrnm) says which parts are genesis, in code, and whether
  this pack is among them; until it is on, install writes `part_of` alone.
- A pack's `actions` and `handlers` stay on its item (`manifest`, `runs`):
  code, not parts. Say so if the registry needs them as parts.
