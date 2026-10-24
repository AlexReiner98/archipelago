# The log's event format

Archipelago's stored state is one append-only log per workspace; everything read
is a projection of it (the owner's decision of 24 Oct 2026, `e_d2p6ejz3`; the
design is `e_76ds7tkm`). This is the spec of what an entry in that log is: its
fields, how it is hashed, how facts say what changed, how proposals, retention,
per-item keys, versions and snapshots meet it. It is written before any code;
the questions it leaves to the owner are listed at the end and on the task
(`e_j8df78ar`).

## In one paragraph

A workspace's log is a set of **streams**. The **fact stream** holds approved
change sets, each one **entry**: a header (position, time, actor, authority,
the rule that decided it, reason, source) and a list of **facts**, each the
assertion or retraction of one value of one field of one item or link. Every
entry carries the hash of the one before it, so the fact stream is a hash
chain, kept forever. **Operational** and **observation** streams hold the same
facts with a lighter header, applied at once, compacted by their **retention
rules** and hashed per segment. A **proposal** is a pending entry on top of a
known position; approving it appends it. Free text in a fact is **sealed** with
the key of the item it belongs to, kept in the **key vault**, the one store
outside the log; the hash covers the sealed bytes, so destroying a key forgets
the item without breaking the chain.

## Words

- **stream**: one ordered sequence of entries in a workspace, with gapless
  positions from 1. `facts` is one; `pending`, the operational streams and the
  observation streams are the others (section 4).
- **entry**: one appended unit of a stream. In the fact stream an entry is one
  change set.
- **position** (`pos`): an entry's number in its stream. The fact stream's
  position is "the map's position": every snapshot, proposal and as-of read
  names one.
- **fact**: `[op, id, field, value]`. `op` is `+` (assert) or `-` (retract);
  `id` is an item (`e_…`), a link (`r_…`), a type (`local.…`) or another
  record id the stream declares; `field` is a field name; `value` is JSON.
- **sealed value**: a value encrypted with its item's key (section 5).

---

## 1. The change set entry

### Fields

| field | type | what it is |
| --- | --- | --- |
| `v` | integer | Format version of this entry. 1 for everything this spec describes. |
| `ws` | string | The workspace (`default`). In every entry so that a copied log cannot be replayed into another workspace unnoticed. |
| `stream` | string | `facts` here. |
| `pos` | integer | Position in the stream, from 1, gapless. Assigned under the workspace's append lock. |
| `id` | string | The change set id (`c_…`), as undo and the UI name it today. Random, not derived. |
| `at` | string | Server time of the append, UTC, ISO 8601 with milliseconds. Never earlier than the previous entry's `at` (clamped), so time order and position order agree. |
| `actor` | object | Who made the change: `{ "id": "e_…", "token": "t_…" }`. `id` is the actor's item (a person or an agent), never a name, so forgetting a person forgets their name in the log too; `token` is the token in use, when there is one. The system is `{ "id": "system" }`. |
| `authority` | object | On whose authority: `{ "of": "human" \| "agent", "who": "e_…", "basis": sealed, "stated_by": "e_…" }`, as `Authority` in `src/pelago.ts` today. `basis` is free text and sealed. |
| `rule` | object | What decided it (section 3): `{ "outcome": "apply", "spared": [{rule, pack, lifted}] }` for a change applied at once (the rules a setting lifted for it, if any), or, for an approved proposal, `{ "outcome": "approved", "held_by": {rule, pack}, "proposal": "p_…", "proposal_hash": "…", "by": "e_…", "revised": false, "except": [] }`. |
| `reason` | sealed | Why. Required, as today. |
| `source` | string \| null | The source item (`sys.source`) the facts came from. The source item's own facts are in this same entry when it is new. A fact with a different source says so itself. |
| `action` | string \| null | The pack action that made it (`time.log`), as `ChangeInput.action` today. |
| `undoes` | string \| null | The change set this one reverses, for an undo. |
| `facts` | array | The facts, in the order they apply. May be empty only for a decision entry (a rejected or superseded proposal, section 3) or a segment seal (section 4). |
| `keys` | array | The items whose keys this entry's sealed values use, sorted: lets a reader fetch every key it needs in one vault read. |
| `prev` | string | Hex SHA-256 of the previous entry in this stream; 64 zeros for position 1. |
| `hash` | string | Hex SHA-256 of this entry (below). |

Nothing else is in an entry. What today's events carry beside this (the
action name per op, `detail.changes` with before and after, titles copied for
display) is read from projections instead: the before-value of a field is the
newest assertion of it before this position (section 7).

### Serialised form

On the wire, in a backup and in an export, an entry is one line of JSON
(NDJSON). In Postgres it is one row of `log_entry` (the header, with `prev`
and `hash` as `bytea`) and one row of `log_fact` per fact (`pos`, `n`, `op`,
`id`, `field`, `value`, `meta`), both append-only by grants and a trigger
that refuses update and delete except by the compaction role (section 4).
The `log_fact` rows are what row-level security reads (section 5,
visibility).

A fact is a JSON array: `["+", "e_k3", "status", "doing"]`. A fifth element,
an object, carries what is about the fact rather than the value:
`{ "src": "e_s1" }` (its own source) or `{ "conf": 0.6 }` (its confidence,
for a link). A retraction has no value: `["-", "e_k3", "due"]`. A sealed value
is `{ "$k": 1, "$n": "<12-byte nonce, base64url>", "$c": "<ciphertext and
16-byte tag, base64url>" }`: `$k` is the key's version for that item (keys
can be rotated; section 5).

### Canonical form and hash

The hash is SHA-256 over the bytes

```
"pelago-log\n" || JCS(entry without "hash", each sealed value replaced by {"$h": hex SHA-256(nonce || ciphertext)})
```

- **JCS** is the JSON Canonicalization Scheme, RFC 8785: keys sorted by UTF-16
  code units, no whitespace, numbers in ECMAScript form, strings in UTF-8 with
  the minimal escapes. It is a few dozen lines of JavaScript and needs no
  dependency.
- **Every field of the entry is covered**, including `prev`, so each entry
  commits to all of history before it, and `pos`, `ws` and `stream`, so an
  entry cannot be moved.
- **A sealed value is covered by its digest**, not by its plaintext and not by
  its raw bytes. The chain verifies without any key, verifies after a key is
  destroyed, and would still verify if the sealed bytes of a forgotten item
  were one day dropped to reclaim space (an open question, Q4).
- **The prefix `pelago-log\n`** keeps a log hash from ever equalling the hash of
  some other JSON document. The format version is inside the entry, so the
  prefix never changes.
- Verification reads the stored bytes as they were written, at their own
  version; an upcaster (section 6) never runs before hashing.

### Example

A human changes one status; the reason is shown here in clear, as it is to a
reader with the key (stored, it is a sealed value).

```json
{
  "v": 1, "ws": "default", "stream": "facts", "pos": 1043,
  "id": "c_tz33yq68", "at": "2026-10-24T12:14:03.511Z",
  "actor": { "id": "e_jmbe7v52" },
  "authority": { "of": "human", "who": "e_jmbe7v52" },
  "rule": { "outcome": "apply", "spared": [] },
  "reason": "Started on it", "source": null, "action": null, "undoes": null,
  "facts": [["+", "e_j8df78ar", "status", "doing"]],
  "keys": ["e_j8df78ar"],
  "prev": "9f2c…41aa", "hash": "c07e…9b13"
}
```

`keys` names the reason's key too: a change set's own free text (reason,
basis) is sealed with the change set's key, `c_tz33yq68` (section 5), listed
when present.

---

## 2. Facts

### Assert and retract

- **Every field holds one value.** Asserting a field supersedes whatever it
  held: an update is an assertion, with no retraction of the old value written
  beside it (as Datomic does for cardinality-one attributes). A list (a lens's
  `kinds`) is one JSON value.
- **Retracting a field clears it**: `["-", id, field]`, as `props: {x: null}`
  does today.
- **An assertion of the value a field already holds is not written.** An
  update that changes nothing (today's "checked, still true") writes an entry
  with a single `["+", id, "checked", true]` fact (a field every item has,
  never shown), so the moment is in the log and `updated_at` moves.
- **Every value is written whole.** An `append` to a note asserts the whole new
  note. A delta form would make an as-of read replay a chain of patches; the
  cost of whole values is measured by the benchmark (section 8) before anyone
  optimises it.
- **Kernel defaults are not asserted** (confidence 1, no owner, not archived);
  **pack defaults are**, since a pack can change its defaults later and replay
  must not depend on the pack as it is at replay time.

### Fields of an item

An item's id first appears in an assertion of its `type`: that entry is its
creation, and its time is `created_at`. The head fields are fields like any
other, with reserved names a pack may not declare: `type`, `kind`, `title`,
`body`, `visibility`, `private_to`, `status`, `owner`, `confidence`, `source`,
`archived`, `merged_into`, `forgotten`, `checked`. Every other field is the
name its kind or type declares, with no `props.` prefix (a pack field may not
take a reserved name; the registry refuses it).

- `kind` is asserted at creation, read from the type then, so a projection
  never needs the registry to know an item's kind. When a pack moves a type to
  another kind, a system change set asserts the new kind of each item (today's
  `fillKinds`).
- `updated_at` is the time of the newest entry with a fact on the item;
  `archived_at` the time of the entry that asserted `archived`. Neither is a
  fact.
- `is_open` is not a fact: the projection reads it from the type and the
  status.

### Links are facts about a link

A link has its own id, as today (`r_…`), and its ends are one value:

```json
["+", "r_7q", "link", ["depends_on", "e_a", "e_b"]]
```

Its other fields are facts on the same id: `["+", "r_7q", "for", sealed]` (a
link field such as `waits_on`'s `for`), `["+", "r_7q", "confidence", 0.6]`,
`["+", "r_7q", "source", "e_s1"]`. Unlinking is `["-", "r_7q", "link"]`;
`valid_from` and `valid_to` are the times of those two entries. Moving a link's
end (a merge) asserts `link` again with the new end, under the same id, so the
link's history stays one history.

### Types

`define_type` asserts the whole definition on the type's id:
`["+", "local.invoice", "type_def", { …TypeDef… }]`, in clear (a schema is not
content). Type definitions a pack ships are not in the log: packs are code.
The definitions a workspace has used are, so that a type whose pack is gone
stays readable (dormant): when a workspace opens and a pack's definition of a
type it uses differs from the last one logged, a system change set asserts the
new one (today's `types.sync`).

### Today's ops as facts

| op | facts |
| --- | --- |
| `create` | `type`, `kind`, `title`, `status` (the type's first open status when not given), `visibility`, `private_to` (when private and there is a viewer), and each of `body`, `owner`, `confidence`, `source` and the declared fields that is given or has a pack default. A `{ref}` in a title or note is already the new id when the facts are written. |
| `update` | One assertion per field that changes (a retraction for a field set to null). `append` and `replace` assert the whole new `body`. `visibility` also asserts `private_to` when it moves. An update that changes nothing asserts `checked`. |
| `link` | `["+", r, "link", [type, from, to]]`, plus its fields, its `confidence` (when not 1) and its `source`. Nothing is written when the same link is already live, as today. |
| `unlink` | `["-", r, "link"]`. |
| `archive` | `["+", e, "archived", true]`. |
| `restore` | `["-", e, "archived"]`. |
| `merge` | On the kept item, its merged `body` and each declared field it gains from the dropped one. Each live link of the dropped item asserts `link` again with the kept item at that end; a link that would join the item to itself, or repeat one the kept item already has (the older stays), is retracted instead. Each `owner` that named the dropped item asserts the kept one. The dropped item gets `archived` and `merged_into`. |
| `define_type` | `["+", type id, "type_def", def]`. |
| a new source | The source item's own facts (`type: sys.source`, `title`, `uri`, `kind`, `body` from the excerpt), in the same entry, before the facts that name it. |

A merge written this way is undoable, which today's is not: its undo asserts
the old ends of each moved link, the old body and fields, and retracts
`archived` and `merged_into`.

### Example 1: a task created with two links

An agent, in a workspace that lets agents' changes apply, creates a task part of
a project and depending on another task, citing a file. The note and title are
shown in clear; the first fact is shown sealed, as it is stored.

```json
{
  "v": 1, "ws": "default", "stream": "facts", "pos": 2210,
  "id": "c_m3v8w2pd", "at": "2026-10-24T14:02:11.090Z",
  "actor": { "id": "e_agent01", "token": "t_9xk2" },
  "authority": { "of": "agent", "who": "e_agent01", "basis": "The spec in docs/log.md section 4 needs it" },
  "rule": { "outcome": "apply", "spared": [{ "rule": "agent_changes", "pack": "core", "lifted": "agent_changes" }] },
  "reason": "Retention rules need their own parser before compaction can run",
  "source": "e_src77", "action": null, "undoes": null,
  "facts": [
    ["+", "e_src77", "type", "sys.source"],
    ["+", "e_src77", "kind", "system"],
    ["+", "e_src77", "title", { "$k": 1, "$n": "q1Zt0h3Xl2c9aB4r", "$c": "7rV1…Yw" }],
    ["+", "e_src77", "uri", "docs/log.md"],
    ["+", "e_src77", "status", "recorded"],
    ["+", "e_src77", "visibility", "shared"],
    ["+", "e_t5", "type", "work.task"],
    ["+", "e_t5", "kind", "work"],
    ["+", "e_t5", "title", "Parse retention rules"],
    ["+", "e_t5", "body", "A rule's keep clause read into a plan the compactor runs."],
    ["+", "e_t5", "status", "todo"],
    ["+", "e_t5", "visibility", "shared"],
    ["+", "e_t5", "source", "e_src77"],
    ["+", "r_p1", "link", ["part_of", "e_t5", "e_f8psrdth"]],
    ["+", "r_d1", "link", ["depends_on", "e_t5", "e_j8df78ar"]]
  ],
  "keys": ["c_m3v8w2pd", "e_src77", "e_t5"],
  "prev": "c07e…9b13", "hash": "51ad…e002"
}
```

`uri` is a declared field of `sys.source`, so it is sealed too in storage;
shown in clear above for reading. A link takes the key of its `from` item
(Q3), so `r_p1` and `r_d1` need `e_t5`'s key, already listed.

### Example 2: an update, and its undo

A human moves the task to doing and gives it a due date:

```json
{
  "pos": 2231, "id": "c_u4", "at": "2026-10-24T15:40:00.002Z",
  "actor": { "id": "e_jmbe7v52" }, "authority": { "of": "human", "who": "e_jmbe7v52" },
  "rule": { "outcome": "apply", "spared": [] }, "reason": "Picked up", "undoes": null,
  "facts": [
    ["+", "e_t5", "status", "doing"],
    ["+", "e_t5", "due", "2026-10-31"]
  ]
}
```

(Here and below the header fields every entry has, `v`, `ws`, `stream`,
`source`, `action`, `keys`, `prev`, `hash`, are left out.)

Undo reads, for each fact, the field's newest assertion before position 2231
from the history index: `status` was `todo` (asserted at 2210), `due` had no
value. It checks that nothing has asserted either field since 2231 (if
something has, that field is left and reported, as today), and appends:

```json
{
  "pos": 2240, "id": "c_u9", "at": "2026-10-24T15:52:31.774Z",
  "actor": { "id": "e_jmbe7v52" }, "authority": { "of": "human", "who": "e_jmbe7v52" },
  "rule": { "outcome": "apply", "spared": [] }, "reason": "Undo: Picked up", "undoes": "c_u4",
  "facts": [
    ["+", "e_t5", "status", "todo"],
    ["-", "e_t5", "due"]
  ]
}
```

"Already undone" is a lookup of `undoes = 'c_u4'`, indexed. Nothing is
truncated: today a before-value over 200 characters is cut and cannot be
restored; here every value is whole in the log.

### Example 3: a merge

`e_dup` ("Parse the retention rules") is merged into `e_t5`. Before: `e_dup`
has `r_p2` (part_of `e_f8psrdth`, which `e_t5` already has through the older
`r_p1`), and `e_other` depends on it through `r_d7`. `e_dup` has a note and an
`estimate` field `e_t5` lacks.

```json
{
  "pos": 2302, "id": "c_mg1", "at": "2026-10-25T09:00:12.400Z",
  "actor": { "id": "e_jmbe7v52" }, "authority": { "of": "human", "who": "e_jmbe7v52" },
  "rule": { "outcome": "apply", "spared": [] }, "reason": "Same task twice",
  "facts": [
    ["+", "e_t5", "body", "A rule's keep clause read into a plan the compactor runs.\n\nAlso thin observations by hour."],
    ["+", "e_t5", "estimate", 3],
    ["-", "r_p2", "link"],
    ["+", "r_d7", "link", ["depends_on", "e_other", "e_t5"]],
    ["+", "e_dup", "archived", true],
    ["+", "e_dup", "merged_into", "e_t5"]
  ]
}
```

Its undo asserts `e_t5`'s old `body`, retracts `estimate`, asserts `r_p2`'s
link and `r_d7`'s old end again, and retracts `archived` and `merged_into` on
`e_dup`.

---

## 3. Proposals

### A pending change set on a known position

A change a rule holds is not appended to the fact stream. It is appended to
the `pending` stream as a **proposal record**:

```json
{
  "v": 1, "ws": "default", "stream": "pending", "pos": 88,
  "id": "p_4nq", "at": "2026-10-24T16:00:00.000Z",
  "actor": { "id": "e_agent01", "token": "t_9xk2" },
  "authority": { "of": "agent", "who": "e_agent01", "basis": "…" },
  "held_by": { "rule": "settle", "pack": "core", "say": "Settling \"Should observations be thinned?\" is the owner's…" },
  "reason": "The benchmark showed hourly thinning is enough",
  "source": null, "action": null,
  "base": 2240,
  "ops": [{ "op": "update", "id": "e_q2", "status": "decided", "props": { "outcome": "Hourly", "rationale": "…" } }],
  "facts": [["+", "e_q2", "status", "decided"], ["+", "e_q2", "outcome", "Hourly"], ["+", "e_q2", "rationale", "…"]],
  "warnings": [],
  "prev": "…", "hash": "…"
}
```

- `base` is the fact stream's position the proposal was planned against.
- It keeps both `ops` (what was asked, including relative ops: `append`, a
  link only if missing, a merge) and `facts` (what it would have done at
  `base`), so a reviewer sees the exact difference and the approval can tell
  whether anything moved.
- `held_by` names the rule, as `Proposal.held_by` does today.
- The record is never changed. Its fate is a later entry in the fact stream
  that names it, so the queue of what is pending is a projection: records with
  no deciding entry.
- The pending stream is hash-chained like the fact stream and kept forever:
  what agents asked for and what people refused is part of who decided what.

### Approval appends it

A person approves `p_4nq` at head position `H`. The kernel:

1. **Fast path.** If no entry after `base` asserts or retracts any `(id,
   field)` the proposal's facts touch, and no item or link it names was
   archived, merged or forgotten since, the facts are appended unchanged.
2. **Rebase.** Otherwise the ops are planned again against `H` (validation
   and the rules run again, as `apply` does today), giving new facts. For each
   field both the proposal and a later entry set: if the later value equals
   the proposal's, the fact is dropped (already so); if the op is relative
   (`append`, `replace` whose passage is still there once, a link only if
   missing) it is applied to the new value; otherwise the proposal is
   **overtaken** and refused, showing the three values (at `base`, now,
   proposed). The reviewer can then send corrected ops, which are planned at
   `H` and approved as revised.
3. The appended change set's `rule` is `{ "outcome": "approved", "held_by":
   …, "proposal": "p_4nq", "proposal_hash": "<the record's hash>", "by":
   "e_jmbe7v52", "revised": false, "except": [] }`. Its `actor` and `reason`
   are the proposer's; its `authority` is the approving human's, as today
   ("held and then applied by a human: it rests on that human"). The
   proposer's own authority stays in the proposal record.

### Rejection and superseding

- **Rejected**: an entry in the fact stream with no facts, `rule: { "outcome":
  "rejected", "proposal": "p_4nq", "proposal_hash": "…", "by": "e_…" }`, the
  reviewer's note as its `reason`. Chained forever.
- **Superseded** (everything it asks is already so, today's `supersede`): the
  same with `outcome: "superseded"`, actor `system`, and `by: "c_…"`, the
  change set that made it moot.
- **Overtaken** is not an outcome: the proposal stays pending until someone
  revises, rejects or it is superseded.

### What a held change names

The change tool answers `held_by` from the verdict, the proposal record keeps
it, and the deciding entry repeats `held_by` under `rule`, so a reader of the
fact stream alone knows which rule a change went through.

---

## 4. Streams and retention

### The two kinds of stream

| | fact stream (`facts`, and `pending`) | compacted streams |
| --- | --- | --- |
| holds | work, decisions, links, types, publications, acts made outside, proposals and their fates | operational state and observations |
| header | full (section 1) | `v`, `ws`, `stream`, `pos`, `at`, `actor`, `rule` (the retention rule's id), `facts`; `reason` optional |
| decided by | the approval rules (`decide`) | applied at once, never held, never undone |
| hash | each entry chains to the one before | per segment |
| kept | forever | by the stream's retention rule |

The facts are the same shape in every stream. A projection that reads both
(the current state of a run item, say) reads facts in order from each stream
and never cares which stream a fact came from beyond its retention.

### Segments and their hashes

A compacted stream is cut into **segments**, one per day per stream (the time
partitions of `e_m6a2uw2f`). When a day closes, its segment is sealed: its
hash is SHA-256 of `"pelago-segment\n"` and the canonical entries in order,
and a system entry in the fact stream records it:

```json
{ "rule": { "outcome": "apply", "spared": [] }, "actor": { "id": "system" }, "reason": "Day sealed",
  "facts": [["+", "seg_sessions_20261024", "segment", { "stream": "sessions", "from": 5101, "to": 9877, "hash": "ab03…" }]] }
```

So the chain commits to every operational day. **Compaction** later drops
entries a retention rule no longer keeps: it writes a compacted segment in
place of one or more sealed ones and records it the same way, naming the
segments it replaces and the rule it followed. An operational entry is never
rewritten; it is dropped whole, by rule, and the drop is in the chain.

### The retention rule format

A retention rule is a rule in a pack file (`rules`), judged like the others,
with a `stream` and a `keep` in place of `then`:

```json
{
  "id": "sessions",
  "when": { "type": "sys.run" },
  "stream": "sessions",
  "keep": { "latest": true, "history": "P14D", "closed": "P180D" },
  "say": "A run's state now, two weeks of how it got there, and the run itself for half a year after it ends."
}
```

- `when` selects facts by what they are written to, with today's
  conditions (type, kind, op, fields), and `fields` matters here: a run's
  `story` and `tokens_used` can go to one stream while the run's `title`
  stays a fact.
- `stream` names the stream; a rule with no `stream` leaves its facts in the
  fact stream.
- `keep` says what compaction leaves:
  - `latest: true`: the newest value of each (id, field) is kept while the
    record lives.
  - `history: <ISO 8601 duration>`: older values are kept this long.
  - `thin: [[after, every], …]`: of older values keep one per `every` once
    they are older than `after` (`[["P1D", "PT1H"], ["P30D", "P1D"]]`).
  - `closed: <duration>`: how long a record is kept at all after it ends
    (a run ended, a notification read, a token revoked, a claim released);
    then every fact of it is dropped.
  - `forever: true`: never compacted.
- A workspace setting may lengthen a `keep` its pack declares liftable; it
  never shortens one below what a pack declares as needed (the spent view's
  30 days, say).

### The streams and their rules

The durations below are proposals; the owner sets them (Q1).

| stream | what | `keep` proposed |
| --- | --- | --- |
| `sessions` | a run (sys.run): start, end, the task it is on, story, tokens_used, cost, stale_flagged | `latest`, `history: P14D`, `closed: P180D` |
| `claims` | `holds` links: claim and release | `latest`, `history: P30D`, `closed: P90D` |
| `notifications` | notification items and who may read them; outbox deliveries | `latest`, `closed: P30D` after read, `P90D` unread |
| `automations` | an automation's last_run, last_fired, last_result; the event cursor; `run_once` marks; `rechecked_at` | `latest`, `history: P7D` |
| `settings` | the workspace's settings, `me`, packs turned off, each person's `changes.seen` and `questions.confirmed` | `latest`, `history: P365D` |
| `access` | tokens (as their hash, hint, kind, name, item, expiry, revocation, last use at most hourly), members, shares, backup downloads | `latest`, `history: P365D`, `closed: P365D` |
| `pack:<id>` | a server pack's own keys and values (today's `pack_store`) | `latest`; the pack may declare more |
| `observations` | readings from monitors and reports, connection reachability, imported external tool calls (`audit.import`), a test's picture | `latest`, `thin: [["P1D", "PT1H"], ["P30D", "P1D"]]`; pictures `latest` only |

### What is never stored

In memory only, gone on restart, never in a backup: presence, a run's
heartbeat (`last_seen`, `active`, `busy`), the pulse pages listen to, live
cursors, the throttle state of `src/limit.ts`. Today's `transient` table
(short-lived keys with an expiry) belongs here too, which needs an answer for
several servers sharing a Postgres (Q7).

---

## 5. Per-item keys

### What is sealed and what stays clear

Each item has its own 256-bit key (AES-256-GCM, 12-byte random nonce, 16-byte
tag). The additional authenticated data is `ws \0 id \0 field`, so a sealed
value cannot be moved to another item or field.

**Sealed**: every value that is content.

- An item's `title`, `body` and every declared field's value (dates and
  numbers too: a salary is content).
- A link's own fields (`for`), with the key of its `from` item (Q3).
- A change set's `reason` and `authority.basis`, with the change set's own
  key, named by its id (Q2).

**Clear**: what is structure, needed to route, order, verify and enforce
visibility without a key.

- Every id, every field name, `op`.
- `type`, `kind`, `status`, `visibility`, `private_to`, `owner`,
  `confidence`, `source`, `archived`, `merged_into`, `forgotten`, `checked`:
  ids, enums a type declares, flags and numbers that are not anyone's words.
- A link's `link` value (its type and ends).
- `type_def` (a schema).
- The whole header except `reason` and `authority.basis`.

A pack field may be declared `"clear": true` when a projection must read it
without a key during a rebuild (an observation's reading); the registry
refuses `clear` on `title` and `body`.

### Visibility over the log

The log's rows are immutable, so they cannot carry who may see them as a
column that changes. Row-level security on `log_fact` joins the current-state
projection: a fact is visible when its item (for a link, both ends) is
visible to the viewer now, as an event about an item is today. `log_entry`
headers are visible when at least one of their facts is. Verifying the chain
needs every row and is the server's and the owner's operation, not a
member's.

### Forgetting, and why the chain survives it

A **forget** is a change set in the fact stream (`["+", e, "forgotten",
true]`, its reason and authority, decided by a core rule that it is the
owner's). In the same transaction:

- the item's key is deleted from the vault, with the keys of the links it is
  the `from` of riding on it;
- its rows leave every projection and the search index.

Its sealed values stay in the log, unreadable. The chain still verifies,
because the hash covers each sealed value by the digest of its nonce and
ciphertext, never by its plaintext; snapshots and backups hold the same
ciphertext and become unreadable for it at the same moment. What stays
readable about a forgotten item is its id, its type and the clear structure
above: that something of type `work.task` existed and was linked, not what it
said.

### The key vault

- A table outside the log, `vault_key (ws, id, version, wrapped, created_at)`,
  one row per item, link-free (links use their `from` item's key) and one per
  change set with free text. Keys are created with the item, in the append
  transaction.
- Each key is wrapped (AES-256-GCM) with the **vault key**, which is never in
  the database: `PELAGO_SECRETS_KEY`, or the key file beside the workspaces, as
  `src/secrets.ts` seals secrets today.
- Rotation of one item's key writes a new version; values sealed with the old
  version keep their `$k` and stay readable until the item is forgotten,
  which deletes every version.
- Deleting a row deletes it for real: on Postgres the row is gone from the
  table at once and from disk at the next vacuum. The vault is backed up apart
  from the log, its backups kept for a bounded time; a forgotten item is
  unrecoverable once the last vault backup that holds its key has expired, so
  that bound is the time to forget (Q6).
- Reading: a server keeps unwrapped keys in an in-memory cache, by entry
  `keys`, so a page read decrypts nothing (projections are plaintext) and a
  replay unwraps each key once.

---

## 6. Versioning

- `v` is the version of the entry's format: the header's fields, the fact's
  shape, the canonical form. It is 1 for this spec.
- **An entry is never rewritten.** Not to upgrade it, not to fix it, not to
  rename a type in it. The bytes appended are the bytes hashed and kept.
- **An upcaster** is a pure function from an entry of version `n` to the same
  entry at `n + 1`, with no database and no registry. Reading an entry applies
  the chain of upcasters from its version to the current one; projections and
  tools only ever see current-version entries. Verification does not upcast.
- An upcaster changes form only: a field renamed in the header, a fact moved
  from object to array, a default made explicit. A change of meaning (a type
  renamed by its pack, a field moved to another type) is never an upcaster: it
  is a system change set of facts, like today's `retype`, so the map's history
  says when the meaning changed.
- Each upcaster ships with a test: a stored entry at version `n` in, the
  expected entry out (in `test/`, run with no database).
- A server that reads an entry of a version newer than it knows refuses to
  open the workspace rather than guess.

---

## 7. Projections and snapshots

### What each projection reads

| projection | reads from a fact |
| --- | --- |
| current state (`entity`, `relation` as tables) | every fact: the newest value of each (id, field), plaintext; `created_at`, `updated_at`, `archived_at`, `valid_from`, `valid_to` from entry times |
| history index | nothing beyond the log itself: `log_fact` indexed on `(id, field, pos)` and on `(id, pos)` is the index by item and by field; an as-of value is one index lookup |
| change sets by id, undo | `log_entry.id`, `undoes`, indexed |
| search index | `title`, `body`, and fields declared searchable, after unsealing, as the append happens; a forget deletes its rows |
| part_of closure | `link` facts whose type is in the `part_of` family: add or drop ancestor pairs |
| blocking roots, counts (blocked, waiting, attention) | `link` facts of the blocking and `waits_on` families, `status` (open or closed, through the type), `archived`, `forgotten` |
| proposal queue | `pending` records with no deciding entry in the fact stream |
| type registry (dormant types) | `type_def` facts |
| sessions, claims, notifications, settings, access | their streams' facts, newest per (id, field) |
| changed since | `log_entry` by `at` (a slice of the log, not a projection) |

Each projection declares the fields and streams it reads, and its version.
Projections are written in the append's transaction (commitment 2): a page
never sees the log ahead of them.

### What a snapshot records

```json
{
  "v": 1, "ws": "default",
  "projection": "current_state", "projection_version": 3,
  "positions": { "facts": 2302, "pending": 88, "sessions": 9877, "observations": 40211 },
  "fact_hash": "<hash of fact entry 2302>",
  "taken_at": "2026-10-25T03:00:00.000Z",
  "rows": "<the projection's rows, sealed per item with each item's key>",
  "hash": "<SHA-256 of the snapshot's canonical form, rows by digest>"
}
```

- Positions in every stream it read, and the hash of the fact entry at its
  fact position, which anchors it to the chain.
- `projection_version`: a change to a projection's code raises it, and every
  snapshot of an older version is ignored for rebuilds (replay from the
  start, in the background).
- Rows are sealed per item exactly as facts are, so a forget reaches
  snapshots and backups through the vault.
- A snapshot is taken every 100,000 fact entries or daily, whichever comes
  first; it is not part of the log and can be deleted and taken again.

---

## 8. Size and speed at scale

### Bytes per typical change set

Estimates for the benchmark to confirm, in Postgres, with indexes:

| part | bytes |
| --- | --- |
| `log_entry` header row: ids, actor, authority, rule, two 32-byte hashes, reason of ~120 characters sealed (+28 bytes nonce and tag), tuple overhead | ~420 |
| one `log_fact` row with a short clear value (a status) | ~80 |
| one `log_fact` row with a sealed title of ~50 characters | ~130 |
| index entries per fact: primary key `(pos, n)`, `(id, field, pos)`, `(id, pos)` | ~90 |
| index entries per header: primary key, `id`, `at` (BRIN, nearly free) | ~60 |

A one-field update: ~650 bytes. Example 1 (a task with a note of ~60
characters, two links, a new source; 15 facts): ~3.5 KB. A typical change set
is 4 to 8 facts: **1.2 to 2 KB**. A JSON line in a backup is about half that.

### Rows per day for a team of ten with agents

From the live map (one person and agents, about 17,500 rows in three weeks)
scaled to ten people, each running a few agent sessions a day:

| stream | appended per day | kept after compaction |
| --- | --- | --- |
| facts: ~1,200 change sets of ~5 facts | ~1,200 headers + ~6,000 facts | all, forever (~2.6 million fact rows a year) |
| pending: proposals and their fates | ~100 | all |
| sessions: ~100 runs, ~50 entries each (story beats, token counts) | ~5,000 | latest per run for 180 days; two weeks of history |
| notifications | ~300 | ~30 to 90 days |
| claims, automations, settings, access | ~500 | mostly latest |
| observations | ~2,000 | thinned to ~50 per item and field a month |

About 15,000 rows appended a day, about 8,000 kept: some 9 million kept rows
over three years, in line with the design's estimate. The fact stream is
roughly 2 GB with indexes after three years; the compacted streams stay under
a few hundred MB.

### What the 10-million-event benchmark must measure

For `e_qghey689`, on a generated workspace with 10 million entries across the
streams in the mix above (and the hosted Postgres as well as PGlite):

1. **Append latency**, p50 and p99, for a 1-, 5- and 15-fact change set,
   broken down into planning, rules, canonical JSON and SHA-256, sealing
   (per value, including the vault key cache missing), the `log_entry` and
   `log_fact` inserts and each projection's update; and the throughput of
   concurrent appenders contending for the append lock.
2. **Storage**: bytes per header, per fact (clear and sealed), per index, for
   the whole fact stream and each compacted stream, before and after
   compaction; and the cost of whole values for a note appended to 200 times.
3. **Chain verification** from position 1 and from a snapshot: entries per
   second, with and without unsealing.
4. **Replay**: facts per second into each projection from position 1 (with
   keys, so unsealing included) and from the newest snapshot; snapshot size
   and the time to write and to load one.
5. **As-of reads**: one item's field at a random past position (one history
   index lookup); one item whole at a past time; a lens over a subtree as of a
   time a month back (snapshot plus replay).
6. **Undo and approval at head**: the fast-path check and a rebase for a
   proposal whose base is 10,000 entries behind.
7. **Compaction**: time to compact one day of `sessions` and `observations`,
   and rows dropped; time to seal a segment.
8. **Forget**: time to delete a key and an item's projection and search rows
   for an item with 1,000 facts and 100 links.
9. **Row-level security** on `log_fact` (its join to the current state) for
   a member reading an item's history and for `changed_since` over a day.
10. **Vault**: size with 1 million keys, unwrap cost per key, cache hit rate
    during replay.

---

## 9. Every write today, and where it goes

Every write in `src/pelago.ts` and every store `src/operational.ts` names,
with the entry or stream it becomes. Nothing else writes the map today
(`test/structure.test.ts` checks it).

### Writes in `src/pelago.ts`

| write today | becomes |
| --- | --- |
| `change` holds: `insert into proposal`, `log proposal.create` | a proposal record in `pending` (section 3) |
| `decideNow` approves: `apply`, `update proposal set ops` (revised), `update proposal set status`, `log proposal.approve` | one fact entry: the change set, with `rule.outcome: approved`, `revised`, `except`; the revised ops are the facts appended, the original stays in the record |
| `decideNow` rejects: `update proposal set status`, `log proposal.reject` | a fact entry with no facts, `rule.outcome: rejected` |
| `apply` create: `insert into entity`, `log entity.create` | create facts in the change set |
| `apply` update: `update entity`, `log entity.update` | assertions and retractions; `detail.changes` is gone (the history index has before-values) |
| `apply` link: `insert into relation`, `log relation.link` | `link` fact on a new `r_` id |
| `apply` unlink: `update relation set valid_to`, `log relation.unlink` | `["-", r, "link"]` |
| `apply` archive and restore: `update entity set archived_at`, logs | `archived` asserted or retracted |
| `apply` merge: four `update relation`, two `update entity`, `log entity.merge` | the merge facts (section 2), now undoable |
| `apply` define_type: `registry.defineLocal`, `log type.define` | `type_def` fact; the registry and `local_type` are projections of it |
| `ensureSource`: `insert into entity` (sys.source), `log entity.create` | the source item's facts in the same change set |
| `supersede`: `update proposal set status = 'superseded'`, `log proposal.supersede` | a fact entry with no facts, `rule.outcome: superseded`, actor `system` |
| `fillKinds`: `update entity set kind` | a system change set asserting `kind` (only when a pack moved a type's kind) |
| `retype`: `update entity|relation set type`, lens and screen settings rewritten, `log type.moved` | a system change set asserting the new `type` (or `link`) and the renamed settings for each item touched (Q13) |
| `log` (the generic insert into `event`) | gone: the entry is the event; each caller is mapped below |
| `operational`: `last_seen`, `active`, `busy` | never stored (memory) |
| `operational`: `tokens_used`, `story`, `stale_flagged` | `sessions` stream |
| `operational`: `last_run`, `last_fired`, `last_result` | `automations` stream |
| `operational`: `rechecked_at` | `automations` stream |
| `operational`: `reach` (who may read a notification) | `notifications` stream |
| `claim`: `insert into relation` (holds), `log resource.claim` | `claims` stream: a `link` fact |
| `release`: `update relation set valid_to`, `log resource.release` | `claims` stream: `["-", r, "link"]` |
| `checkConnections`: `update entity set status` (outside `change` today), `log connection.check` | `observations` stream: the connection's reachability as an observed `status` (the connection item itself stays facts) |
| `setSecret`: `insert into setting`, `delete from setting` | `settings` stream, sealed, `latest` only with no history (Q5) |
| `init`: owner person created through `apply`; `insert into setting` (`agent_changes`, `me`) | facts for the person; `settings` stream |
| `restoreRows` (restore from a backup) | gone: restoring is verifying a copied log and replaying it; merging two diverged copies is Q10 |

### Stores named in `src/operational.ts`

| store | becomes |
| --- | --- |
| `MAP_TABLES`: `entity`, `relation`, `event` | the log (`log_entry`, `log_fact`); `entity` and `relation` become projections; `event` goes |
| `ON_THE_MAP.sessions` | `sessions` stream (heartbeat in memory); the run's start and end too (Q9) |
| `ON_THE_MAP.claims` | `claims` stream |
| `ON_THE_MAP.notifications` | `notifications` stream; `src/notify.ts`'s `apply` and `src/outbox.ts`'s delivery write there |
| `ON_THE_MAP.automations` | `automations` stream; `automation.fire` and `run.stale` are entries there |
| `ON_THE_MAP.rechecks` | `automations` stream; `recheck.done` an entry there |
| `ON_THE_MAP.kinds` | the `kind` fact at creation |
| `token` | `access` stream: hash and metadata; `last_used` at most hourly |
| `share` | `access` stream (Q12) |
| `setting` | `settings` stream; sealed secrets there or in the vault (Q5) |
| `member` | `access` stream (Q12) |
| `proposal` | `pending` stream plus deciding entries (section 3) |
| `published` | a fact entry on a publication id (`pub_…`): the frozen text sealed with the document's key, so forgetting the document unpublishes it everywhere; unpublishing retracts it |
| `picture` | `observations` stream, `latest` only (Q8 for large bytes) |
| `act` | a request that waits is a `pending` record like a proposal; `act.done` and `act.refused` are fact entries with no map facts and an `act` header, kept forever (a payment made outside cannot be taken back, and the chain should say so) |
| `type_def` | a projection: packs (code) and `type_def` facts |
| `local_type` | a projection of `type_def` facts across workspaces |
| `transient` | never stored (Q7) |
| `pack_store` | `pack:<id>` stream |
| `control_workspace`, `control_value`, `github_installation` | the server's own log, in this format, outside any workspace (Q11) |
| `schema_version` | gone: entries carry `v`, snapshots `projection_version` |

### Events written outside `src/pelago.ts`

| action | becomes |
| --- | --- |
| `changeset.undo` (`src/undo.ts`) | the undo change set itself, with `undoes` |
| `audit.import` (`src/audit.ts`) and its cursor setting | `observations` stream; cursor in `automations` |
| `workspace.import`, backup restores (`src/backup.ts`: `insert into event`, `proposal`, `setting`, `update token`) | replaying a log; imported entries keep their own positions and hashes in their own chain (Q10) |
| `workspace.backup_download` | `access` stream |
| `share.create`, `share.revoke`, `share.workspace` | `access` stream |
| `workspace.set` (`src/model-tools.ts`, `src/workspace-tools.ts`), `PACKS_OFF` (`src/packstate.ts`), `me` (`src/tools.ts`) | `settings` stream |
| `changes.seen`, `questions.confirmed` | `settings` stream, per person |
| `run_once` marks (`src/agent-run.ts`) and the automation cursor (`src/automations.ts`, now a fact position) | `automations` stream |
| pack secrets (`src/outside.ts`) | `settings` stream sealed, or the vault (Q5) |
| `act.done`, `act.refused` | fact entries, as above |
| `picture.stored`, `picture.removed` | `observations` stream |
| `document.publish`, `document.unpublish` | fact entries (`published` above) |
| `types.sync` (`src/typetable.ts`) | a system change set of `type_def` facts, only when a definition changed |
| `connection.made`, `connection.ended` | facts on the connection item (it is a thing on the map); its reachability in `observations` |
| `workspace.notify` (`src/outbox.ts`) | `notifications` stream |
| `server.workspace.add`, `server.workspace.deliver` | the server's own log (Q11) |
| migrations (`src/schema.ts`: `update event`, `update token`) | gone: a format change is an upcaster |

---

## 10. Questions for the owner

The design document left these open; this spec proposes an answer for each
where it must have one to be complete, and does not settle them.

1. **Retention durations.** The `keep` of each compacted stream (section 4):
   are the proposed numbers right?
2. **A change set's own free text.** The spec seals `reason` and
   `authority.basis` with a key per change set. Should forgetting an item also
   offer to forget the reasons that mention it (found by search)?
3. **Links and forgetting.** A link's fields use its `from` item's key. When
   an item is forgotten, should links into it lose their fields too (a
   `waits_on` whose `for` says something about the person forgotten)?
4. **The bytes of a forgotten item.** Keep its ciphertext in the log
   (proposed), or drop it to reclaim space, which the chain allows because it
   hashes sealed values by digest?
5. **Secrets** (model accounts, webhook and host secrets): sealed in the
   `settings` stream, latest only (proposed), or kept in the key vault beside
   item keys?
6. **The key vault's home and its backups.** A table in the same database, so
   a forget is one transaction (proposed), or a database of its own; and how
   long vault backups are kept, which bounds how long a forgotten item can
   still be recovered.
7. **Transient values** (login codes, OAuth state) are never stored by the
   design; on several servers sharing one Postgres they need a shared place.
   A second store outside the log, never backed up, or something else?
8. **Large binaries** (a test's picture, images): bytes in the
   `observations` stream (proposed), or a content-addressed store beside the
   log?
9. **Runs.** A session's run, its start, end and the task it is on, wholly in
   the `sessions` stream (compacted, not undoable; proposed), or its start and
   end kept forever as facts, as they are logged changes today?
10. **Two diverged copies.** Merging a backup or a second server's copy that
    shares a prefix of the log: the other side's later entries become
    proposals on this side (rebased by section 3), or something else?
11. **The server's own state** (the workspaces it holds, GitHub
    installations): a server log in this format (proposed), or tables as now?
12. **Who was given access** (tokens, members, shares): the compacted
    `access` stream (proposed), or facts kept forever, since granting access is
    an act of authority?
13. **A type a pack moves** (`retype`): a system change set asserting the new
    type on every item (proposed, possibly thousands of facts), or an alias in
    the type registry with no facts written?
