# Kernel code as packs

Every part of `src/` becomes a pack, and what is trusted is a declared tier,
not a place in the tree (decision e_3pxvwdn7, the owner, 12 Nov 2026). Ten
**root packs** (core's words and nine with code) hold control: changed only
with the owner's word, pinned by hash, needing nothing above them.
Twenty-four **service packs** run in-process beside them through one narrow,
typed context, and fill hook points the root packs open. One **boot stub**
that is no pack loads the roots. What stays in `src/` is the stub, nine
plumbing modules and four entries run by path (see "Plumbing").

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
| plain (no tier) | in the sandbox, as today (`packs/loader/kernel/packhost.ts`) | everything `docs/packs.md` gives a pack | anything in-process |

Core stays what it is, the pack of words every map starts with (starter
types, the shared set, core's rules). It joins the root list, so it is pinned
by hash too, and holds no code.

## The manifest key `kernel`

One key is added to the seventeen: `kernel`, read by `packs/loader/kernel/manifest.ts` and
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
  naming (`packs/loader/kernel/packorder.ts`). A service pack is always internal; a root
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
  change), the rules' checks of its events (`rules.*`) and the server's slots read
  once for the process (`loader.calls`, `loader.leading`, `surface.tools`,
  `surface.replies`), and declares no `provides`, `tables` or `timers`, which are
  filled once at a workspace's open and would outlive the switch. A server slot's
  filling is called on the asking map's context (decision e_5hfp4p7m, the owner,
  12 Nov 2026): a session's acts and hooks answer on any map, as the kernel's
  did; the leader's beat (`loader.leading`, decision e_nxqn32mb) runs a filling
  only on a map that has its pack on, read at each beat. A root pack is
  never optional. Sessions is optional. Automations stays a plain pack: its
  handler runs in the sandbox, which a kernel pack may not have; its triggers
  are the required `automation_triggers`, which does nothing on a map where
  automations is off. Claude Code stays a plain pack too (decision e_n7ruedb7,
  the owner, 12 Nov 2026): its adapter and launcher are server reach; its hook
  tool over MCP is the required `claude_code_hooks`, which fills the server
  slot `surface.tools` and answers on any map, as it did from sessions.
  What a run records (`packs/loader/kernel/pack-versions.ts`): the required internal packs are
  one entry, `internal`, the same on every map one server runs; an optional one
  is recorded as a plain pack is, its own `id@version` entry while it is on and
  none while it is off, so the record says the map's switch.
- **`memory`** (decision e_a8dh8fg3, the owner, 12 Nov 2026): the settings
  prefix a service pack's memory (the read `memory`) is kept under, in place of
  its own `pack:<id>:`: a prefix the code it took over kept there already, so
  nothing is migrated. Lower-case, ending in a colon, never `pack:`.
- **`families`** (wave 6b, the query step): the families whose every name a service pack may call (`ctx.call`)
  and list (`ctx.provided`) beside the names it requires or uses: the query pack's `answer` (a view names its
  answer) and `term` (a lens names its term).
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

`Reads` is the reads API the sandbox already has (`packs/surface/kernel/packreads.ts`), with
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
  bookkeeping held, or spared another hold, declares the rule. As built
  (wave 6b, e_rr96yyj3): sessions' writes are the rule
  `sessions.bookkeeping`, `then: "spare"` with `when: { bookkeeping: true }`
  (`packs/rules/kernel/rules.ts`): `root.bookkeep` sends a session's record of itself
  through `decide` as the sessions pack's bookkeeping, that rule lets it
  through, and the log's `rule` names it first among what it spared. The
  actor (the session's agent) and authority (none claimed) are as before
  (`test/bookkeeping-log.test.ts`). A spare rule matches only its own
  pack's bookkeeping, nothing lifts it, and it spares refusals as well as
  holds, as the old path skipped both.

## Service names

`service:<name>` joins `has:`, `type:`, `event:` and the shaped names
(`packs/loader/kernel/packorder.ts`). It names a function one pack provides and others call
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
| `answer.<name>` | a lens preset's answer (attention, brief, frontier...) | `LENS_ANSWERS`, `packs/loader/kernel/declared.ts`; `READINGS`, `packs/query/kernel/query-presets.ts` |
| `term.<word>` | a lens term (frontier, worked, moved, island, held) | `packs/query/kernel/query-terms.ts` |
| `capability.<name>` | a capability's behaviour (`occurs`, `capacityOf`) | `CAPABILITIES`, `packs/loader/kernel/capabilities.ts` |
| `setting.<key>` | a workspace setting and who may read it | the `member_setting_read` policy, `packs/database/kernel/schema.ts`; `packs/surface/kernel/workspace-tools.ts` |
| `piece.<name>`, `page.<name>` | what the page draws | `PIECES`, `PAGES`, `packs/loader/kernel/declared.ts` |
| `act.<verb>.<action>` | an action whose code is in-process | `ACT_TOOLS`, `packs/surface/kernel/tool-acts.ts` |

An internal pack's own declared action (`<pack>.<name>`, sent by an agent or
by one of its parts) runs as the `act.<verb>.<name>` its pack provides, and
answers as a sandboxed handler does (ops, reason, answer). That answer is made
so by the same path a handler's is (`PackHost.applied`,
`packs/loader/kernel/internal-act.ts`): one change set naming the action, its
pack and the part, on the caller's authority, judged by the rules.

The schema half of a closed list stays with the root pack that checks it
(capabilities' check stays in loader); the behaviour moves to its provider.

## Root services

What only a root may do (read a workspace whole, write past the one write path, read the server's
counters) a service pack asks for through the `root.*` family, and only the packs the owner listed
may (the owner, 12 Nov 2026, e_tjkzs42m). As built in `packs/loader/kernel/root-calls.ts`:

- **Provided by a root.** A root pack's manifest names each under `kernel.provides` as
  `root.<name>`, with its function (`<file>.ts#<export>`). A root provides no other name, and only a
  root provides one (`kernelProblems`, `packs/loader/kernel/manifest.ts`). The function is handed a `RootCall` (who
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
  (`packs/loader/kernel/kernel-context.ts`), which calls root services and nothing else.
- **Narrow.** Each name is what one service pack needs, and no more:

| Name | Root | For | Answers |
|---|---|---|---|
| `root.workspaces` | identity | backup | the workspaces the server holds |
| `root.dump` | log | backup | a workspace's backup and its vault's, the workspace held open while read |
| `root.merge` | log | backup | the writes a merge makes, and what they did |
| `root.counters` | surface | usage | a workspace's limits, its use of each and what that use is made of |
| `root.server_packs` | loader | connect | the server packs the server's folders hold, each as the owner is shown it, and those left out with why (wave 6b: the `server_packs` tool, wired at `packs/connect/kernel/server-pack-tools.ts`) |
| `root.observe` | write | connect | what a check of a connection saw: kept as an observation by who asked for the check, and the status with a line in the activity when it changed (wave 6b, e_gc8stacv: `check_connections`) |
| `root.uses` | surface | usage, query, sessions | the uses stream's counts held in memory: added to, or read (the kernel's callers name a workspace, so `packs/usage/kernel/uses.ts` counts with `serverContext`; the query pack counts a view asked); sessions counts a reply rule's asking (wave 6b, e_rr96yyj3) |
| `root.pack_view` | loader | query | what a plain pack's view answers, run in the sandbox as the actor who asked, on the island's version of the pack its params name (wave 6b, the query step) |
| `root.due` | loader | clocks | an item came due: item.due recorded on the map's activity stream as the kernel's and told to the sandboxed packs that hear it; its seq |
| `root.publish` | database | publish | publishing's writes, each with its event: the published and public_view rows (publish, unpublish, share, unshare), and an item made public or shared again as the one publishing |
| `root.may` | rules | publish | whether this kind of actor may publish or take down here (core's agent_publish, agent_unpublish) |
| `root.picture` | rules | publish | a picture kept for an item: the walls' SVG check, room to store, the row and its observation, as the one who sent it |
| `root.layout` | loader | publish | a pack's drawing as the server ships it (its hash, whether it has code) and the commit the server runs |
| `root.scene` | loader | publish | a pack's own drawing's first frame, run in its sandboxed process (bug e_mjuwqk4a: never code kept on the map), and whether its stylesheet passes |
| `root.drawing` | surface | publish | a drawing's module or service worker by its hash, as the reader may see the map, or whether the packs ship it |
| `root.public_product` | surface | publish | a product's public page, data or result's picture as anyone reads them, with the headers every public answer carries |
| `root.transient` | surface | looks, presence, mail, connect, sessions | the transient store, kept, read and taken (a key, a key with its bytes, a key read once, keys and prefixes at once) as the whole workspace of the calling map |
| `root.bookkeep` | write | sessions | a session's own record of itself as it always reached the log (wave 6b, e_5vtbam7d): a change applied as the session's actor, judged as its bookkeeping and let through by `sessions.bookkeeping` (e_rr96yyj3), the operational write, a claim and a give-back, what it vouches for as its own change through the rules, its events on the sessions stream deduplicated under their lock, an audit import with its cursor |
| `root.sessions` | surface | sessions | what the sessions pack needs of the whole workspace (wave 6b): the sessions at work, whether there is room for one more, the owner's settings of the reply rules; and what a hook is told of the server and of people (e_rr96yyj3): whether a setup is behind, the actions offered, the newest event, what people did after one with the newest described |
| `root.hook` | surface | claude_code_hooks | a session's hook called over MCP (report, action hook: the tool of claude_code_hooks, run on its own context, for the server pack its id names less `_hooks`, claude_code; decision e_n7ruedb7) answered as `/hooks/<surface>/<event>` answers it, with the server's packs, the code it runs, its setup version and working rules (wave 6b, e_rr96yyj3; `configureHookTool` is surface's `root-hook.ts`) |
| `root.look` | surface | looks | the UI's version, a look pass for the calling map's screen (walls), the room for another look this hour (rules) |
| `root.notify` | write | notifications | a notification made on the calling map as its sender, past the rules, private, for the sender's person or the owner; told to the packs that hear notification.made |
| `root.mail` | walls | alerts | a mail to the server's operator at PELAGO_ALERT_TO and no one else, with or without a map (a crash), through the mail gate |
| `root.token` | identity | connect | the token an approved request is handed: an agent's, for the approving person, within the items approved, that may only report |
| `root.connections` | surface | connect | the server packs a workspace may connect, whether each is ready and connected here, where to go to connect or ready one, and ending one, logged as the one who ends it |

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
| `loader.reads` | loader | surface | `packhost.ts` and `kernel-context.ts` importing `packreads.ts` (the sandbox's reads, and a kernel pack's `ctx.reads`, which names the pack asking); the surface root's `open.ts` loads it before any workspace opens |
| `identity.invited` | identity | mail (`member-mail.ts#invited`, in `kernel.hooks`), filled when the server starts (`packs/loader/kernel/server-slots.ts`, loaded by the surface's server start) | `members.ts` importing `mail.ts` |
| `identity.fetch` | identity | walls (`outbound.ts`, as it loads) | `oauth-clients.ts` importing `outbound.ts` (a client's document read through the guarded fetch) |
| `identity.use` | identity | surface (`workspace-use.ts`, as it loads) | `standing.ts` importing `workspace-use.ts` (a limit held against what is stored and asked) |
| `walls.mail` | walls | mail (`mail.ts#sender`, in `kernel.hooks`), filled when the server starts (`server-slots.ts`) | `notify-mail.ts` importing `mail.ts` |
| `loader.moves` | loader | lenses, styles (`moves.ts#moves`, in `kernel.hooks`) | `typetable.ts` importing the views' and styles' migrations; each owner said as a link is the map's `linkOwners` |
| `loader.lifts` | loader | rules (`rules.ts`, as it loads) | `packs.ts` and `declared.ts` importing `rules.ts` for LIFTS (the rule check itself is the loader's `rule-check.ts`) |
| `open.<phase>` | identity (`lifecycle.ts`) | each root, by its `kernel/open.ts` (`OPEN`, and `LEADING` for what runs while the server leads), read in roots.json's order; an internal pack by `kernel.hooks`; none of a service module's left (wave 7: the first island is the loader's islands step, asking placement's `answer.first_island`; the quiet sessions timer is sessions' filling of `loader.leading`) | the fixed order in `Workspaces.load` |
| `database.steps` | database (`packs/database/kernel/migrate.ts`, read by `packs/database/kernel/root-fills.ts`) | each root, by its `kernel/steps.ts`: `STEPS`, its parts of the numbered steps, and `OPENED`, what it does at every open of a database; read in roots.json's order when a database is first opened (wave 7, e_kgc2x7wu) | `migrate.ts` importing sixteen modules' schema steps, `db.ts` importing `partitions.ts` |
| `log.restored`, `log.restored_to` | log (`backup.ts`) | identity, by its `kernel/fills.ts`: `RESTORED`, a backup's local types; `RESTORED_TO`, a workspace restored onto a server listed and indexed | `backup.ts` importing `control.ts` and `control-index.ts` |
| `log.past` | log (`packs/log/kernel/rebuild.ts`, `asOf`) | loader, by its `kernel/fills.ts`: `PAST`, the registry at a position | `rebuild.ts` importing `packs.ts` and `registry-at.ts` |
| `surface.read`, `surface.act`, `surface.route` | surface | any internal pack (`surface.route`: the surface's own backup file route; `KERNEL_FILLINGS` and `src/surface-fillings.ts` gone in wave 7, `rechecked` the surface's own act) | the closed tables in `tool-reads.ts`, `tool-acts.ts`, `server.ts` |
| `surface.reads` | surface | agents (`instructions`), usage (`told`), query (`view`, `placed`, wave 6b). `events` is the reads API's own since wave 6 (`packreads-views`), eventlog being the log root's | `packreads*.ts` importing instructions, uses, touched, eventlog, views, timeaxis, query-flat |
| `surface.serve` | surface | publish (`published`, `public`, `preview`, `site_nav`, `bake`, `counts_since`), styles (`icon`, `page_style`, `lengths`), mailer (`mail`, `bounced`, `note_bounced`), connect (`connect`, `token_asked`, `token_polled`), backup (`backup`), look_draw (`looks`), alerts (`crash`), views (`for_reader`, `sections`): each `surface.<name>` in `kernel.hooks`, asked on a map or for the server (`packs/surface/kernel/above.ts`, wave 7) | the server's imports of those packs' modules (`server.ts`, `server-acts.ts`, `server-published.ts`, `server-streams.ts`, `server-mounts.ts`), and `public-document.ts` importing `documents.ts` |
| `surface.tools` | surface, for the server (`server-fillings.ts`, read once before anything is called) | publish (`share`, `publish` and their reads), connect (token requests, `server_packs`, `connections`), claude_code_hooks (`hook`, decision e_n7ruedb7): each a table of declared tools, inputs as JSON shapes (`tool-input.ts`), run on the pack's context | `tools.ts` importing share-tools, token-ask, connection-tools, server-pack-tools (wave 7) |
| `loader.calls` | loader, for the server (`own-calls.ts`, read once from the server's own folder) | sessions (its acts and `sessionAnswer`): an export called by name on the pack's own context of the asking map, whether or not the map has it on, so an optional pack may fill it (wave 7; e_5hfp4p7m) | the surface's and loader's imports of the sessions pack's `sessions.ts`, `hook-answers.ts` |
| `loader.leading` | loader, for the server (`leading.ts`, read once from the server's own folder; its beat is the loader's `LEADING`) | sessions (`session-quiet.ts#tick`, the look for quiet sessions): every 30 s in each workspace while this server leads, each filling on its pack's context of the map, run only where the map has its pack on, read at each beat (decision e_nxqn32mb, the owner, 12 Nov 2026) | identity's `workspaces.ts` importing `session-quiet.ts` for the kernel's quiet timer, the last owed root import |
| `surface.views`, `surface.replies` | surface, for the server (`view-words.ts`, `reply-words.ts`) | query (the views' names, list and words), sessions (what a reply rule counts): one filling each (wave 7) | the surface's imports of `askview.ts`, `reply-rules.ts` |
| `surface.mcp` | surface, for the server | mcp_apps (`surface-mcp.ts`): the capability, a tool's listing, the page as a resource; one filling | `mcp.ts` importing mcp-view (wave 7) |

This is also the fix for bug e_wpww27fm (trusted modules import services):
each import it names becomes a slot, cut by the step that moves the
importing module.

## The boot stub

`src/boot.ts`, a few hundred lines with no SQL, no route and no type name.
It is the server's entry point (`npm start`, `npm run dev`).

1. Reads `packs/roots.json`: the root packs in order, each with its hash.
2. Hashes each root pack's folder (`pack.json` and every other file of it but its README:
   `kernel/**`, `page/**`, `parts/**`, canonical
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
| 1 | database | storage, row-level security, the shared lock | `open(ws)`, `scoped(viewer)`, `anyone()`, `asOwner(tx, sql)` (roots only), `definer(name)`, `tables(pack, spec)`, `migrate()`, `leading()`; slot `database.steps` |
| 2 | seal | keys, and what forget destroys of them | `seal(id, text)`, `openSaid(id, bytes)`, `destroyKey(id)`, `secret(key)`, `setSecret(key, v)`, `opseal` |
| 3 | log | the record, its streams and projections, its copies | `append`, `head`, `read(cursor)`, `record(stream)`, `projectFacts`, `rebuild`, `snapshot`, `tail`, `dump`, `restore`; slots `log.project`, `log.appended`, `log.restored`, `log.restored_to`, `log.past`; `root.dump` |
| 4 | identity | who is asking: people, tokens, workspaces | `who(request)`, tokens, members' core, `workspaces` (list, create, delete, operator), `unscopedRead` (the renamed `wholeMap`, its callers listed), actor checks, `standing` (still writable, room to store), `policy`; slots `identity.invited`, `identity.fetch`, `identity.use`; `root.workspaces`, `root.token` |
| 5 | walls | what may leave the server and what a page may run | `fetch(pack, url)` by reach, `pagePolicy`, `drawHost`, `cssCheck`, `svgFigure`, `scrub` (the public form), `publicDocument`, `mailGate`, `drawingBox` (a drawing's first frame in a walled process), `lookPass`; slot `walls.mail`; `root.mail` |
| 6 | loader | packs, versions, islands, the sandbox, the in-process tier | `Registry`, pack states, pins, island guards, `reach`, `host` (sandbox), `context(pack)` (the `KernelContext`), `call(service)`, `fillings(point)`, a pack's rules checked; slots `loader.reads`, `loader.moves`, `loader.lifts` |
| 7 | rules | who decides what applies | `decide(who, ops, runs)`, `judge`, `mayDo`, `authorityOf`, private deps, layout changes; slot `rules.reply_ended` |
| 8 | write | the one write path and the shape of an item | `change`, `apply`, `plan`, proposals (decide, withdraw, undo), merge, forget, ops, head, fields, link ends, owner link, within; points `write.*`; `root.notify`, `root.merge` |
| 9 | surface | the ten verbs, who may call them, the HTTP host | tools, MCP, CLI, the hook host, the server's routes and gates, the kernel reads (`get`, `search`, `schema`, `events`, `proposals`), the reads API (`packreads`, as `answerRead`); slots `surface.*`; `root.counters`, `root.connections` |

The `Archipelago` class (`packs/write/kernel/pelago.ts`) is taken apart on the way: change
and apply go to write, `search`, `get`, `trail` and `events` to surface,
`secret` to seal, `claim` and `release` to write as ops, `checkConnections`
to the connect pack. As built (wave 5): `search` is surface's `searchMap`
(`packs/surface/kernel/search.ts`), no longer the class's; `secret` and `setSecret` are the
seal's `readSecret` and `writeSecret`, the class's names kept as adapters;
`checkConnections` is the connect pack's (`packs/connect/kernel/check-connections.ts`),
filling `surface.act` as `check_connections`, and hands what it saw to the
class's `observed`, which keeps it on the write path. As built (wave 6b, e_gc8stacv): it runs
on its context, calling each connection's own URL (its reach's `items`) and handing what it saw to
the write root's `root.observe`, which calls `observed` as the one who asked; KERNEL_FILLINGS no
longer names it. As built (wave 6): `get`,
`trail`, `hidden` and `proposals` left the class for surface's
`packs/surface/kernel/map-reads.ts` (`getItem`, `trail`, `hidden`, `proposals`); `events` is the
activity log's `readEvents` (`packs/log/kernel/eventlog.ts`), asked where an answer needs it
(`get`'s recent events and the `events` read, `packs/surface/kernel/tool-reads.ts`); the queue's
read is the write root's `proposalsOf` (`packs/write/kernel/proposals.ts`), which withdraw
reads too. The class keeps its writes, `entity` and `mentionedIn`. The rules root reads `rules.<on>`
fillings from the internal packs' `kernel.hooks`; sessions declares
`rules.reply_ended`.

## Where each module goes

Every module lives in its pack's `kernel/` folder (`packs/<id>/kernel/<m>.ts`), and
every importer names it there. The tables list each pack's modules as they are. The 272
modules `src/` held at a0438797 were each given a row by this contract; the waves moved
them behind shims at their old paths, and the gather step (`scripts/gather.ts`, task
e_3yz459ez) removed every shim and rewrote every importer.

### Root

| Pack | Modules |
|---|---|
| database | config, config-words, db, index, leader, member-schema, mentions, migrate, pg, public-schema, public-view-store, publish-rows, read-indexes, root-fills, schema, stats, steps, transient |
| seal | backup-seal, index, opseal, seal, secrets, steps, vault |
| log | activity, activity-steps, backup, backup-log, bytes, closure, eventlog, facts, index, log, log-project, move, open, operational, oplog, partitions, project, rebuild, replay, retention, snapshot, steps, streams, tail |
| identity | actor-checks, auth, control, control-index, deploy, email-address, fills, index, lifecycle, members, oauth, oauth-clients, open, open-phases, outbox, passwords, person-tokens, policy, reply, root-services, root-token, sign-in, standing, steps, token-tools, workspaces |
| walls | address, css-check, draw-host, drawing-box, drawing-runner, index, look-pass, notify-mail, outbound, page-policies, public-document, svg-figure |
| loader | altitude, bundles, capabilities, code-folder, declared, due-event, fields, fills, head, index, island-items, island-pin, island-rules, islands, kernel-context, layout-services, layouts, leading, link-ends, log-slots, manifest, open, outside, own-calls, pack-action-launch, pack-allow, pack-code, pack-folders, pack-items, pack-launch, pack-moved, pack-reach, pack-runner, pack-touches, pack-versions, pack-view, packhost, packorder, packs, packstate, packtools, reach, registry-at, registry-then, root-calls, root-services, rule-check, rule-events, server-adapter, server-packs, server-reach, server-slots, services, steps, type-items, type-overlay, typetable, version-types, working-rules |
| rules | authority, index, layout-changes, open, private-deps, publish-services, rules |
| write | backup-merge, change-apply, change-plan, forget, index, merge, open, ops, owner-link, pelago, pelago-types, proposals, root-bookkeep, root-notify, root-services, scope-of, steps, undo, withdraw, within, write-fillings, write-hooks |
| surface | above, asked-lately, backup-route, backup-tools, blocking, cli, connect-routes, drain, first-start, hooks, icon, index, launcher, limit, listing, map-reads, may, mcp, open, packreads, packreads-clocks, packreads-flat, packreads-kernel, packreads-log, packreads-pin, packreads-presence, packreads-publish, packreads-query, packreads-rows, packreads-runs, packreads-scope, packreads-service, packreads-sessions, packreads-views, plan-note, public, public-documents, public-views, publish-services, recheck, region, reply, reply-words, report-tool, root-connections, root-hook, root-looks, root-sessions, root-transient, scope, search, server, server-acts, server-connect, server-files, server-fillings, server-gates, server-host, server-launch, server-mounts, server-published, server-requests, server-routes, server-streams, session-calls, steps, surface, surface-slots, tool-acts, tool-change, tool-config, tool-human, tool-input, tool-ops, tool-reads, tool-said, tools, ui-files, view-address, view-words, workspace-tools, workspace-use |

### Service

| Pack | Modules |
|---|---|
| agents | instructions, launch-brief, query-answers, reads, schema-answers, schema-brief |
| alerts | alert |
| attention | attention, blocks, bounds, confirm, moved, query-answers, rows |
| automation_triggers | automation-rules, due-on, edges, validate |
| backup | backup-run, served |
| claude_code_hooks | hook-tool |
| clocks | due, when |
| connect | check-connections, connect, connection-tools, install, served, server-pack-tools, surface-tools, token-ask |
| lenses | kept-picture, lens-words, moves, query-answers, query-kept, query-names, query-saved, saved-views, shown-in, view-life, view-twins |
| look_draw | chrome, look-draw, looks, served, store |
| mailer | bounces, email-address, mail, member-mail, served, smtp, store |
| mcp_apps | mcp-view, surface-mcp |
| mentions | mentions |
| monitoring | report |
| notifications | notify |
| placement | island-place, island-start, ops, sources, subject |
| presence | acts, presence, seeing, store, surface-reads |
| publish | document-read, drawing-files, map, pack-counts, pictures, public-bake, public-route, public-view, public-view-freeze, published, published-data, published-frames, published-freeze, published-live, published-pictures, published-preview, served, share-tools, site, surface-tools |
| query | answers, askview, island-legend, query-flat, query-only, query-presets, query-steps, query-terms, reads, repeat, summary, timeaxis, views |
| runs | answers, frontier, frontier-prompt, places, run-story, run-turns, session-measures, session-state, sessiontime, spent |
| sessions (optional) | audit, bookkeeping, chat-run, close-offer, file-said, hook-answers, places, reconcile, replies, reply-rules, run-record, session-events, session-hook, session-life, session-name, session-parent, session-quiet, session-turns, sessions, stands, touched, types |
| styles | colours, layout-move, moves, page-css, query-answers, schema-styled, screens, style-move, styles, view-style |
| usage | appended, pack-use, query-answers, reads, usage, uses |
| views | answers, blocks, brief, documents, findings, inside, query-answers, rows, timelanes, view-graph, view-tree |
| waits | unwait |

### Plumbing, kept in `src/`

env, ids, hashes, jcs, logged, text-widths, workspace-id, item-address,
phases: pure, no state, no map. Any tier may import them.

Beside them, `boot.ts` (the stub) and four entries run by path, each of which
only runs its module: `server.ts` (`node src/server.ts`, the hosted image's
command, boots as `node src/boot.ts` does), `deploy.ts` (`npm run migrate` and
the hosted deploy scripts: the identity root's `deploy`), `backup.ts` (a
restore from the command line: the log root's `restoreCommand`) and `cli.ts`
(`npm run pelago`: the surface's command line).

## Hot files: one owner each

During the waves, five files were touched by nearly every move. Each had one
owning step at a time; any other step changed only an `import` line in it, and
the gather step resolved those.

| File | First owner (wave 1b) | Then (wave 2) |
|---|---|---|
| `packs/write/kernel/pelago.ts` | Write-path hooks (e_cusfdw68): turns each inline call (placement, twins, unwait, sources, automation checks) into a filling of a hook point, the code left where it is | Root pack: write (e_da3s6xtx) |
| `packs/write/kernel/change-apply.ts` | Write-path hooks | Root pack: write |
| `packs/identity/kernel/workspaces.ts` | Workspace lifecycle hooks (e_kzw9bwq6): the load order becomes `open.<phase>` fillings, the clocks become timers | Root pack: identity (e_m2jd67rd) |
| `packs/surface/kernel/server.ts` | Acts and routes as fillings (new): the route and act tables become `surface.*` fillings | Root pack: tool surface (e_g45hh86u) |
| `packs/surface/kernel/tool-acts.ts` | Acts and routes as fillings | Root pack: tool surface |

The pattern for every hot file: its first owner turns what it calls inline
into fillings registered from the module that holds the code, without moving
anything; a later step then moves the module and its filling together and
never opens the hot file.

## Where new kernel code goes

- A module of a root pack goes in `packs/<root>/kernel/` and imports only plumbing, its own pack and the roots
  before it (rule 22); where it must ask a higher pack, it opens a slot ("Slots").
- A module of a service pack goes in `packs/<id>/kernel/` and imports only its own files, `node:` built-ins and
  `import type { KernelContext } from '#pelago/kernel'` (rule 4); what it needs of the kernel is its context.
- Its tests go in `test/` (a root's, or one that needs a database) or beside it (`packs/<id>/kernel/*.test.ts`,
  run on a fake context); each names the module at its own place.
- A change under a root pack's folder or `packs/core` changes its pinned hash: `npm run roots`.

During the waves a step moved a module with `git mv` and left a shim at its old path in `src/`, so no importer
changed and steps did not collide; the gather step removed them all (`scripts/gather.ts`).


## The order of the wave

Each wave is merged onto one branch, `kernel-packs`, before the next starts;
inside a wave every step runs at once, each in its own session and worktree.

| Wave | Steps (map task) | Owns |
|---|---|---|
| 0 | This contract (e_st5s6rj7) | `docs/kernel-packs.md` |
| 1a | The boot stub (e_em6mq8mx) | `src/boot.ts`, `packs/roots.json`, the start scripts, the CI check |
| 1a | Internal packs run in-process (e_bueph9jh) | `packs/loader/kernel/manifest.ts`, `packs/loader/kernel/packs.ts`, `packs/loader/kernel/packhost.ts`, a new `packs/loader/kernel/kernel-context.ts`; the `KERNEL_PACKS` line of `packs/loader/kernel/packorder.ts` |
| 1a | Open service names (e_dw8p6fyu) | the rest of `packs/loader/kernel/packorder.ts`, `packs/loader/kernel/capabilities.ts`, `packs/loader/kernel/declared.ts`, `packs/query/kernel/query-presets.ts`, `packs/query/kernel/query-terms.ts`, the setting policy in `packs/database/kernel/schema.ts`, `packs/surface/kernel/workspace-tools.ts` |
| 1a | Reads API for kernel views (e_exet8395) | `packs/surface/kernel/packreads.ts` |
| 1a | A server pack carries a workspace half (e_jpcsbt48) | `packs/loader/kernel/pack-folders.ts`, `packs/loader/kernel/server-packs.ts` |
| 1b | Write-path hooks (e_cusfdw68), proved on mentions | `packs/write/kernel/pelago.ts`, `packs/write/kernel/change-apply.ts`, `packs/write/kernel/change-plan.ts`, `packs/log/kernel/replay.ts` |
| 1b | Workspace lifecycle hooks (e_kzw9bwq6), proved on clocks | `packs/identity/kernel/workspaces.ts`, `packs/clocks/kernel/due.ts`, `duties.ts` (gone since) |
| 1b | Acts and routes as fillings (new) | `packs/surface/kernel/server.ts`, `packs/surface/kernel/tool-acts.ts`, `packs/surface/kernel/tool-reads.ts`, `packs/surface/kernel/tools.ts` |
| 2 | The nine root packs, one step each (database, seal, log, identity, walls, loader, rules, write, tool surface) | the modules of their row |
| 2 | Query engine as a pack (new); Kept views and lenses (e_gdzjg96w); Kernel views (e_8f8m2xtf: views, attention, findings); Style resolution (e_eveqf4dt: styles, agents); Placement and waits (e_mhqvdzj6: placement, waits, sources); Automation behaviour (e_469wuqa3); Sessions behaviour (e_xzwgetrg); Publishing and baking (e_5fqwc5qh: publish, mcp_apps; after bugs e_xqq6vcec and e_fapdjf5b); Backup and usage (e_jjvdu795); Server-level services (e_n6s2ypa3: mail, alerts, looks, launch, connect, presence, monitoring, devtools, notifications) | the modules of their row |
| 2b | Claude Code hooks (e_c35gg6nh), after sessions | hook-tool, session-hook |
| 3 | Gather the kernel packs (e_j9gszd4j, e_3yz459ez): drop the shims, rewrite imports by script (`scripts/gather.ts`), `src/` down to the stub, plumbing and the entries run by path; done, its final check on a pulled copy of the live map (e_m87ucjvj) and the hosted PR to follow | everything; one public and one hosted PR |

Wave 2 was nineteen sessions; no two own the same module. A root step and a
service step that split one mixed module agree by the bracket in the table:
the root step left the service half in place behind a shim, and the
service step took it.

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

## A root pack

Set by the database step (e_8e5yhfdy) and kept by every root since.

- **The pack.** `pack.json` with `kernel: { trust: "root", internal: true, modules: "kernel/" }`,
  and `kernel/index.ts` exporting `start(ctx)`, which the stub calls at boot; it answers its parts as lazy
  `import()`s. Its place in `packs/roots.json` is its place in "The root packs"; `npm run roots` pins its hash and
  `npm run roots:check` checks it.
- **Imports.** A module of the same pack is `./<m>.ts`, plumbing is `../../../src/<m>.ts`, another root's code is
  `../../<p>/kernel/<m>.ts`. What reads paths from its own place (`import.meta.url`, `import.meta.dirname`) counts
  from `packs/<p>/kernel/`. A module run as a script answers at its entry in `src/` too ("Plumbing").
- **Every rule applies at its own place.** The structure test reads each module where it lives: a root pack's code is
  kernel code (`rootCode`, `srcCode`), under the 500 lines, the kernel naming no pack, one write path, named stores,
  no whole read, one-way imports and the rest; the lists keyed by a path name it at `packs/<p>/kernel/<m>.ts`.
  `test/bypassing-rls.test.ts` reads the same way. A root pack's tests are in `test/`, so it is spared "a pack's
  code comes with its tests" and "a pack's code imports nothing of the kernel".
- **What a root may import** (rule 22, `test/structure-roots.ts`): plumbing, its own pack, and the roots before it
  in "The root packs". Type-only imports do not count. What the roots imported above that when the wave began was owed
  (`test/fixtures/root-imports.json`, 193 imports then); every one is cut, by a slot or by moving the code, the last
  by the slot `loader.leading` (e_nxqn32mb). The list is empty and nothing is added to it.
- **Boot.** `node src/boot.ts` (`npm start`) starts the roots: `OPEN_PHASES` is identity's `open-phases.ts`, apart
  from the entry module, and the open phases do not reach the stub.


## A service pack

How the kernel views step (e_8f8m2xtf) made `packs/attention` and `packs/views`; every service pack is made the same
way.


### The pack

- `packs/<id>/pack.json` with `"kernel": { "trust": "service", "internal":
  true, "modules": "kernel/", "provides": { ... } }`; its modules in
  `packs/<id>/kernel/`.
- A module imports only its own pack's files (`./x.ts`), `node:` built-ins, and
  `import type { KernelContext } from '#pelago/kernel'`. Never another pack,
  not even a sister service: a small pure helper is copied (`blocks.ts`, the
  block graph, is in both attention and views), anything else is a service name
  (`ctx.call`).
- Every value import of the kernel becomes the context: `ctx.reads` for the
  map, `ctx.registry` for types, links and capabilities, `ctx.call` for
  another pack. Each function takes `ctx` where it took `l`.
- An internal pack is the server's code: every registry reads a required one
  from the server's own folder (`OWN_PACKS`, `packs/loader/kernel/pack-folders.ts`), so a
  test's map or a copy of some packs has it as the server does. An optional
  one (`kernel.optional`, sessions) is read only where its folder is, and a map
  may turn it off.

### Reads

SQL stays in the kernel as a bounded read (`packs/surface/kernel/packreads-kernel.ts`, beside
`packs/surface/kernel/packreads.ts`), answered as the asker under row-level security. General
ones first: `ids` (items by id, every column, archived too), `links` (open
links from, to or among some items, or of some kinds; `order` kept, id or
newest; `limit`), `history` (an item's facts, opened, or its last position),
`tops`, `within` (a scope's ids), `blocks` (the block graph's edges),
`holds`, `owned`, `owner`, `ancestors`, `holding`. Reads a lens makes whole
(`region`, `kinds`) and what agents are told (`instructions`). Where the
database's own reckoning is the behaviour (a date against `current_date`, a
`numeric`), the module's SQL moves into the read as it was (`bounds`, and
`confirm`, now `settledUnconfirmed` in `packs/surface/kernel/packreads-log.ts`).

The reads API is surface's (decision e_yesqkpdg, the owner, 12 Nov 2026): `packreads` and its parts
live in `packs/surface/kernel/`, with `region` and `blocking`, the bounded scans they answer. The loader's sandbox asks it through the slot `loader.reads`
(`fillReads`, `packs/loader/kernel/packhost.ts`), filled when `packreads` loads. `askview` and `views` stay in
query: in surface they would owe their imports of attention, usage, sessions, styles and agents
for the few they cut.

The reads API names no service (wave 5, e_8m5j9p37). A read a service answers is a filling of
surface's slot `surface.reads`, by the read's key, asked where the read was answered before (so a
read with several keys answers as it did): an internal pack names it in its manifest
(`"hooks": { "surface.reads": "reads.ts#instructions" }`, agents) and is handed its context of the
map that asks, any map, opened or not (`hostAt`, `packs/loader/kernel/kernel-context.ts`); a module still in
`src/` filled it from `KERNEL_FILLINGS` (`src/surface-fillings.ts`) until its pack held it, and none is left: `view` (with its pin) and `placed` are the query pack's since wave 6b; `events` left in wave 6, answered by
the reads API from the log root's eventlog (`packreads-views`). As built (wave 6): `told` is the usage pack's (`reads.ts#told`), and what a run touched
is the reads API's own, read from the transient store in `runsOf` (`packs/surface/kernel/packreads-log.ts`), since
sessions is optional and an optional pack fills only `write.*`. The query step (wave 6, e_5euvh74f) moved query-flat, query-terms, query-only, query-held, query-presets,
askview, views and timeaxis into `packs/query/kernel`, then still on the map (`l`) and naming the kernel
at `../../../src/`: what they call is sessions' (optional, so it provides no name), or another pack's that provides
none, so `view` and `placed` stayed kernel fillings. As built (wave 6b, e_xdcwzbcg): the query pack is on its context. What it called is a name its pack provides (runs' frontier, worked_on, session_states, session_marks, run_spans, spent, session_measures, lives_in; attention's `answer.moved`; views' `answer.time_lanes`; lenses' `answer.hubs_of` and `answer.saved_views`; usage's `answer.usage`; styles' `answer.page_style`; agents' `answer.instructions`, whose `for` is session_start unless said), a root's (`root.uses`, `root.pack_view`), or a read: the flat lens's SQL is `packreads-flat` (`flat`, `flat_ends`, `flat_pos`: the seeds, the narrowing and the walk, held changes, Only's words), the operational views' `packreads-query` (`changed`, `open_runs`, `notifications`, `placed_rows`, `time_zone`). A read that names an island is the context's `island`. query-held went into `packreads-flat`. What is a place's or an item's (`livesIn`, `livesInFor`, `SCOPE`, `scopeOf`) is the
reads API's own bounded scan, `packreads-scope`; runs' places (wave 6b) keeps its own copy of `livesIn` and `livesInFor` over the registry, and `scopeOf` through the read `within`. `test/packreads-slots.test.ts`
pins each answer against its service's own functions.

The publish pack (wave 6b, e_pkytyzy7) is on its context, published and public-view with it:
its SQL is `packreads-publish` (items whole as `entity()` reads them, the types that can be public, the documents
published beside one, drafts at address words, the documents an item holds, a published document as anyone reads
it), what only a root may do is the seven `root.*` names above, the look is styles' `page.look` and a kept view's
picture lenses' `answer.kept_picture`. `share-tools` is on it too (wave 6b, e_zdmf9bc6): its asks (share_ask,
publish_ask) notify as the asking agent by `act.report.notify`, and the `document` tool reads with a copy of the views
pack's reader (`document-read.ts`), which answers it by no name.

A pack's tool declares its input as a JSON shape (wave 6b): the sketch above (`"string"`, `"number"`, `"boolean"`,
`"id"`, `"any"`, `[shape]`, `{ "key": shape, "key?": shape }`), a list of two or more words for an enum, and what each
field is for in `says`, by its path (`"authority.of"`). The surface builds the zod schema where the tools are
registered (`declaredTools`, `packs/surface/kernel/tool-input.ts`), handing each run the pack's context of the map
that asks; `test/pack-tool-inputs.test.ts` pins every such tool's schemas against what they were in zod.

The surface's acts (wave 7, e_ybqc4nee: `tool-acts`, `tool-change`, `tool-human`) keep their words and ask what is
above them by service name, with `callAs` as the map that asks: the owner's screen is the presence pack's
(`act.report.point`, `act.report.took`, `act.report.screen`, `answer.sight`, each told `whose` screen: the workspace
and the person the map is read as), a look look_draw's (`answer.look`), a picture publish's (`act.capture.picture`),
a notification notifications' (`act.report.notify`), what a session is told agents' (`answer.instructions`) and where
it stands runs' (`answer.frontier`), what the owner is to confirm attention's (`answer.to_confirm`), what no longer
waits on them waits' (`answer.waiting_on`), where a change is seen lenses' (`answer.picture_of`), and a backup merged
backup's (`act.capture.backup_merge`, on the whole map). A refused change is kept in the transient store through
`root-transient.ts` as the surface's own. What is left of them is sessions' (audit, sessions, close-offer).

### Answers

- A lens answer the kernel answered itself (`READINGS`, `packs/query/kernel/query-presets.ts`)
  becomes `answer.<name>` the pack provides, and leaves `LENS_ANSWERS`
  (`packs/loader/kernel/declared.ts`) in the same step. A view that names it moves to the pack
  keeping its `core.x` id (core is re-pinned: `npm run roots`); a pack that
  names it from elsewhere says `"uses": ["service:answer.<name>"]` (canvas).
- An internal pack's answers are always there, so any pack's view may name
  them (`checkDeclared`'s `always`, filled from the registry's internal packs).
- An answer is called with `callAs(l, name, input)` (`packs/loader/kernel/kernel-context.ts`):
  the provider is handed a context of the map that asks, a person's view under
  their row-level security. `callService` runs the provider as the map the
  names were filled for at open: never use it for a read. The lens terms
  (`term.*`) are the query pack's `ctx.call`, the family open to it (`kernel.families`).

### Callers in the kernel and in tests

A kernel caller reaches a service by its service name (`callAs(l, name, input)`, as the map that asks), or through
a slot the service fills; it imports none of its code. A test that calls a service's function directly builds the
pack's context of its map where it calls it (`kernelContext(l, '<id>')`, or `ownContext` for an optional pack,
`serverContext` for a server duty), as the shims' adapters did until the gather inlined them.

A function that takes a screen (presence, seeing, looks, bounces) takes the screen's map: the pack's context of that
map reaches the transient store through `root.transient`, which reads it as the whole workspace, as its callers did.
Notifications and alerts are on their contexts (wave 6b, e_zdmf9bc6): a notification is applied past the rules as its
sender by the write root (`root.notify`), and an alert mails the operator through the walls (`root.mail`), a crash
with no map as a server duty (`serverContext`).


### Tests

- The tests in `test/` name the pack's module at its own place, and build its context where they call it.
- The pack carries its own beside its modules (`packs/<id>/kernel/*.test.ts`),
  run without a database: a fake context whose `reads` answers each read by
  its key from a few rows in memory. `test/sets.ts` runs these in the full set;
  a new file goes in `test/weights.json` at 0 until CI measures it.


### What the structure test checks

- A service pack's code imports nothing of the kernel (rule 4), at its own place.
- The kernel (`src/` and the root packs' code) imports no service pack's code: "the kernel imports no pack's code"
  counts a value import of any pack that is not a root.
- A ratchet's entries name a module where it lives; when a step brings a count down, it lowers or removes the entry.
- **As built (12 Nov 2026), the lists are empty**: NAMES_PACK_TYPES, NAMES_SURFACES, NAMES_SESSION_ACTS, READS_KINDS,
  WHOLE_READS, CALLS_SERVICE and `test/fixtures/root-imports.json`.
- **The kernel's own words** (e_m8arpfew): "the kernel names no pack's type by its bare name" leaves out
  `KERNEL_WORDS`, beside `LEFT_CORE`, each with why: action, settles, document, commit, project, requires, release,
  diagram, note, file. The page says them plainly again (Home's project level, the file chooser, the note's class,
  the document and figure pieces).
- **A released schema step is history** (e_2tmdv4p9, `test/structure-history.ts`): the steps at or below `RELEASED`
  (44, main's latest) are read with their SQL blanked, the constants a root's `steps.ts` names for them and what only
  they use, so the bare-name, kind and whole-read rules count nothing there. "A released schema step is never edited"
  pins their hash (`RELEASED_KEY`); a step that reaches main raises both.
