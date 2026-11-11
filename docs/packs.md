# The pack manifest

A pack is one folder with a `pack.json`, its manifest, and a `handler.js` when
it runs code. The open core ships one, `core`, under `packs/`: the starter
types, task, decision, finding and event, actors, the system's own types and
the root links. Every other pack (work, code, software, proof, science, time,
design, the canvas's look and the rest) is the hosted service's, kept in
`archipelago-hosted` and read from a folder `PELAGO_PACKS` names (decision
e_8jd82drh, 9 Nov 2026). A pack's tests live beside it and reach the kernel
only through `#pelago/test`. The manifest says what the pack declares, in
sixteen keys and no others (Rule 8 of the target model; `src/manifest.ts`
reads it, `test/structure.test.ts` refuses any other key).

## The keys

| Key | What it holds |
|---|---|
| `id`, `version`, `title`, `description` | What the pack is. |
| `requires` | Packs it cannot work without. While one is not active, it waits. |
| `uses` | Packs it works with when they are active. |
| `types` | Its types. An entry with `of` and `fields` adds fields to another pack's type. A type's `statuses` may say where each stands in its course (`phases`: not_started, under_way, finished, ended, trouble or standing), which every drawing reads; unsaid, it is read from its place in the lists (`src/phases.ts`). |
| `links` | Its link types: each extends a root, or extends nothing and is its own. An end is `*`, a type (with its flavours) or `has:<capability>`, any type that declares it. |
| `rules` | What decides a write (`src/rules.ts`), and what asks an agent to go on when its reply ends (`on: "reply_ended"`, `src/reply-rules.ts`). |
| `views` | Reads (a `shape` or a `lens`), trees (`form: "tree"`), screens on an item's page (`form: "screen"`; what a pack shows of one item is a lens preset `on` its type instead, under `styles`; a piece `button` stands in the page's head beside Walk from it, its `label` and `tip` with what it does: the pack's `action`, or `draw`, how the canvas up is drawn, "{here}" being the item), and reasons attention gives (`form: "attention"`: items `of` a type whose fields hold `where`'s values, weighed with the kernel's reason it `joins`). |
| `actions` | What people and agents can do through it, each under a verb. Core's six verbs are its actions marked `kernel`. |
| `handlers` | Code run by itself: `{ event, records }`, `{ schedule, every_minutes, at_start }` or `{ webhook, records }`: `records` names the kinds of event its answers may log (a `log` entry of another kind is refused). An event is one another pack records, or the kernel's: `notification.made`, whose hearer may answer one `mail` about that notification, sent by the kernel to the person it is for at the address they sign in with, never one the pack names (`src/notify-mail.ts`; the `email` pack). `{ event: "item.due" }` hears the kernel's clock: each occurrence of an item whose type has `when` (a moment, or a repeat's hour on its days, in the workspace's zone), with the item as `target`, the event's `seq`, and its `type`, `at` and `version` (the item's last position in the fact stream) in `detail` (`src/due.ts`). A `log` entry names a notification of the same answer by its `ref` as `{ref}`, filled with its id, and may say what is recorded `otherwise`, should it not be made (`{error}` the reason; the `automations` pack's firing fact). |
| `layouts`, `styles` | The code views are drawn by, and the presets of the map's own configuration: how things look, and (an entry with `type: "instruction"`, its words in `body`) what agents are told (`src/instructions.ts`), and (an entry with `type: "lens"`, its props a flat query and a style: `filter`, `walk`, `limit`, `style`) a view the pack ships, listed in the bar's picker and on Home until the owner saves their own version of it (`props.preset`); one `on` types, its query naming the item as `{here}`, is a view of each such item (a project's roadmap, an event's gate), offered on that item's page and drawn on the canvas (decision e_2mndpgdj: what a pack shows of an item is a view, not a screen). A style preset on nothing is used on every page; with `over: "workspace"` it lies over the workspace's own style; with `over: "chosen"` (a theme) only once the owner keeps a version of it. |
| `reach` | What it may reach beyond the map: `hosts`, `secrets`, `webhooks`, `via`, and `server`. |
| `shared` | Core's alone: the shared set, the type ids every pack on an island map may build on (below). |

A **server pack** is a pack whose reach includes `server` (`acts`, `entries`,
`pages`, `connect`, `aliases`, `gates`). There is no other kind of
pack: it is read by the server (`src/server-packs.ts`), never by a workspace.
Its `gates` are where the kernel asks it before going ahead
(`src/server-gates.ts`): `signin`, what a person agrees to before signing in,
and `standing`, what a workspace it made may do (its limits, whether it has
ended). It keeps what they answer from in its own store; with no gate, nothing
is asked and nothing is limited.

Since 10 Nov 2026 (e_nsruapq3) a server pack may also declare, each checked
on load in `src/server-reach.ts` and acted on by the kernel alone:

| Key | What the kernel does |
|---|---|
| `mounts` | Hands it an address from a closed list (decision e_wptrr6tf): `public` (`/p/`), `site` (a domain's whole space), `setup` (`/connect/setup.mjs`), each to at most one pack (`src/server-mounts.ts`). Its entry answers a page, JSON, a picture, plain text or XML, a redirect on this server, the kernel's stream of a published document, or `pass` (the kernel answers). The open core's own reader (`packs/reader`) takes `public` and `site`; a pack the configuration names in its place replaces it. |
| entries' `answers: "html"` | Sends what the entry answers as a page, with headers and policy the kernel sets (`src/server-routes.ts`). |
| `counts` | Names the stream on a public site's map its counts are kept in (a plain word no kernel stream has, one pack's alone): it adds to a key's day with the act `count.add`, and a pack reads them back after a position with `count.read` (`src/pack-counts.ts`). How many, never of whom. The reader counts its visits so, in `visits`, kept by core's rule `counts:visits`. The entry of a `public` or `site` mount is handed what the request said too (`request`: query, host, referrer, agent, purpose), to read and forget. |
| `streams` | Holds a stream at `/x/<pack>/<id>/<workspace>/<id>` and tells it when that document is `published` again (`src/server-streams.ts`). |
| `files` | Serves a file of its `files/` folder at `/x/<pack>/files/<id>`, filled with `{origin}`, `{tokens}`, `{version}`, `{rules}`, and tells a session when its copy is behind (`src/server-files.ts`). |
| `launchers` | Starts an agent with its argv (no shell; `{prompt}`, `{mcp_config}`, `{tools}`, `{model}`, `{mode}`, `{session_id}`), holding its token, when a person launches and the server's launch setting names the pack (PELAGO_LAUNCH_PACK; by default `claude_code`, which the open core ships in `packs/claude_code` with the Claude Code adapter and setup) (decision e_885ztqkv, `src/server-launch.ts`). |
| `adapter` | Translates one surface's hooks, at `/hooks/<surface>/<event>`, with two functions of its handler, `in` and `out`; what a session is told stays the kernel's (decision e_6t8f46u6, `src/server-adapter.ts`). |

Acts `public.read`, `public.at`, `public.picture`, `public.drawing` and
`public.list` read the public views a person made (`src/public-view.ts`), each
as it was frozen, through the security-definer reads alone
(`src/server-published.ts`). A server pack still reads no map.

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
| `hosts`, `secrets`, `webhooks`, `via` | `reach.*` |
| `acts`, `entries`, `pages`, `connect`, `aliases` | `reach.server.*` |
| `agreements` | `reach.server.gates.signin` |
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

## On an island map

A workspace with the setting `islands` on (`workspace_set`; on for every new
workspace) knows two kinds of pack, read off the file with no key of its own
(`src/islands.ts`; decisions e_pp5mu6xd, e_rf6q3q34 and e_ubd8satd). The
schema the page reads marks each pack's `kind`: `island`, `map`, or `kernel`
for core. A pack that breaks its kind's rules is off there, and its state
says why.

- **An island pack** speaks on an island: it declares a type that lives on
  one (any but an actor), a link type, or fields on another pack's type. An
  island speaks one, and New island offers only these (core when there are
  none). It is held to the island rules below.
- **A map pack** owns no type that lives on an island. It brings looks,
  layouts, views, actions, handlers, uses and reach to the whole map, and may
  require other packs, island packs among them. The island rules do not judge
  it: each part goes through the gate it already has (a layout runs in the
  sandbox, code by the rule on code that runs, reach by core's pack reach
  rule, and the owner adds the pack). What its action or handler makes of an
  island pack's types goes on the island of what it is tied to in the same
  change (what it is part of first, never a link that crosses), else on the
  island the action is given as its input `island`, else on the lone island
  it fits; else the change is refused, naming the islands it could go on
  (`placeOnIslands`, `src/island-items.ts`).
- **Both is refused.** A pack with island types and a part that runs (tools,
  code, looks, computed views, uses, reach, or another pack required) is off,
  told to split into an island pack and a map pack.

The island rules, for an island pack:

- **Vocabulary, views, instructions.** The file holds only `id`, `version`,
  `title`, `description`, `requires`, `types`, `links`, `rules`, `views` and
  `styles`. Of `views`, only what the kernel draws (trees, screens,
  attention); of `styles`, only instructions and lenses, no looks.
- **The shared set alone.** `requires` names core and no other pack, `uses`
  is not there, no `types` entry has `of`, and its types, link ends and rules
  name only its own types, the shared set (core's `shared`: the eight starter
  types, task, decision and finding), a capability or `*`. Its links extend
  core's or its own.
- A shared type no pack taken there declares (task and decision, while work
  is not taken) cannot be built on: a pack that does waits.

Core, the kernel's pack, is never judged.

## Kept as an item

A pack can also be authored on the map, by a person or their agent, with no
access to the server: an item of core's `pack` type (`src/pack-items.ts`). Its
`name` is the pack's id, its title and note the pack's, its `version` the
pack's (0.1.0 unless said), and its `manifest` what it declares, as a
`pack.json` holds it:

```json
{ "op": "create", "type": "pack", "title": "Recipes", "body": "What we cook.",
  "props": { "name": "recipes", "manifest": {
    "types": [{ "id": "recipes.dish", "title": "Dish", "description": "A dish we cook.", "extends": "record" }] } } }
```

- **Data alone.** The manifest holds the keys of a pack on an island map
  (`requires`, `types`, `links`, `rules`, `views`, `styles`), whatever the
  workspace: no actions, handlers, layouts, reach or uses, so nothing of it
  runs on the server. Of `views`, trees, screens and reasons for attention;
  `styles` may hold looks as well as instructions and lenses, since a look
  names no type and runs no code (on an island map the island rules judge
  them, and today they take no looks: decision e_ubd8satd is open). A rule in it holds, refuses,
  requires or asks: none keeps a stream (`stream`, `keep`), is lifted by a
  setting (`lifted`) or by the server (`server`).
- **Its own names.** Every type, link type and rule it declares is named
  `<name>.<what>`, so none takes a kernel rule's name; its name is no pack's
  on this server, and nothing it declares is declared by a pack the server
  has, on or off here (a clash would stop the registry loading once both are
  on).
- **Checked when written.** A change that makes or changes one is checked as
  the registry would be with the pack added, so a manifest that would not
  load, or that the island rules would not take, is refused then, with why.
- **Added by the owner.** It is off until the owner adds it (`pack_set`), as
  any pack new to a workspace is; then its manifest's text is on the log, and
  an edit to it is said there again. An agent's edit of one, or bringing one
  back, waits for the owner (core's rule `agent_packs`). Retired or archived,
  it leaves the registry and its items turn dormant.

## A version on one island

A change to a pack can be tried on one island while the rest of the map keeps
the pack as it is (task e_j4bzhegb, `src/island-pin.ts`).

- **A version is a pack item** whose `version_of` names the pack (one the
  server has or one kept as an item; never core). It holds what a pack item
  may, and over its pack's manifest takes the place of those keys alone, so a
  map pack's code stays as it is. It declares the same types and link types by
  the same ids: it may change their fields, the rules and the instructions,
  never rename one. It is checked when written, as an island would run it,
  and is never added as a pack of its own.
- **An island runs it** by naming the item in its field `pack_version`; the
  version must be of the pack the island speaks. Setting it is a change, and
  unsetting it is the rollback: nothing is unwound.
- **A registry per version.** The map's registry keeps each version and
  builds, on first ask, a registry with the version in its pack's place,
  kept until the map's loads again. What an item on the island is checked
  against when written (`planChange`) and what is said there
  (`instructionsFor` with `island`, the `instructions` view's param `island`)
  are read from the registry the island runs, and so is what a session started on a task there is told (session_start with `task`); every other read is the map's.

- **Its rules decide there** (task e_tykp9yfc, `src/island-rules.ts`). Each
  op is judged by the rules of the version its island runs, for the pack the
  version is of; every other pack's rules, core's among them, stay the map's.
  A create is on the island it is made on, an update or archive on its item's,
  a link or merge on both ends'; an op on no island, or on one that runs the
  map's pack, is judged by the map's rules. A change is held or refused if
  any op is, and a held change names the rule and the version (`held_by`
  `version`, the pack item) that held it.

Not yet: what a session's hook tells it at its start (it knows no task) is
still the map's on a trial island.

## Where packs are found

A server reads its packs from `packs/`, then from each folder `PELAGO_PACKS`
names (separated as `PATH` is): a pack kept off this repository, as the hosted
service keeps the packs it sells, is a folder there. A pack is its id wherever
it is found, so one moved between folders is the same pack to every
workspace. The same id in two folders stops the server from starting.

Which of them a workspace may have is the server's to say
(`src/pack-allow.ts`). `PELAGO_ONLY_PACKS` (comma separated; `packs` in
`pelago.config.json`) names the packs every workspace may have, core always
among them; unset, every pack found. `PELAGO_WORKSPACE_PACKS`
(`islands=canvas,code;site=work`; `workspacePacks`) names the packs one
workspace alone may have beside them, so a pack is offered to one map before
every map. A pack a workspace may not have is off there ("not enabled on this
server"), and its owner cannot add it: its items stay, dormant, and its fact
on the log is kept, so letting it in again brings it back as it was. A pack
let in that the workspace never added is still off until its owner adds it.

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
