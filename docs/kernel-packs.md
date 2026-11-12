# Kernel code as packs

Every part of `src/` becomes a pack, and what is trusted is a declared tier,
not a place in the tree (decision e_3pxvwdn7, the owner, 12 Nov 2026). Nine
**root packs** hold control: changed only with the owner's word, pinned by
hash, needing nothing above them. Twenty-seven **service packs** run
in-process beside them through one narrow, typed context, and fill hook
points the root packs open. One **boot stub** that is no pack loads the
roots. What stays in `src/` is the stub and nine plumbing modules.

This is the contract every session of the wave builds against: task
e_st5s6rj7 under the plan e_ykymc952. The choices it makes that are the
owner's to confirm are listed last.

## Three tiers

A pack's tier is read from its manifest. Each tier can do less than the one
above it, never more.

| Tier | Runs | May | May not |
|---|---|---|---|
| `root` | in the server process, started by the stub | open the database as its owner, write projections, bypass row-level security through a named `security definer` function, read the whole log, open hook points and slots, provide `root.*` service names to the packs roots.json names | require a service name; import a root pack above it; change without the owner's word |
| `service` | in the server process, `internal: true`, required or `optional` | read under row-level security, change through `change` as `system:<pack>`, keep the operational streams its rules declare, provide and require `service:` names, fill hook points | touch a table, the log or a key directly; import any kernel module; be carried on the map as code |
| plain (no tier) | in the sandbox, as today (`src/packhost.ts`) | everything `docs/packs.md` gives a pack | anything in-process |

Core stays what it is, the pack of words every map starts with (starter
types, the shared set, core's rules). It joins the root list, so it is pinned
by hash too, and holds no code.

## The manifest key `kernel`

One key is added to the seventeen: `kernel`, read by `src/manifest.ts` and
refused on any pack outside the server's own folders (a pack kept as an item,
a version, a hosted folder that `PELAGO_PACKS` names without listing it as
trusted).

```json
"kernel": {
  "trust": "service",
  "internal": true,
  "modules": "kernel/",
  "provides": { "answer.attention": { "in": { "viewer": "id", "limit?": "number" }, "out": [{ "id": "id", "why": "string" }] } },
  "hooks": { "write.follow": "waits.ts#follow", "open.ready": "start.ts#open" },
  "tables": { "mention": { "item": "id", "names": "id", "at": "number" } },
  "timers": [{ "run": "clock.ts#tick", "every_ms": 60000, "leading": true }]
}
```

- **`trust`**: `root` or `service`. Absent, the pack is plain.
- **`internal`**: shipped with the server, versioned with it, its code
  in-process. It replaces the hardcoded `KERNEL_PACKS` and the `core.x`
  naming (`src/packorder.ts`). A service pack is always internal; a root
  pack always is.
- **`optional`** (decision e_cenjpmrf, the owner, 12 Nov 2026): an internal
  pack is **required** unless it says `optional: true`. A required one is
  always on, whatever the server enables or a map says; the Packs screen shows
  it "always on" and refuses to take it out. An optional one a map may switch
  off on the Packs screen as it switches a plain pack: it is off for every
  reason a plain pack is (turned off here, not enabled on this server, the
  island rules), on by default where it was before, and found only where its
  folder is read (a required one is added to every registry from the server's
  own folder). It fills only the write path's points (`write.*`, read at each
  change) and declares no `provides`, `tables` or `timers`, which are filled
  once at a workspace's open and would outlive the switch. A root pack is
  never optional. Sessions is optional. Automations stays a plain pack: its
  handler runs in the sandbox, which a kernel pack may not have; its triggers
  are the required `automation_triggers`, which does nothing on a map where
  automations is off.
  What a run records (`src/pack-versions.ts`): the required internal packs are
  one entry, `internal`, the same on every map one server runs; an optional one
  is recorded as a plain pack is, its own `id@version` entry while it is on and
  none while it is off, so the record says the map's switch.
- **`memory`** (decision e_a8dh8fg3, the owner, 12 Nov 2026): the settings
  prefix a service pack's memory (the read `memory`) is kept under, in place of
  its own `pack:<id>:`: a prefix the code it took over kept there already, so
  nothing is migrated. Lower-case, ending in a colon, never `pack:`.
- **`modules`**: its code, TypeScript under the pack's folder
  (`packs/<id>/kernel/`), loaded with `import()` by the loader. Never a file
  a pack item or a version carries: `pack_code` stays the sandbox's alone.
- **`fills`**: the fields of an item its `write.rewrite` fillings may set
  (placement: `["island"]`); none unless said. Only a service pack.
- **`provides`**, **`hooks`**, **`tables`**, **`timers`**: below.

Every root and service pack lives in this repository's `packs/`, as
`packs/<id>/pack.json` and `packs/<id>/kernel/*.ts`.

## The in-process context

A service pack's module exports functions; each is handed one
`KernelContext` and nothing else. It imports types alone
(`import type { KernelContext } from '#pelago/kernel'`); a value import of
anything under `src/` or another pack is refused by `test/structure.test.ts`.

```ts
interface KernelContext {
  pack: { id: string; version: string; hash: string };
  workspace: string;
  reads: Reads;                  // under row-level security, bounded, as packreads.ts answers
  registry: RegistryRead;        // types, links, capabilities, rules: read only
  call<I, O>(name: string, input: I): Promise<O>;     // a service: name it requires or uses
  change(input: ChangeInput): Promise<ChangeAnswer>;  // as system:<pack>
  record(stream: string, facts: OpFact[]): Promise<void>; // only a stream its rules keep
  secret(key: string): Promise<string | undefined>;   // only reach.secrets
  fetch(url: string, init?: RequestInit): Promise<Response>; // only reach.hosts, through walls
  now(): Date;
  said(message: string): void;   // the server's error stream (logged.ts)
}
```

`Reads` is the reads API the sandbox already has (`src/packreads.ts`), with
what task e_exet8395 adds: bounded log reads (facts by run, the last
authority and actor per field), runs by repository or folder, held proposals
and confirm questions, a cursor past 500 rows, and a pinned version for one
view reading another. In-process it is a function call, not a pipe; the
answers are the same.

### System authority

A service pack's change carries the actor `system:<pack>` and
`authority: { of: "system", basis: "<what of the pack>" }`, kept apart from
human and agent in the log. It goes through `change` and `decide` like any
other; nothing in code skips the rules.

- Core's rule `system_reach` refuses a system change outside the pack's
  reach (as `pack_reach` does for a plain pack's action).
- A system change never settles a question, never forgets, and never touches
  a root pack's items (`settle_said`, `forget`, `root`).
- Core's `agent_changes` does not hold it. A pack that wants its own
  bookkeeping held, or spared another hold, declares the rule (sessions'
  writes, which today skip the proposal step in code, become the rule
  `sessions.bookkeeping`).

## Service names

`service:<name>` joins `has:`, `type:`, `event:` and the shaped names
(`src/packorder.ts`). It names a function one pack provides and others call
with `ctx.call`.

- **One owner.** Two active packs providing one name stop the registry
  loading, as two packs declaring one type do. Swapping a provider is taking
  one out and adding the other.
- **Checked by shape.** A provider's `in` may require no field the caller's
  declared `in` lacks, and its `out` must hold every field the caller's
  declared `out` reads: more, never less, as `field:` is checked today. A
  shape is a JSON sketch: `"string"`, `"number"`, `"boolean"`, `"id"`,
  `"any"`, `[shape]`, `{ "key": shape, "key?": shape }`. A caller whose need
  the provider does not meet waits, saying which field.
- **A family per closed list.** Each closed list in the kernel opens as a
  family, its entries provided by packs:

| Family | Opens | Now in |
|---|---|---|
| `answer.<name>` | a lens preset's answer (attention, brief, frontier...) | `LENS_ANSWERS`, `src/declared.ts`; `READINGS`, `src/query-presets.ts` |
| `term.<word>` | a lens term (frontier, worked, moved, island, held) | `src/query-terms.ts` |
| `capability.<name>` | a capability's behaviour (`occurs`, `capacityOf`) | `CAPABILITIES`, `src/capabilities.ts` |
| `setting.<key>` | a workspace setting and who may read it | the `member_setting_read` policy, `src/schema.ts`; `src/workspace-tools.ts` |
| `piece.<name>`, `page.<name>` | what the page draws | `PIECES`, `PAGES`, `src/declared.ts` |
| `act.<verb>.<action>` | an action whose code is in-process | `ACT_TOOLS`, `src/tool-acts.ts` |

The schema half of a closed list stays with the root pack that checks it
(capabilities' check stays in loader); the behaviour moves to its provider.

## Root services

What only a root may do (read a workspace whole, write past the one write path, read the server's
counters) a service pack asks for through the `root.*` family, and only the packs the owner listed
may (the owner, 12 Nov 2026, e_tjkzs42m). As built in `src/root-calls.ts`:

- **Provided by a root.** A root pack's manifest names each under `kernel.provides` as
  `root.<name>`, with its function (`<file>.ts#<export>`). A root provides no other name, and only a
  root provides one (`kernelProblems`, `src/manifest.ts`). The function is handed a `RootCall` (who
  calls, the map the caller's context is of, or for a server duty the server's workspaces) and the
  input, and answers with values: never a handle on the database.
- **Called only by the listed packs.** `packs/roots.json` holds `calls`, each name with the internal
  service packs that may call it. The list is pinned with the roots: changing it is a change to
  `roots.json`, which needs the owner's approved pull request. A caller also says it in its
  manifest (`uses: ["service:root.<name>"]`).
- **Checked at boot and at each call.** `checkRoots` (`src/boot.ts`) refuses a list that names a
  pack not here or not an internal service pack, or a name no root provides. `ctx.call` refuses any
  pack the list does not name for that name; a kernel caller (`callAs`) cannot ask one at all. A
  server duty no map asks (backupAll) is handed `serverContext(pack, workspaces)`
  (`src/kernel-context.ts`), which calls root services and nothing else.
- **Narrow.** Each name is what one service pack needs, and no more:

| Name | Root | For | Answers |
|---|---|---|---|
| `root.workspaces` | identity | backup | the workspaces the server holds |
| `root.dump` | log | backup | a workspace's backup and its vault's, the workspace held open while read |
| `root.merge` | log | backup | the writes a merge makes, and what they did |
| `root.counters` | surface | usage | a workspace's limits, its use of each and what that use is made of |
| `root.server_packs` | loader | connect | the server packs the server's folders hold, each as the owner is shown it, and those left out with why (wave 6b: the `server_packs` tool, wired at `src/server-pack-tools.ts`) |
| `root.uses` | surface | usage | the uses stream's counts held in memory: added to, or read (the kernel's callers name a workspace, so `src/uses.ts` counts with `serverContext`) |
| `root.due` | loader | clocks | an item came due: item.due recorded on the map's activity stream as the kernel's and told to the sandboxed packs that hear it; its seq |
| `root.publish` | database | publish | publishing's writes, each with its event: the published and public_view rows (publish, unpublish, share, unshare), and an item made public or shared again as the one publishing |
| `root.may` | rules | publish | whether this kind of actor may publish or take down here (core's agent_publish, agent_unpublish) |
| `root.picture` | rules | publish | a picture kept for an item: the walls' SVG check, room to store, the row and its observation, as the one who sent it |
| `root.layout` | loader | publish | a pack's drawing as the server ships it (its hash, whether it has code) and the commit the server runs |
| `root.scene` | loader | publish | a pack's own drawing's first frame, run in its sandboxed process (bug e_mjuwqk4a: never code kept on the map), and whether its stylesheet passes |
| `root.drawing` | surface | publish | a drawing's module or service worker by its hash, as the reader may see the map, or whether the packs ship it |
| `root.public_product` | surface | publish | a product's public page, data or result's picture as anyone reads them, with the headers every public answer carries |
| `root.transient` | surface | looks, presence, mail | the transient store, kept and read (a key, a key with its bytes, keys and prefixes at once) as the whole workspace of the calling map |
| `root.look` | surface | looks | the UI's version, a look pass for the calling map's screen (walls), the room for another look this hour (rules) |

## Write-path hooks

The write pack opens five hook points; service packs fill them. Each runs in
pack order (`orderPacks`), each pack's in the order it declares. With none
filled, the write path works as it does on a map with only core.

```
change(actor, input)
  currentNames
  write.rewrite    ops in, ops out          (placement: subject, islands)
  standing, mayWrite
  write.validate   ops in, refusals out     (lenses: twins; automations: checks)
  write.follow     ops in, more ops out     (none of the server's own)
  plan, decide                              (the verdict covers every op above)
  apply  ── one transaction ──
    facts, root projection
    write.follow.rides  op by op, ops that ride the verdict  (waits: unwait; placement: sources)
    log.project    facts in, own rows out   (mentions)
    append, projectDecision
  write.after      entry in, nothing out    (types applied, supersede)
  write.retype     from, to                 (lenses: the retype rename)
```

| Point | Signature | Bounds |
|---|---|---|
| `write.rewrite` | `(ctx, ops, judged) => ops` | Same ops, same order, same op, id, type and ends. It sets only the props its pack names in `fills`. Visibility may narrow, never widen. The write pack checks each answer and refuses the change, naming the pack, if any bound is broken. `judged` is the registry the change is judged by (`registry`), the island it was given (`island`) and the registry an island runs (`islandRegistry(island)`). |
| `write.validate` | `(ctx, ops, who, judged) => { refusals, warnings }` | Pure: reads only, records nothing. Run before decide and again when a held change is approved. |
| `write.follow` | `(ctx, ops) => Op[]` | Extra ops, refs allowed, tagged with the pack in the entry's header. Run before decide, so the verdict covers them, and again inside the apply transaction: if the second run differs, the new ops are judged there, and a change they would hold is refused as "the map moved, send again". |
| `write.follow.rides` | `(ctx, ops, ride) => { ops?, is?, answer? }` | What rides the change that caused it (the owner, 12 Nov 2026, e_umv4gdqr): no rule judges it, it is not in the ops a change is judged or held with, and it applies in the change's own set with its verdict and authority, held with it and run when it is approved or applied. Asked op by op inside the apply's transaction, `ride` handing the transaction's query (`q`), the op (`at`, -1 for the change's own source), `place` (`source`: where the op names its source, what it adds said before the op's facts, `is` naming the item that source is; `after`: after the op's facts), the change's `authority`, whose `word` it is, and its `registry`. Its ops are only `create` (with a ref, minted by it) and `unlink`; `answer` lists join the change's answer. |
| `log.project` | `(ctx, facts, rows) => void` | Writes only the rows of its own `tables`, which the database pack makes with row-level security read from the item each row names. Run in the transaction, after the root projection, and in every rebuild. The snapshot keeps each projector's hash; a new hash rebuilds its table from the log at open. |
| `write.after` | `(ctx, entry) => void` | After the entry is on the log. A failure is a warning, never an error (`afterLog`). |
| `write.retype` | `(ctx, from, to) => Op[]` | After a type or link type is renamed. |

What follows an op at the level of facts (the owner's link, `ownerFollows`)
stays in the write pack: facts-level followers are root code alone.

As built (wave 4, e_umv4gdqr): unwait (`packs/waits`, `unwait.ts#follow`) and
sources (`packs/placement`, `sources.ts#follow`) fill `write.follow.rides`; the
apply loop (`packs/write/kernel/change-apply.ts`) names neither. A ride is a
point of its own, not an answer of `write.follow`, so its fillings are never
called before decide and never re-run as "the map moved". The log is as it was
inline (`test/follow-rides.test.ts` pins a settle with waits_on and sources,
applied and held then approved): each ride said where the old call was, a
source minted under `source <uri>`, the change's `follows` header untouched.

## Slots

A root pack never imports one above it. Where it must ask something of a
higher pack, it opens a **slot**: a list of functions the loader fills at
workspace open, read in pack order, empty by default. The hook points above
are slots of the write and log packs; the others:

| Slot | Opened by | Filled by | Replaces |
|---|---|---|---|
| `log.appended` | log | usage | `bytes` called inside `log.append` |
| `rules.reply_ended` | rules | sessions | `rules.ts` importing `reply-rules.ts` |
| `walls.pass_store` | walls | surface (`transient`) | `look-pass.ts` importing `transient.ts` (a look pass kept in the transient store) |
| `loader.reads` | loader | surface | `packhost.ts` and `kernel-context.ts` importing `packreads.ts` (the sandbox's reads, and a kernel pack's `ctx.reads`, which names the pack asking); the surface root's `open.ts` loads it before any workspace opens |
| `identity.invited` | identity | mail (`member-mail.ts#invited`, in `kernel.hooks`), filled when the server starts (`packs/loader/kernel/server-slots.ts`, loaded by the surface's server start) | `members.ts` importing `mail.ts` |
| `open.<phase>` | identity (`src/lifecycle.ts`) | each root, by its `kernel/open.ts` (`OPEN`, and `LEADING` for what runs while the server leads), read in roots.json's order; an internal pack by `kernel.hooks`; what a service module still does there, `src/open-steps.ts` until its pack takes it | the fixed order in `Workspaces.load` |
| `surface.read`, `surface.act`, `surface.route` | surface | any | the closed tables in `tool-reads.ts`, `tool-acts.ts`, `server.ts` |
| `surface.reads` | surface | agents (`instructions`), usage (`told`); the kernel until their packs hold their modules: views and askview (`view`), timeaxis (`placed`). `events` is the reads API's own since wave 6 (`packreads-views`), eventlog being the log root's | `packreads*.ts` importing instructions, uses, touched, eventlog, views, timeaxis, query-flat |

This is also the fix for bug e_wpww27fm (trusted modules import services):
each import it names becomes a slot, cut by the step that moves the
importing module.

## The boot stub

`src/boot.ts`, a few hundred lines with no SQL, no route and no type name.
It is the server's entry point (`npm start`, `npm run dev`).

1. Reads `packs/roots.json`: the root packs in order, each with its hash.
2. Hashes each root pack's folder (`pack.json` and `kernel/**`, canonical
   JSON and SHA-256, `src/jcs.ts`, `src/hashes.ts`) and refuses to start on
   a difference, naming the pack and both hashes.
3. Starts the roots in order, handing each a context of the roots before it,
   by id. A root that asks for one after it stops the start.
4. Asks the loader for the hook points' and slots' fillings and hands them
   to the roots that opened them.
5. Opens a workspace: each root's `open` in order, then the `open.<phase>`
   slots (`restore`, `packs`, `types`, `begin`, `islands`, `ready`), then,
   on the server that leads, the declared `timers`.
6. Holds the one rule (core's `root`, which no setting lifts): no change on a
   map turns a root pack off, versions it on an island, gives it code, or
   makes a pack item with a root pack's id.
7. Records the root hashes on the control log at each start, and answers
   them in `GET /health` beside `commit` and `started`.
8. Stops the roots in reverse order.

**The owner's word for a root change** is their approval of the pull request
that changes `packs/roots.json`: a CI check refuses a change to a root pack's
folder that does not bring a new hash in `roots.json`, and refuses a change
to `roots.json` the repository's owner has not approved. An agent may
propose one; the refiner never applies one.

## The root packs

Started in this order; each needs only those above it in the table.

| # | Pack | Holds | Interface |
|---|---|---|---|
| 0 | core | words: starter types, shared set, core's rules | none: data |
| 1 | database | storage, row-level security, the shared lock | `open(ws)`, `scoped(viewer)`, `anyone()`, `asOwner(tx, sql)` (roots only), `definer(name)`, `tables(pack, spec)`, `migrate()`, `leading()` |
| 2 | seal | keys, and what forget destroys of them | `seal(id, text)`, `openSaid(id, bytes)`, `destroyKey(id)`, `secret(key)`, `setSecret(key, v)`, `opseal` |
| 3 | log | the record, its streams and projections, its copies | `append`, `head`, `read(cursor)`, `record(stream)`, `projectFacts`, `rebuild`, `snapshot`, `tail`, `dump`, `restore`; slots `log.project`, `log.appended`; `root.dump`, `root.merge` |
| 4 | identity | who is asking: people, tokens, workspaces | `who(request)`, tokens, members' core, `workspaces` (list, create, delete, operator), `scope`, `policy`; slot `identity.invited`; `root.workspaces` |
| 5 | walls | what may leave the server and what a page may run | `fetch(pack, url)` by reach, `pagePolicy`, `drawHost`, `cssCheck`, `svgFigure`, `scrub` (the public form), `publicDocument`, `unscopedRead` (the renamed `wholeMap`, its callers listed), `mailGate`, `drawingBox` (a drawing's first frame in a walled process), `lookPass`; slot `walls.pass_store` |
| 6 | loader | packs, versions, islands, the sandbox, the in-process tier | `Registry`, pack states, pins, island guards, `reach`, `host` (sandbox), `context(pack)` (the `KernelContext`), `call(service)`, `fillings(point)`; slot `loader.reads` |
| 7 | rules | who decides what applies | `decide(who, ops, runs)`, `judge`, `mayDo`, `authorityOf`, actor checks, `standing` (still writable, room to store), private deps, layout changes; slot `rules.reply_ended` |
| 8 | write | the one write path and the shape of an item | `change`, `apply`, `plan`, proposals (decide, withdraw, undo), merge, forget, ops, head, fields, link ends, owner link, within; points `write.*` |
| 9 | surface | the ten verbs, who may call them, the HTTP host | tools, MCP, CLI, the hook host, the server's routes and gates, the kernel reads (`get`, `search`, `schema`, `events`, `proposals`), the reads API (`packreads`, as `answerRead`); slots `surface.*`; `root.counters` |

The `Archipelago` class (`src/pelago.ts`) is taken apart on the way: change
and apply go to write, `search`, `get`, `trail` and `events` to surface,
`secret` to seal, `claim` and `release` to write as ops, `checkConnections`
to the connect pack. As built (wave 5): `search` is surface's `searchMap`
(`src/search.ts`), no longer the class's; `secret` and `setSecret` are the
seal's `readSecret` and `writeSecret`, the class's names kept as adapters;
`checkConnections` is the connect pack's (`src/check-connections.ts`),
filling `surface.act` as `check_connections`, and hands what it saw to the
class's `observed`, which keeps it on the write path. As built (wave 6): `get`,
`trail`, `hidden` and `proposals` left the class for surface's
`src/map-reads.ts` (`getItem`, `trail`, `hidden`, `proposals`); `events` is the
activity log's `readEvents` (`src/eventlog.ts`), asked where an answer needs it
(`get`'s recent events and the `events` read, `src/tool-reads.ts`); the queue's
read is the write root's `proposalsOf` (`src/proposals.ts`), which withdraw
reads too. The class keeps its writes, `entity` and `mentionedIn`. The rules root reads `rules.<on>`
fillings from the internal packs' `kernel.hooks`; sessions declares
`rules.reply_ended`.

## Where each module goes

Every one of the 272 modules in `src/` at a0438797 is in exactly one row
(checked against the audit's import graph). A mixed module goes whole to the
pack named first; the half in brackets is split off in the same step and
moves with a shim to the pack named.

### Root

| Pack | Modules |
|---|---|
| database | db, pg, schema, member-schema, migrate, read-indexes, public-schema, public-view-store, stats, config (policy half to identity), deploy, move, leader, mentions (step 25's table of what names what, kept as released) |
| seal | seal, opseal, vault, secrets, backup-seal |
| log | log, partitions, streams, oplog, retention, snapshot, rebuild, replay, project, facts, closure, activity, activity-steps, operational, tail, backup (dump and restore, and the root services root.dump and root.merge; the rest to backup), backup-log, bytes (the counts; its log.appended filling to usage), eventlog (wave 6: backup's dump and the surface's reads read events with a database or a transaction) |
| identity | auth, oauth, oauth-clients, passwords, person-tokens, token-tools, members (invite half to mail), control, control-index, scope, workspaces (tenancy; the load order becomes the stub's `open` phases) |
| walls | page-policies, draw-host, svg-figure, css-check, public, public-document, outbound, outbox, address, outside, notify-mail, drawing-box, drawing-runner, look-pass |
| loader | manifest, packorder, packs, packstate, pack-folders, pack-allow, pack-items, pack-code, pack-moved, island-pin, island-rules, islands, island-items (`placeOnIslands` to placement), reach, pack-reach, packhost, pack-runner, packtools, declared, capabilities (behaviour to `capability.*` providers), server-packs, server-reach, server-mounts, type-items, type-overlay, version-types, typetable, registry-at, registry-then, pack-launch, pack-action-launch, bundles, pack-versions, server-adapter, layouts, due-event (root.due) |
| rules | rules (reply rules to sessions), actor-checks, authority, private-deps, layout-changes, standing |
| write | pelago (reads to surface), change-apply, change-plan (automation checks to automations), ops, head, fields, link-ends, owner-link, within, pelago-types, proposals, withdraw, undo, merge, forget |
| surface | server, tools, tool-change, tool-human, tool-ops, tool-acts (session acts to sessions), tool-reads (watch, pictures to presence, publish), tool-config, mcp, surface, hooks, cli, first-start, server-host, server-requests, server-routes, server-streams, server-published, server-connect, server-gates, server-launch, server-files, server-acts, reply, limit, drain, ui-files, may, workspace-tools (and root.counters), workspace-use, backup-tools, search, transient, view-address, listing, packreads (and the slot surface.reads), packreads-kernel, packreads-log, packreads-pin, packreads-rows, packreads-service, packreads-scope (the scope half of sessions' places, which it re-exports), region, blocking |

### Service

| Pack | Modules |
|---|---|
| query | query-flat, query-terms, query-steps, query-only, query-held, query-presets, askview, views, altitude, timeaxis, summary |
| lenses | query-kept, query-saved, saved-views, view-life, view-twins, query-names |
| views | view-graph, view-tree, inside, brief, moved, timelanes, documents, plan-note |
| attention | attention, bounds, confirm |
| findings (exists) | findings |
| styles | styles, style-move, layout-move, screens, colours |
| agents | instructions, launch-brief, schema-brief |
| placement | subject, island-start, `placeOnIslands`; `ensureSource` from change-apply |
| waits | unwait |
| mentions | mentions (its projector; step 25's table went to database, its remake after a restore to log's `projectAgain`) |
| automation_triggers (required; automations stays plain, its handler in the sandbox) | automation-rules, due-on (what its edges met kept under `due_on:<automation>`, `kernel.memory`) |
| clocks | due (on its context: the reads `clock`, `timed`, `due_of` in `packreads-clocks`, item.due through `root.due`, a watched query's edges through automation_triggers' `act.report.due_on`; its timer is still registered in `src/open-steps.ts`, for the owner's alert on a failed pass, until alerts answers by a service name); duties went: stream and snapshot keeping to log's `LEADING`, the backup timer to backup's server duty (`backupDuty`), the server packs' schedules beside it in `whileLeads` (`src/leader.ts`) |
| sessions (exists) | sessions, chat-run, hook-answers, replies, reply-rules, reconcile, run-record, session-events, session-measures, session-name, session-parent, session-quiet, session-state, session-turns, sessiontime, touched, stands, spent, audit, working-rules, close-offer, file-said, frontier, frontier-prompt, places |
| clocks | due, duties |
| sessions (exists, optional) | sessions, chat-run, hook-answers, replies, reply-rules, reconcile, run-record, session-events, session-name, session-parent, session-quiet, session-turns (the view; its read is runs' answer.turns), touched, stands, audit, working-rules, close-offer, file-said |
| runs (required; decision e_w4bmpnx3) | frontier, frontier-prompt, session-state, session-measures, sessiontime, spent, places, run-turns (the read of session-turns); as built (wave 6b): on ctx, its SQL in `packreads-runs`, each read named `answer.*` in its manifest (frontier, worked_on, session_states, session_marks, run_spans, spent, session_measures, turns, place_for, lives_in, narrowed) |
| claude_code (exists) | hook-tool, session-hook |
| publish | published, published-data, published-frames, published-live, published-pictures, published-preview, public-bake, public-route, public-view, site, share-tools, drawing-files, pictures, pack-counts |
| mcp_apps | mcp-view |
| backup | backup's backupAll, upload and merge (through root services), and the server duty that asks every five minutes whether a backup is due (`backupDuty`, serverContext) |
| usage | usage (through root.counters), pack-touches, pack-use (reads `type_counts`, `uses_lately`; root.uses), uses (root.uses) |
| notifications | notify |
| mail (`packs/mailer`) | mail, smtp, bounces, member-mail |
| alerts | alert |
| looks | chrome, look-draw, icon, looks (`passFor` stays in walls) |
| launch | launcher (the token stays in identity) |
| connect | install, connect, token-ask, connection-tools, server-pack-tools (as built, wave 6b: install and server-pack-tools import nothing of the kernel, the latter through `root.server_packs`; the rest still do) |
| presence | presence, seeing |
| monitoring | report (the health tool stays the surface's, `report-tool.ts`, applying what `act.report.reading` says) |
| devtools | dev, pull |

Frontier goes to runs (decision e_w4bmpnx3, the owner, 12 Nov 2026): a required pack holding the reads of core's
`run` and `works_on`, which every pack may call, while sessions keeps the behaviour and stays optional. It ends
that part of bug e_j3a8ghe4. `frontier` left `LENS_ANSWERS` for runs' `answer.frontier` in the same step.

### Plumbing, kept in `src/`

env, ids, hashes, jcs, logged, text-widths, workspace-id, item-address,
phases: pure, no state, no map. Any tier may import them.

## Hot files: one owner each

Five files are touched by nearly every move. Each has one owning step at a
time; any other step may change only an `import` line in it, and the gather
step resolves those.

| File | First owner (wave 1b) | Then (wave 2) |
|---|---|---|
| `src/pelago.ts` | Write-path hooks (e_cusfdw68): turns each inline call (placement, twins, unwait, sources, automation checks) into a filling of a hook point, the code left where it is | Root pack: write (e_da3s6xtx) |
| `src/change-apply.ts` | Write-path hooks | Root pack: write |
| `src/workspaces.ts` | Workspace lifecycle hooks (e_kzw9bwq6): the load order becomes `open.<phase>` fillings, the clocks become timers | Root pack: identity (e_m2jd67rd) |
| `src/server.ts` | Acts and routes as fillings (new): the route and act tables become `surface.*` fillings | Root pack: tool surface (e_g45hh86u) |
| `src/tool-acts.ts` | Acts and routes as fillings | Root pack: tool surface |

The pattern for every hot file: its first owner turns what it calls inline
into fillings registered from the module that holds the code, without moving
anything; a later step then moves the module and its filling together and
never opens the hot file.

## How a step moves a module

- `git mv src/<m>.ts packs/<pack>/kernel/<m>.ts`, and leave a shim at the
  old path: `export * from '../packs/<pack>/kernel/<m>.ts';`. No importer
  changes in the wave, so steps do not collide. `test/structure.test.ts`
  keeps a list of the shims (`SHIMS`) that only shrinks after the wave.
- A service module's value imports of the kernel become `ctx` calls in the
  same step; a root module may import only plumbing and the `index.ts` of a
  root below it.
- Its tests stay in `test/` during the wave and reach it through the shim.
- Run the tests of the moved modules, the structure test and typecheck,
  as for any change (CLAUDE.md, Checks before committing).

## The order of the wave

Each wave is merged onto one branch, `kernel-packs`, before the next starts;
inside a wave every step runs at once, each in its own session and worktree.

| Wave | Steps (map task) | Owns |
|---|---|---|
| 0 | This contract (e_st5s6rj7) | `docs/kernel-packs.md` |
| 1a | The boot stub (e_em6mq8mx) | `src/boot.ts`, `packs/roots.json`, the start scripts, the CI check |
| 1a | Internal packs run in-process (e_bueph9jh) | `src/manifest.ts`, `src/packs.ts`, `src/packhost.ts`, a new `src/kernel-context.ts`; the `KERNEL_PACKS` line of `src/packorder.ts` |
| 1a | Open service names (e_dw8p6fyu) | the rest of `src/packorder.ts`, `src/capabilities.ts`, `src/declared.ts`, `src/query-presets.ts`, `src/query-terms.ts`, the setting policy in `src/schema.ts`, `src/workspace-tools.ts` |
| 1a | Reads API for kernel views (e_exet8395) | `src/packreads.ts` |
| 1a | A server pack carries a workspace half (e_jpcsbt48) | `src/pack-folders.ts`, `src/server-packs.ts` |
| 1b | Write-path hooks (e_cusfdw68), proved on mentions | `src/pelago.ts`, `src/change-apply.ts`, `src/change-plan.ts`, `src/replay.ts` |
| 1b | Workspace lifecycle hooks (e_kzw9bwq6), proved on clocks | `src/workspaces.ts`, `src/due.ts`, `src/duties.ts` |
| 1b | Acts and routes as fillings (new) | `src/server.ts`, `src/tool-acts.ts`, `src/tool-reads.ts`, `src/tools.ts` |
| 2 | The nine root packs, one step each (database, seal, log, identity, walls, loader, rules, write, tool surface) | the modules of their row |
| 2 | Query engine as a pack (new); Kept views and lenses (e_gdzjg96w); Kernel views (e_8f8m2xtf: views, attention, findings); Style resolution (e_eveqf4dt: styles, agents); Placement and waits (e_mhqvdzj6: placement, waits, sources); Automation behaviour (e_469wuqa3); Sessions behaviour (e_xzwgetrg); Publishing and baking (e_5fqwc5qh: publish, mcp_apps; after bugs e_xqq6vcec and e_fapdjf5b); Backup and usage (e_jjvdu795); Server-level services (e_n6s2ypa3: mail, alerts, looks, launch, connect, presence, monitoring, devtools, notifications) | the modules of their row |
| 2b | Claude Code hooks (e_c35gg6nh), after sessions | hook-tool, session-hook |
| 3 | Gather the kernel packs (e_j9gszd4j): drop the shims, rewrite imports by script, `src/` down to the stub and plumbing, tried on a pulled copy of the live map | everything; one public and one hosted PR |

Wave 2 is nineteen sessions; no two own the same module. A root step and a
service step that split one mixed module agree by the bracket in the table:
the root step leaves the service half in place behind a shim, and the
service step takes it.

## For the owner to confirm

- **An eighteenth manifest key, `kernel`**, allowed only on the server's own
  packs, rather than spreading trust over `reach` and `handlers`.
- **Nine code root packs and core**, not eight: the map lists nine root
  tasks, and walls and surface do not merge without a cycle.
- **Proposals, withdraw, undo, merge and forget go to write**, not to rules
  and seal as the map's tasks say: each applies a change, and rules sits
  below write. Backup's dump and restore go to log, beside the record they
  copy; leader goes to database, since it is a lock there.
- **The query engine is a service pack**, not root: it reads under
  row-level security and cannot change what control decides.
- **A system change applies unless a rule holds it**: `agent_changes` does
  not hold a service pack's own changes; `system_reach` and the pack's
  rules do.
- **The owner's word for a root change is their pull-request approval**,
  checked in CI with `packs/roots.json`.
- **Shims during the wave**, removed by the gather step, so nineteen sessions
  can move code without rewriting each other's imports.

## Moving in the wave (as built)

### Root packs

Set by the database step (e_8e5yhfdy); every root step moves its row the same way, and none edits
`test/structure.test.ts`.

- **Move.** `git mv src/<m>.ts packs/<pack>/kernel/<m>.ts`, and write the shim, whose only code
  is `export * from '../packs/<pack>/kernel/<m>.ts';` (comments allowed). The structure test finds
  shims by that shape (`SHIMS`, `test/structure-kit.ts`): there is no list to keep.
- **Imports in a moved module.** A module of the same pack stays `./<m>.ts`; anything still in
  `src/`, plumbing or a shim, is `../../../src/<m>.ts`; another pack's moved code may be named at
  its new place (`../../<p>/kernel/<m>.ts`) or through its shim. Fix what reads paths from its
  own place (`import.meta.url`, `import.meta.dirname`): one more `../../`. A module run as a
  script keeps answering at its old path (see `deploy.ts`: `node src/deploy.ts` is how the hosted
  deploy runs it).
- **The pack.** `pack.json` with `kernel: { trust: "root", internal: true, modules: "kernel/" }`,
  and `kernel/index.ts` exporting `start(ctx)`, which the stub calls at boot. While the wave lasts
  it loads nothing the server did not load before: it answers its parts as lazy `import()`s.
  Add the pack to `packs/roots.json` in its place in "The root packs", then `npm run roots` and
  `npm run roots:check`. Any later change under the pack's folder needs `npm run roots` again.
- **Every rule still applies, at the old path.** The structure test reads a shim as the moved
  module (its imports rewritten as if it were still in `src/`) and leaves the moved file out of
  its walk, so the 500 lines, the kernel naming no pack, one write path, named stores, no whole
  read, one-way imports and the rest count it under `src/<m>.ts` as before, and no ratchet list
  changes when a module moves. A root pack's code that was never in `src/` (its `index.ts`, a new
  module) is kernel code too (`rootCode`, `srcCode`). `test/bypassing-rls.test.ts` reads the same
  way. A root pack's tests stay in `test/`, through the shims, so it is spared "a pack's code
  comes with its tests" and "a pack's code imports nothing of the kernel".
- **What a root may import** (rule 22, `test/structure-roots.ts`): plumbing, its own pack, and the
  roots before it in "The root packs", at their new place or through their shims. Type-only
  imports do not count. Which pack a module is in is read from this document ("Where each
  module goes", "Plumbing"), or from where it now lives. The rule holds of every module of a root
  row, moved or not. What those modules imported above that when the wave began is owed, listed
  in `test/fixtures/root-imports.json` (193 imports when the wave began, as `src/<m>.ts -> src/<n>.ts`); an import
  not on it is refused. Cutting one needs no edit there; the gather step empties the list.
- **Run** the tests that import the moved modules, the structure test, `npm run roots:check` and
  `npm run typecheck`, and start a throwaway server with `node src/server.ts` (see below) to see
  `/health` answer the new root's hash.

- **Boot.** `node src/boot.ts` (`npm start`) starts (wave 6): `OPEN_PHASES` is in
  `src/open-phases.ts`, apart from the entry module, and the open phases no longer reach the stub.

## Moving a service in the wave (as built)

How the kernel views step (e_8f8m2xtf) moved its modules into `packs/attention`
and `packs/views`; every service step does the same, and none needs to edit
`test/structure.test.ts` for it.

### The pack

- `packs/<id>/pack.json` with `"kernel": { "trust": "service", "internal":
  true, "modules": "kernel/", "provides": { ... } }`; each module is moved with
  `git mv src/<m>.ts packs/<id>/kernel/<m>.ts`.
- A module imports only its own pack's files (`./x.ts`), `node:` built-ins, and
  `import type { KernelContext } from '#pelago/kernel'`. Never another pack,
  not even a sister service: a small pure helper is copied (`blocks.ts`, the
  block graph, is in both attention and views), anything else is a service name
  (`ctx.call`).
- Every value import of the kernel becomes the context: `ctx.reads` for the
  map, `ctx.registry` for types, links and capabilities, `ctx.call` for
  another pack. Each function takes `ctx` where it took `l`.
- An internal pack is the server's code: every registry reads a required one
  from the server's own folder (`OWN_PACKS`, `src/pack-folders.ts`), so a
  test's map or a copy of some packs has it as the server does. An optional
  one (`kernel.optional`, sessions) is read only where its folder is, and a map
  may turn it off.

### Reads

SQL stays in the kernel as a bounded read (`src/packreads-kernel.ts`, beside
`src/packreads.ts`), answered as the asker under row-level security. General
ones first: `ids` (items by id, every column, archived too), `links` (open
links from, to or among some items, or of some kinds; `order` kept, id or
newest; `limit`), `history` (an item's facts, opened, or its last position),
`tops`, `within` (a scope's ids), `blocks` (the block graph's edges),
`holds`, `owned`, `owner`, `ancestors`, `holding`. Reads a lens makes whole
(`region`, `kinds`) and what agents are told (`instructions`). Where the
database's own reckoning is the behaviour (a date against `current_date`, a
`numeric`), the module's SQL moves into the read as it was (`bounds`, and
`confirm`, now `settledUnconfirmed` in `src/packreads-log.ts`).

The reads API is surface's (decision e_yesqkpdg, the owner, 12 Nov 2026): `packreads` and its parts
live in `packs/surface/kernel/`, with `region` and `blocking`, the bounded scans they answer, and
keep their shims in `src/`. The loader's sandbox asks it through the slot `loader.reads`
(`fillReads`, `src/packhost.ts`), filled when `packreads` loads. `askview` and `views` stay in
query: in surface they would owe their imports of attention, usage, sessions, styles and agents
for the few they cut.

The reads API names no service (wave 5, e_8m5j9p37). A read a service answers is a filling of
surface's slot `surface.reads`, by the read's key, asked where the read was answered before (so a
read with several keys answers as it did): an internal pack names it in its manifest
(`"hooks": { "surface.reads": "reads.ts#instructions" }`, agents) and is handed its context of the
map that asks, any map, opened or not (`hostAt`, `src/kernel-context.ts`); a module still in
`src/` fills it from `KERNEL_FILLINGS` (`src/surface-fillings.ts`, through
`src/service-reads.ts`), until its pack holds it: `view` (with its pin) and `placed`; `events` left in wave 6, answered by
the reads API from the log root's eventlog (`packreads-views`). As built (wave 6): `told` is the usage pack's (`reads.ts#told`), and what a run touched
is the reads API's own, read from the transient store in `runsOf` (`src/packreads-log.ts`), since
sessions is optional and an optional pack fills only `write.*`. The query step (wave 6, e_5euvh74f) moved query-flat, query-terms, query-only, query-held, query-presets,
askview, views and timeaxis into `packs/query/kernel` behind pure shims, still on the map (`l`) and naming the kernel
at `../../../src/`: what they call is sessions' (optional, so it provides no name), or another pack's that provides
none, so `view` and `placed` stay kernel fillings until those packs answer by name. What is a place's or an item's (`livesIn`, `livesInFor`, `SCOPE`, `scopeOf`) is the
reads API's own bounded scan, `packreads-scope`; runs' places (wave 6b) keeps its own copy of `livesIn` and `livesInFor` over the registry, and `scopeOf` through the read `within`. `test/packreads-slots.test.ts`
pins each answer against its service's own functions.

The publish pack (wave 6b, e_pkytyzy7) is on its context, published and public-view with it, behind adapter shims:
its SQL is `packreads-publish` (items whole as `entity()` reads them, the types that can be public, the documents
published beside one, drafts at address words, the documents an item holds, a published document as anyone reads
it), what only a root may do is the seven `root.*` names above, the look is styles' `page.look` and a kept view's
picture lenses' `answer.kept_picture`. One module stays on the map behind a pure shim: `share-tools`, whose tool
inputs are zod shapes and whose asks (share_ask, publish_ask) are notifications made as the asking agent, which the
notifications pack makes only on the map.

### Answers

- A lens answer the kernel answered itself (`READINGS`, `src/query-presets.ts`)
  becomes `answer.<name>` the pack provides, and leaves `LENS_ANSWERS`
  (`src/declared.ts`) in the same step. A view that names it moves to the pack
  keeping its `core.x` id (core is re-pinned: `npm run roots`); a pack that
  names it from elsewhere says `"uses": ["service:answer.<name>"]` (canvas).
- An internal pack's answers are always there, so any pack's view may name
  them (`checkDeclared`'s `always`, filled from the registry's internal packs).
- An answer is called with `callAs(l, name, input)` (`src/kernel-context.ts`):
  the provider is handed a context of the map that asks, a person's view under
  their row-level security. `callService` runs the provider as the map the
  names were filled for at open: never use it for a read. The lens terms
  (`term.*`, `src/query-terms.ts`) still call it.

### The shim

At the old path, `src/<m>.ts`:

- A module whose functions take no map: `export * from
  '../packs/<id>/kernel/<m>.ts';` and nothing else.
- One whose functions took the map: `export *` from the module, `import * as
  moved` from it, `import type { Archipelago }`, and an adapter of the same
  name for each such function, which builds the pack's context when it is
  called:
  `const ctx = async (l) => (await import('./kernel-context.ts')).kernelContext(l, '<id>');`
  `export const f = async (l, ...rest) => moved.f(await ctx(l), ...rest);`
  The import is dynamic: `kernel-context.ts` reaches `packreads.ts`, which
  imports the query modules, which import shims, and a static import would be a
  cycle.

As built (wave 6b, looks, presence, mail, monitoring): a function that took the whole database and a screen
(presence, seeing, looks, bounces) is adapted to take the screen's map, and the database it is still handed is not
read: the pack's context of that map reaches the transient store through `root.transient`, which reads it as the
whole workspace, as its callers did. Notifications and alerts still import the kernel: a notification is applied past
the rules as the asker's actor, and an alert mails, which no context does yet (the report of e_jxdxg89p).

### Tests

- The tests in `test/` stay, unchanged, and reach the module through its shim.
- The pack carries its own beside its modules (`packs/<id>/kernel/*.test.ts`),
  run without a database: a fake context whose `reads` answers each read by
  its key from a few rows in memory. `test/sets.ts` runs these in the full set;
  a new file goes in `test/weights.json` at 0 until CI measures it.

### What the structure test is to check

- A file in `src/` is a shim when its only value import of a pack is
  `../packs/<id>/kernel/<its own name>.ts` (`export *`, `import * as`), its
  other imports are type-only, and its one dynamic import is
  `./kernel-context.ts`: it is listed (`SHIMS`), and not counted by "the
  kernel imports no pack's code".
- A shim's counts in the other ratchets go with its module: the step that
  moves one lowers or removes the module's entries (for this step,
  `NAMES_PACK_TYPES` loses `src/attention.ts` and `src/confirm.ts`).
