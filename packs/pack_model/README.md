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
| `shipped` | `{ pack, version, hash, value }`, `value` the whole file and `hash` its hash: the order of the parts comes from it. |
| `runs` | Its code no part names, `[{ path, hash }]`: `handler.js`, a kernel pack's modules. |

A pack kept on the map with no file (core's "Kept as an item") has no
`shipped`, and is read as it is today (`packs/loader/kernel/pack-items.ts`).

## A part

Every declaration of a pack is one item, `part_of` its pack's item, and
every part keeps its declaration the same way: `spec`. Its pack is the pack
item it is `part_of`, else `shipped.pack`; one the owner made in a pack has
only the link. A part that is not open is out of its pack's manifest.

| Manifest key | Part type |
|---|---|
| `types` | `type`; an entry `{ of, fields }` too, `declares` `of:<type>` |
| `links` | `link_type` |
| `rules` | `rule` |
| `views`, `form: "screen"` | `screen` |
| `views`, any other | `view` |
| `styles`, `type` `instruction`, `lens` or `reflex` | that type |
| `styles`, any other (a look) | `style` |
| `layouts` | `layout` |
| `parts` | `part` |
| (none yet) | `automation` |

| Field | Holds |
|---|---|
| title, note | The declaration's `title` and `description` (`body` where it says its words there, as an instruction). With no title, its id. |
| `declares` | Its id as its pack file gives it: `task`, `build.lane`, `agent_changes`, `of:task`. Unique within its pack. |
| `spec` | The rest of the declaration, whole (a screen's `form` and an instruction's `type` stay in it). |
| `shipped` | `{ pack, version, hash, value, dropped? }`: the declaration exactly as the file held it and its hash; `dropped` the version that stopped shipping it (install retires it then, and a later version that ships it again brings it back; one the owner retired stays retired). |
| `pack_merge` | `both` on a change install offers where the owner and the file changed the same field (below). |
| `runs` | layout, part: `[{ path, hash }]`, the modules it runs. |
| status | `current` (`kept` for a layout, part or lens, `enabled` for an automation); `retired` when a later version of its pack drops it. |

The typed fields a part type had before (a style's colours, a screen's
`pieces`, a layout's `code`) stay what they were: an owner's version
(`preset`) or an item the owner made. A shipped part fills only `spec`.

## Both ways, in code

`packs/loader/kernel/pack-model.ts`: `partsOf(manifest, { folder, files })`
gives the items a file makes (install), `manifestsOf(items)` the manifests
the items make, with their text and hashes, and `PACK_MODEL` the
registry's seam (`setPackModel(PACK_MODEL)`). Install keeps a copy of the
mapping in its own pack (pack code imports no kernel); a test holds the two
to the same items. Every pack file in `packs/` comes back from its
items whole (`test/pack-model-assemble.test.ts`).

## Hashes

- A declaration's or a manifest's `hash` is the hex sha256 of its canonical
  JSON: keys sorted at every depth, no whitespace, arrays in their order,
  strings as `JSON.stringify` writes them. A manifest read from the map is
  that text, and the registry and the log keep it by that hash.
- A file's `hash` in `runs` is the hex sha256 of its bytes.
- A path is from the repository's root, with `/`: `packs/canvas/layouts/flow/index.js`.

## Upgrade: field by field

Install is a change like any other. An upgrade compares three values per
field: `shipped.value` (what it came with), the item now (the owner's), and
the new file's.

- Same hash: nothing to do.
- A field the item still holds as `shipped.value` had it takes the new file's.
- A field the owner changed stays theirs; where the file changed it too, the
  owner's is kept, and install offers the file's as a change of its own
  carrying `pack_merge: "both"`, which install's rule holds for the owner.
- A field is the title, the note, or a top-level key of `spec`; for a type,
  each entry of `spec.fields` is a field of its own.
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
