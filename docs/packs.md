# The pack manifest

A pack is one folder with a `pack.json`, its manifest, and a `handler.js` when
it runs code. The open core ships one, `core`, under `packs/`: the starter
types, task, decision, finding and event, actors, the system's own types and
the root links. Every other pack (work, code, software, proof, science, time,
design, the canvas's look and the rest) is the hosted service's, kept in
`archipelago-hosted` and read from a folder `PELAGO_PACKS` names (decision
e_8jd82drh, 9 Nov 2026). A pack's tests live beside it and reach the kernel
only through `#pelago/test`. The manifest says what the pack declares, in
nineteen keys and no others (Rule 8 of the target model; `packs/loader/kernel/manifest.ts`
reads it, `test/structure.test.ts` refuses any other key).

## The keys

| Key | What it holds |
|---|---|
| `id`, `version`, `title`, `description` | What the pack is. |
| `requires` | Names it cannot work without, never packs (below). While one has no active provider, it waits, saying which. |
| `uses` | Names it works with while they are provided, as `requires` names them. |
| `types` | Its types. An entry with `of` and `fields` adds fields to another pack's type. A type's `statuses` may say where each stands in its course (`phases`: not_started, under_way, finished, ended, trouble or standing), which every drawing reads; unsaid, it is read from its place in the lists (`src/phases.ts`). |
| `links` | Its link types: each extends a root, or extends nothing and is its own. An end is `*`, a type (with its flavours) or `has:<capability>`, any type that declares it. |
| `rules` | What decides a write (`packs/rules/kernel/rules.ts`), and what asks an agent to go on when its reply ends (`on: "reply_ended"`, `packs/sessions/kernel/reply-rules.ts`). |
| `views` | Reads (a `shape` or a `lens`), trees (`form: "tree"`), screens on an item's page (`form: "screen"`; what a pack shows of one item is a lens preset `on` its type instead, under `styles`; a piece `button` stands in the page's head beside Walk from it, its `label` and `tip` with what it does: the pack's `action`, or `draw`, how the canvas up is drawn, "{here}" being the item), and reasons attention gives (`form: "attention"`: items `of` a type whose fields hold `where`'s values, weighed with the kernel's reason it `joins`). |
| `actions` | What people and agents can do through it, each under a verb. Core's six verbs are its actions marked `kernel`. |
| `handlers` | Code run by itself: `{ event, records }`, `{ schedule, every_minutes, at_start }` or `{ webhook, records }`: `records` names the kinds of event its answers may log (a `log` entry of another kind is refused). An event is one another pack records, or the kernel's: `notification.made`, whose hearer may answer one `mail` about that notification, sent by the kernel to the person it is for at the address they sign in with, never one the pack names (`packs/walls/kernel/notify-mail.ts`; the `email` pack). `{ event: "item.due" }` hears the kernel's clock: each occurrence of an item whose type has `when` (a moment, or a repeat's hour on its days, in the workspace's zone), with the item as `target`, the event's `seq`, and its `type`, `at` and `version` (the item's last position in the fact stream) in `detail` (`packs/clocks/kernel/due.ts`). `{ event: "pack.changed" }` hears the workspace's packs change: one turned on or off (with the packs it sent to waiting or woke) or a pack kept as an item made, changed or retired, `said` and `packs` in `detail`; what each is now, its hearer reads with `pack_states` (`packs/loader/kernel/packstate.ts`). A `log` entry names a notification of the same answer by its `ref` as `{ref}`, filled with its id, and may say what is recorded `otherwise`, should it not be made (`{error}` the reason; the `automations` pack's firing fact). |
| `layouts`, `styles` | The code views are drawn by, and the presets of the map's own configuration: how things look, and (an entry with `type: "instruction"`, its words in `body`) what agents are told (`packs/agents/kernel/instructions.ts`), and (an entry with `type: "lens"`, its props a flat query and a style: `filter`, `walk`, `limit`, `style`) a view the pack ships, listed in the bar's picker and on Home until the owner saves their own version of it (`props.preset`); one `on` types, its query naming the item as `{here}`, is a view of each such item (a project's roadmap, an event's gate), offered on that item's page and drawn on the canvas (decision e_2mndpgdj: what a pack shows of an item is a view, not a screen). A style preset on nothing is used on every page; with `over: "workspace"` it lies over the workspace's own style; with `over: "chosen"` (a theme) only once the owner keeps a version of it. |
| `parts` | The parts of the app's page it draws, a map pack's alone: each `{ id, title, slot, reads, sends, opens, marks, modules }` (below, Parts and slots). |
| `reach` | What it may reach beyond the map: `hosts`, `secrets`, `webhooks`, `via`, and `server`; an internal pack also `items`, the addresses the map's own items keep (a type and its field: connect's check of each connection). |
| `shared` | Core's alone: the shared set, the type ids every pack on an island map may build on (below). |
| `kernel` | A kernel pack's code in the server process alone (the root packs and the service packs): its `trust`, where its `modules` are, the `service:` names it `provides` (each with the shapes it takes and gives, and the module and function that run it) and `calls`, its `hooks`, `timers`, `tables` and `memory`. Allowed only on the server's own packs; `docs/kernel-packs.md` says it whole. |
| `moved_from` | The packs it took declarations from, keeping their ids (below, In time): it may name a rule, view, style, action or layout `<pack>.<name>` for each, as well as its own. The kernel's packs it never needs to name. |

A **server pack** is a pack whose reach includes `server` (`acts`, `entries`,
`pages`, `connect`, `aliases`, `gates`). There is no other kind of
pack: it is read by the server (`packs/loader/kernel/server-packs.ts`), never by a workspace.
Its `gates` are where the kernel asks it before going ahead
(`packs/surface/kernel/server-gates.ts`): `signin`, what a person agrees to before signing in,
and `standing`, what a workspace it made may do (its limits, whether it has
ended). It keeps what they answer from in its own store; with no gate, nothing
is asked and nothing is limited.

Since 10 Nov 2026 (e_nsruapq3) a server pack may also declare, each checked
on load in `packs/loader/kernel/server-reach.ts` and acted on by the kernel alone:

| Key | What the kernel does |
|---|---|
| `mounts` | Hands it an address from a closed list (decision e_wptrr6tf): `public` (`/p/`), `site` (a domain's whole space), `setup` (`/connect/setup.mjs`), each to at most one pack (`packs/surface/kernel/server-mounts.ts`). Its entry answers a page, JSON, a picture, plain text or XML, a redirect on this server, the kernel's stream of a published document, or `pass` (the kernel answers). The open core's own reader (`packs/reader`) takes `public` and `site`; a pack the configuration names in its place replaces it. |
| entries' `answers: "html"` | Sends what the entry answers as a page, with headers and policy the kernel sets (`packs/surface/kernel/server-routes.ts`). |
| `counts` | Names the stream on a public site's map its counts are kept in (a plain word no kernel stream has, one pack's alone): it adds to a key's day with the act `count.add`, and a pack reads them back after a position with `count.read` (`packs/publish/kernel/pack-counts.ts`). How many, never of whom. The reader counts its visits so, in `visits`, kept by core's rule `counts:visits`. The entry of a `public` or `site` mount is handed what the request said too (`request`: query, host, referrer, agent, purpose), to read and forget. |
| `streams` | Holds a stream at `/x/<pack>/<id>/<workspace>/<id>` and tells it when that document is `published` again (`packs/surface/kernel/server-streams.ts`). |
| `files` | Serves a file of its `files/` folder at `/x/<pack>/files/<id>`, filled with `{origin}`, `{tokens}`, `{version}`, `{rules}`, and tells a session when its copy is behind (`packs/surface/kernel/server-files.ts`). |
| `launchers` | Starts an agent with its argv (no shell; `{prompt}`, `{mcp_config}`, `{tools}`, `{model}`, `{mode}`, `{session_id}`), holding its token, when a person launches and the server's launch setting names the pack (PELAGO_LAUNCH_PACK; by default the launcher a pack marks `default: true`: the open core ships `packs/claude_code`'s, with the Claude Code adapter and setup) (decision e_885ztqkv, `packs/surface/kernel/server-launch.ts`). |
| `adapter` | Translates one surface's hooks, at `/hooks/<surface>/<event>`, with two functions of its handler, `in` and `out`; what a session is told stays the kernel's (decision e_6t8f46u6, `packs/loader/kernel/server-adapter.ts`). The one surface that was before there were surfaces says so with `before: { actor, agent }`: its hooks are also `/hooks/<event>`, every hook acts under `actor` on the log, and an agent that gives no name on a server with no tokens acts as `agent`. |

Acts `public.read`, `public.at`, `public.picture`, `public.drawing` and
`public.list` read the public views a person made (`packs/publish/kernel/public-view.ts`), each
as it was frozen, through the security-definer reads alone
(`packs/surface/kernel/server-published.ts`). A server pack still reads no map.

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
over the manifests before it reads them (`packs/loader/kernel/type-overlay.ts`), and a
change that makes or changes one is checked against the registry as it
will be, so a type made in a change can be used in it (`packs/loader/kernel/type-items.ts`).

## What a pack requires

A pack requires names, never packs (decision e_f9ybsuce): whichever active
pack declares a name provides it, so a provider can be swapped and its
consumers stay active (`packs/loader/kernel/packorder.ts`). A name is one of:

| Name | Provided by |
|---|---|
| `has:<capability>` | any pack declaring a type with that capability (`has:when`) |
| `type:<id>` | the one pack declaring that type or link type (`type:event`) |
| `event:<kind>` | core for the kernel's (`item.due`, `notification.made`, `pack.changed`), else the pack whose handlers record it |
| `field:<field>@<type>` | the pack declaring that type, when it or an ancestor has the field; or the pack adding it (`of`) |
| `status:<status>@<type>`, `phase:<phase>@<type>` | the pack declaring that type, when its statuses (its own or inherited) have it, or one in that phase |
| `service:<family>.<entry>` | the kernel pack whose `kernel.provides` names it (`service:answer.flat`, the query pack), checked by the shapes it takes and gives (`docs/kernel-packs.md`, Service names) |

The last three are what a pack reads of a type it does not own, checked by
shape (task e_f9x7ddeh): the type as its provider declares it may have more,
never less. A pack whose need the map's provider does not meet waits, saying
what the type lacks, and an island may not run a version of a pack that drops
what an active pack needs: the pin is refused, naming that pack and the name
(`packs/loader/kernel/island-pin.ts`).

What a pack provides is read off what it declares: there is no key to claim
it. A bare pack id is the old form, kept for a bundle's two halves.

## In space

A pack's **reach** is the types, link types and fields of the pack itself,
of the packs that provide a type it requires or uses (`type:`, or a pack by
the old form, and theirs), and core's. Requiring a capability or an event
lets it read and hear, not write another pack's types. A change a pack's action or handler makes carries the
pack (`pack` in the entry's header, with its manifest and the action), and
core's rule `pack_reach` refuses one that writes outside its reach. What a
pack names of a pack it uses (fields added to its types, links to them,
screens and actions on them) is registered only while that pack is active.

## Parts and slots

The app's page is packs (decision e_fxayrhma): a small host in the root packs
draws the frame, and every other part of it is a **part** a map pack declares
(`packs/loader/kernel/ui-parts.ts`), walled in a worker per pack version and
answering with marks the host checks.

| Field | What it says | Checked when the pack loads |
|---|---|---|
| `id`, `title` | The part, `<pack>.<name>`. | Its pack's name. |
| `slot` | The slot it fills, or the slots: a part drawn in two places (the strip in `tabs` and the panes in `panes`) is one part, mounted once per slot and handed `slot` to say which (decision e_tq3fk4g8). | Each the host's, one its pack's parts open, or one it asks for as `slot:<name>`. |
| `reads` | The fields it reads, by type: `{ "task": ["title", "status"] }`. | Each field is on the type, and the type is its pack's, core's, or asked for (`type:` or `field:` in requires or uses). |
| `sends` | The actions it may send. | Each its own pack's. |
| `opens` | The slots it draws for others to fill. | Named `<pack>.<name>`, or a piece or page the host no longer draws. |
| `marks` | The marks it answers with (`box`, `text`, ...). | A list of mark kinds, checked by shape. One the host does not draw (`packs/walls/page/part-check.js`) makes the part wait, its pack still active; at draw, a mark it did not name is refused. |
| `go` | Whether it may move the page: it is handed the page's `address` and, after a press or Enter, may name another (`tools.go`), which the canvas checks. | true or false. |
| `state` | The page state it publishes (`tools.state`): names the runtime writes on the root as `data-<name>`, where anything watching the page from outside reads it (the picture taken once the canvas has drawn). | A list of names; one name, one owner, and the page refuses a name the part did not declare. |
| `modules` | Its code, files of the pack entered at `index.js`, as a layout's. | The files are there. |

**A slot has one owner** (`packs/loader/kernel/slots.ts`). The host owns its
frame (`FRAME_SLOTS`) and each piece and page it still draws
(`piece.<name>`, `page.<name>`, from `PIECES` and `PAGES`): the step that
moves one into a pack's part takes it off the host's list and the part opens
it. Any other slot is opened by one pack's part, and `slot:<name>` is
provided by that pack (core for the host's); a second pack opening it waits,
as one declaring a taken type does (`packs/loader/kernel/packorder.ts`).

**The frame's slots**, and what each hands the part beside the item it
stands on (its `piece`; `test/ui-parts.test.ts` freezes the table):

| Slot | Where | Handed |
|---|---|---|
| `panes` | The panes of the page. | — |
| `tabs` | The bar of tabs across them. | `tabs`, `current` |
| `tab.mark` | A mark on one tab: whose it is, how much it holds. | `tab`, `current` |
| `bar` | The bar over the canvas. | `current`, `home` |
| `bar.views` | What its view button opens. | `current`, `home` |
| `bar.find` | Find's input and its terms. | `query`, `home` |
| `bar.layouts` | The layout a view is drawn in. | `current`, `layout` |
| `canvas` | The canvas itself. | `query`, `layout` |
| `traces` | The overlay of traces over it. | `query` |
| `sheet` | The sheet over the canvas, an item's one page. | `reading` |
| `item.menu` | What is done rarely to that item. | — |
| `find` | Find at the canvas's foot. | `query` |
| `home` | The page with no query up. | — |
| `nav` | What the menu leads to. | — |
| `look` | Drawn by nothing: the part is handed whether the canvas has drawn (`drawn`, and `why` when there is one) and publishes it as page state, so a picture is taken at the right moment. The host mounts it under `?look`, two frames after the page's first drawing word. | `drawn`, `why` |
| `workspace.card` | A card on the workspace page, one pack's say on it. | `workspace`, `section` |

A part is handed the item it stands on cut to the fields it `reads`, its
query's items, its named reads, and, where it declares `go`, the page's
address. It answers with marks alone (`packs/walls/page/part-check.js`): `box`,
`text`, `list`, `input`, `button`, `paint`, `path`, `note`, `menu`, `thumb`,
`picture`, `web`, `pane` and `panes`, each named in its `marks`.

**What any mark may carry**, beside `key`, `item`, `view` and `tip`:
`lights`, up to 500 items it lights on the canvas in sight while the person
points at it, the rest faded by the style's `dim`
(`packs/surface/page/light-items.js`) — pointing is not a gesture, so the
part is told nothing.

**What the host does with the marks it draws** (each event goes back as
`{ key, name, value }`):

| Mark | What it is | What the part hears |
| --- | --- | --- |
| `box` `fits` | As many of its marks as fit on one line, one at least; then `+N`, its tip the hidden marks' tips (`part-fits.js`). | With `more: <key>`, the `+N` is a button: `press`, value N. |
| `button` `copy` | The words go to the clipboard on the press. | `press`. |
| `menu` | What is done rarely, in steps (`part-menu.js`): a head (`text`), a field, buttons, and a `menu` in it as the next step (›, opened it is all its step shows, ‹ back). A `search` field narrows its step's choices in the page and Enter takes the first left; Backspace in it, empty, goes back. `open: true` opens it; it stays as the person leaves it while its key stays. | `press` from a choice, `edit` from a field; a `text` field still `submit`s, an `item` field `pick`s. |
| `web` | A page on the web framed in place (`url`, http or https), sandboxed (`allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox`), no referrer, with ↗ to open it apart; this server's own pages are refused, drawn as what they are. A new `reload` loads it again. | nothing. |
| `pane` | A canvas at an address (`at`) the page draws in its body (`hooks.paneFrame(at, el, said)`, whoever keeps the panes), the part's marks in its strip; `at` of `w?url=` frames that page as `web` does. `share` is its room; `ring` rings it once. | `focus` when pressed or focused in; whatever the frame says (`open`, `opened`, `named`). |
| `panes` | Panes side by side (`dir: row`) or one over another (`column`), each by its share; the host draws the lines between them (`part-pane.js`). | `share { index, at }` as a line is dragged, `at` a share of the room. |

A box, a button or a pane may carry `drag: <kind>`: the host follows it once
it moves a few pixels, shows where it would land, and answers `drop { onto,
zone }` (`part-drag.js`): over a pane, a side of it or its middle (`left
right above below center`, onto its key); over another dragged mark (a tab)
or a box with `dock` (the strip), `tabs` (onto that mark's key, or null); off
the page, `out`. Less was a press. A box or a button may also be `selected`,
`ring` once as it is asked for, take a session's `hue` (named by its words),
and with `aux` go back as `close` when pressed with the middle button; a
button's `look: 'tab'` draws it as a tab.

**A part decides, the runtime draws.** A part runs in a worker: it never
holds a node, never reads the page, and answers when it is ready, which is
what lets nearly everything become a part. The runtime hands it what it
declared it reads and keeps only the drawing — so where a module used to
work something out and paint it, the working out is the part and the
painting is a mark the contract names. Three shapes to write against:

- **Proposals in, ghosts out.** The part is handed the changes held and the
  items drawn; it answers with the marks of what would land, and the runtime
  draws them where it draws anything.
- **A view in, a thumbnail out.** The part names the view (`thumb`); the
  runtime keeps and draws the picture. A part never holds an image.
- **A view named, a frame drawn.** The part answers with the view it wants
  in sight; the runtime frames it and brings it into view.

Where a part must say something about the page rather than draw it (that the
canvas has finished drawing, say), it publishes page state it declared
(`state`), and the runtime writes it on the root.

**Where a part may go.** A part that declares `go` names an address after a
gesture and the canvas checks it: an item (`item`), a query and the layout
to draw it in (`query`, `layout`), or a page of the app the host draws
(`page`: `you`, `workspace`, or `screen` with `of`, the screen's id).

**Which version of a part runs** depends on what it stands on: the island of
the item it stands on, as today. A part that stands on nothing — the tabs,
the panes, Home, the menu, a bar over a canvas that spans islands — is the
chrome, and is to be pinned per person (decision e_x6bqupud, task
e_fpm9n7er); until that lands the chrome runs the map's version. The page
resolves it in one function, `pinFor` in
`packs/surface/page/part-host.js`.

**Its code is the version's its island pins.** A part's modules are read
from its pack's folder as the registry has it (`folderOf`): on an island
pinning a version with code of its own, that version's (`pack-code.ts`).
Each goes to the page by the hash of its modules (`partsFor`, `partsBy`), so
a module is fetched once and kept. The owner's version of a part is an item
of core's `part` type naming it as `preset`, its `code` over the pack's
modules; its pack, slot and fields are on the item for the code map to read.
A part is a map pack's: an island pack, a pack kept as an item and a
version's manifest hold none.

## On an island map

A workspace with the setting `islands` on (`workspace_set`; on for every new
workspace) knows two kinds of pack, read off the file with no key of its own
(`packs/loader/kernel/islands.ts`; decisions e_pp5mu6xd, e_rf6q3q34 and e_ubd8satd). The
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
  (`placeOnIslands`, `packs/loader/kernel/island-items.ts`).
- **Both is refused.** A pack with island types and a part that runs (tools,
  code, looks, computed views, uses, reach, or another pack required) is off,
  told to split into an island pack and a map pack.

The island rules, for an island pack:

- **Vocabulary, views, instructions.** The file holds only `id`, `version`,
  `title`, `description`, `requires`, `types`, `links`, `rules`, `views` and
  `styles`. Of `views`, only what the kernel draws (trees, screens,
  attention); of `styles`, only instructions and lenses, no looks.
- **The shared set alone.** `requires` names capabilities and shared types
  (`has:`, `type:`), and no pack but core and no event, `uses`
  is not there, no `types` entry has `of`, and its types, link ends and rules
  name only its own types, the shared set (core's `shared`: the eight starter
  types, task, decision and finding), a capability or `*`. Its links extend
  core's or its own.
- A shared type no pack taken there declares (task and decision, while work
  is not taken) cannot be built on: a pack that does waits.

Core, the kernel's pack, is never judged.

## Kept as an item

A pack can also be authored on the map, by a person or their agent, with no
access to the server: an item of core's `pack` type (`packs/loader/kernel/pack-items.ts`). Its
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
the pack as it is (task e_j4bzhegb, `packs/loader/kernel/island-pin.ts`).

- **A version is a pack item** whose `version_of` names the pack (one the
  server has or one kept as an item; never core). It holds what a pack item
  may, and over its pack's manifest takes the place of those keys alone:
  never layouts, handlers, actions or reach in its manifest. It may change its types' fields, the rules, the views the kernel
  draws (trees, screens, reasons for attention) and the styles (instructions,
  lenses, looks). It keeps every type and link type its pack declares, by the
  same ids, since items may be of them, and may add its own, named
  `<pack>.<what>`: it never leaves one out or renames it. It is checked when
  written, as an island would run it, and is never added as a pack of its own.
- **What a version adds is the island's.** The map's registry keeps each type
  and link type a version adds, dormant and retired (`packs/loader/kernel/version-types.ts`):
  an item made of one is projected as its type says, on the write path and in
  a rebuild from the log, and nothing new is made of it but on an island that
  runs the version. A link is judged by the version its from item's island
  runs. Rolled back, the island's items of an added type stay, as a pack's do
  when it is turned off, and no more are made.
- **A version of a server's pack may carry code** (task e_7vezatrt,
  `packs/loader/kernel/pack-code.ts`): its field `code`, files by path (`handler.js`,
  `layouts/x.js`), each standing in for its pack's file of that path. It is
  laid out in a folder of its own, kept by the hash of the whole, and runs
  from there under the same walls as the pack's own, on the islands that run
  the version alone: an action or a view called with `island` runs it, any
  other call the map's. An agent's word for it always waits for the owner
  (core's rule `pack_code`, which no setting lifts). A pack kept as an item,
  and a version of one, carries none.
- **An island runs it** by naming the item in its field `pack_version`; the
  version must be of the pack the island speaks, or of a map pack (one that
  owns no type living on an island): one version per island. Setting it is a change, and
  unsetting it is the rollback: nothing is unwound.
- **A registry per version.** The map's registry keeps each version and
  builds, on first ask, a registry with the version in its pack's place,
  kept until the map's loads again. What an item on the island is checked
  against when written (`planChange`) and what is said there
  (`instructionsFor` with `island`, the `instructions` view's param `island`)
  are read from the registry the island runs, and so is what a session started on a task there is told (session_start with `task`).
- **A read that names an island is the island's.** A view asked with
  `island` in its params (`askView`) is answered through the registry that
  island runs: a version's changed tree or reasons answer there and nowhere
  else. A read that names no island is the map's, though it may cross
  islands: an item is not read through its own island's version one by one.

- **Its rules decide there** (task e_tykp9yfc, `packs/loader/kernel/island-rules.ts`). Each
  op is judged by the rules of the version its island runs, for the pack the
  version is of; every other pack's rules, core's among them, stay the map's.
  A create is on the island it is made on, an update or archive on its item's,
  a link or merge on both ends'; an op on no island, or on one that runs the
  map's pack, is judged by the map's rules. A change is held or refused if
  any op is, and a held change names the rule and the version (`held_by`
  `version`, the pack item) that held it.

Not yet: what a session's hook tells it at its start (it knows no task) is
still the map's on a trial island. So are what the page draws from the map's
configuration (the bar's lens presets, the screens on an item's page), which
asks with no island. And a version archived takes its added types with it:
its items' types are then unknown, as no type table keeps them.

## Where packs are found

A server reads its packs from `packs/`, then from each folder `PELAGO_PACKS`
names (separated as `PATH` is): a pack kept off this repository, as the hosted
service keeps the packs it sells, is a folder there. A pack is its id wherever
it is found, so one moved between folders is the same pack to every
workspace. The same id in two folders stops the server from starting.

Which of them a workspace may have is the server's to say
(`packs/loader/kernel/pack-allow.ts`). `PELAGO_ONLY_PACKS` (comma separated; `packs` in
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
(core), the packs that keep core's ids (`core.x`: canvas, sessions; what
core shipped stays shipped, `keepsKernel` in `packs/loader/kernel/pack-moved.ts`), and those
the server names (`PELAGO_START_PACKS`, a list or `all`), and a pack new to the server is off in a workspace until its owner
adds it. A workspace that opens asserts again a pack it has whose manifest
changed. A pack that holds now what a pack it names in `moved_from` declared once (a
rule, view, style, action or layout, by its id or with `<that pack>.`
renamed to its own prefix) is added, once, to a map that had that pack on and
whose log keeps a manifest of it that declared it, so moving something between
packs changes nothing a map does (`packs/loader/kernel/pack-moved.ts`; task e_qhtt4phv). The
kernel's packs are in every pack's `moved_from` without being named (the core
audit, e_sjhbyf52: the `findings` pack first, then `sessions` and `practice`). A
declaration may keep its old id in the pack it moved to, so what names it (an
owner's kept version) still does (`ownsId`, `packs/loader/kernel/packorder.ts`); a type or
link type keeps its id, or names its old one in its own `moved_from`, and
moves by `takenOver`. Splitting a pack in two: its vocabulary half keeps
the pack's id (an island speaks a pack by its id), and its practice half is a
new pack naming it in `moved_from` and requiring its types by name
(`test/pack-split.test.ts`).
A map made after the move starts with it only when the server names it. Taking a
pack out is the owner's; the kernel's packs are never taken out. The packs
relying on a name only it provides go to waiting first, saying why, their
items kept, and adding it back wakes them (`dependentsOf`, task e_5h5kprqm,
after the Cordis paper: consumers deactivate before their provider goes).
The Packs screen names them before the owner confirms. Everything a pack registers is
derived from the set of packs, so taking one out unwinds it: its tools,
screens, rules and handlers go, and its items stay, their types dormant.

## Bundles

A bundle names packs that go on and off together (decision e_f9ybsuce): on
an island map one way of working is often an island pack of words and the
map pack that acts on them, as `replays` and `refine` are. It is a manifest
of its own, `bundle.json` in a folder beside the packs (`packs/refinement/`):
`{ id, title, description, packs }`, its id no pack's, and a pack in one
bundle at most (`packs/loader/kernel/bundles.ts`). `pack_set` with a bundle's id, or any of
its packs' ids, turns them all, in one change set; the Packs screen draws it
as one plate with one switch, each pack a band in it. It is offered only
where the server's list offers every pack in it; where one is left out, the
others stand alone. A distribution names bundles: `PELAGO_START_PACKS=refinement`
starts a new map with refine and replays.

## Not yet

- The log keeps each manifest, but the registry as of an old position still
  reads the pack files the server has now.
- A pack the log says is present but whose code the server lacks is not yet
  listed as waiting.
- What the Packs screen says will wait is read from the active packs alone:
  a waiting pack that would stand in as provider is not counted, so it may
  name more than will wait.
