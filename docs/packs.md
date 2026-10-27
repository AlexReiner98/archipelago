# The pack manifest

A pack is one folder under `packs/` with a `pack.json`, its manifest, and a
`handler.js` when it runs code. The manifest says what the pack declares, in
fifteen keys and no others (Rule 8 of the target model; `src/manifest.ts`
reads it, `test/structure.test.ts` refuses any other key).

## The keys

| Key | What it holds |
|---|---|
| `id`, `version`, `title`, `description` | What the pack is. |
| `requires` | Packs it cannot work without. While one is not active, it waits. |
| `uses` | Packs it works with when they are active. |
| `types` | Its types. An entry with `of` and `fields` adds fields to another pack's type. |
| `links` | Its link types, each extending a root. |
| `rules` | What decides a write (`src/rules.ts`), and what asks an agent to go on when its reply ends (`on: "reply_ended"`, `src/reply-rules.ts`). |
| `views` | Reads (a `shape` or a `lens`), trees (`form: "tree"`), screens on an item's page (`form: "screen"`), and reasons attention gives (`form: "attention"`: items `of` a type whose fields hold `where`'s values, weighed with the kernel's reason it `joins`). |
| `actions` | What people and agents can do through it, each under a verb. Core's six verbs are its actions marked `kernel`. |
| `handlers` | Code run by itself: `{ event }`, `{ schedule, every_minutes, at_start }` or `{ webhook, records }`. |
| `drawings`, `styles` | The code views are drawn by, and the presets of the map's own configuration: how things look, and (an entry with `type: "instruction"`, its words in `body`) what agents are told (`src/instructions.ts`). A style preset on nothing is used on every page; with `over: "workspace"` it lies over the workspace's own style; with `over: "chosen"` (a theme) only once the owner keeps a version of it. |
| `reach` | What it may reach beyond the map: `hosts`, `secrets`, `webhooks`, `via`, `runs`, and `server`. |

A **server pack** is a pack whose reach includes `server` (`acts`, `entries`,
`pages`, `connect`, `aliases`, `agreements`). There is no other kind of
pack: it is read by the server (`src/server-packs.ts`), never by a workspace.

## The keys before

Pack files before 24 Oct 2026 used 32 keys. Each is read as below, with a
warning, until the release after 0.1.0, and then refused.

| Before | Now |
|---|---|
| `relations` | `links` |
| `extend` | `types`, an entry `{ of, fields }` |
| `trees`, `screens` | `views`, with `form` |
| `verbs` | `actions`, with `kernel: true` |
| `schedules`, `hears`, `events` | `handlers` |
| `hosts`, `secrets`, `webhooks`, `via`, `runs` | `reach.*` |
| `acts`, `entries`, `pages`, `connect`, `aliases`, `agreements` | `reach.server.*` |
| `tier` | goes: `reach.server` makes a server pack |
| `contract` | goes: nothing read it |

## On the map

A pack's types and link types are presets, as its styles and instructions
are. The owner keeps their version of one as an item of core's `type` or
`link_type` with the preset's id in `preset`: its title and note over the
preset's, its `fields` added to the preset's, and retired, no new item or
link is made of it while those there stay. One with a `name` and no preset
is the workspace's own, in the `local` pack. The registry lays the items
over the manifests before it reads them (`src/type-overlay.ts`), and a
change that makes or changes one is checked against the registry as it
will be, so a type made in a change can be used in it (`src/type-items.ts`).

## In space

A pack's **reach** is the types, link types and fields of the pack itself,
of the packs it requires (and theirs), of the packs it uses while they are
active, and core's. A change a pack's action or handler makes carries the
pack (`pack` in the entry's header, with its manifest and the action), and
core's rule `pack_reach` refuses one that writes outside its reach. What a
pack names of a pack it uses (fields added to its types, links to them,
screens and actions on them) is registered only while that pack is active.

## In time

Adding or taking out a pack is a fact on the workspace's log, kept forever:
`["+", "pack:<id>", "pack", { version, manifest }]`, the manifest being the
SHA-256 of its `pack.json`, its `text` kept with it the first time the log
meets that hash, and `["-", "pack:<id>", "pack"]` (docs/log.md, section 8).
Adding a pack is the owner's: a new workspace starts with the kernel's
(core) alone, or those the server names (`PELAGO_START_PACKS`, a list or
`all`), and a pack new to the server is off in a workspace until its owner
adds it. A workspace that opens asserts again a pack it has whose manifest
changed. Taking a
pack out is the owner's, and is refused while another active pack requires
it; the kernel's packs are never taken out. Everything a pack registers is
derived from the set of packs, so taking one out unwinds it: its tools,
screens, rules and handlers go, and its items stay, their types dormant.

## Not yet

- The log keeps each manifest, but the registry as of an old position still
  reads the pack files the server has now.
- A pack the log says is present but whose code the server lacks is not yet
  listed as waiting.
- Taking out a pack together with the packs that require it, in one change,
  is not offered yet.
