# The log's event format

Archipelago's stored state is one append-only log per workspace; everything read
is a projection of it (the owner's decision of 24 Oct 2026, `e_d2p6ejz3`; the
design is `e_76ds7tkm`). This is the spec of what an entry in that log is: its
fields, how it is hashed, how facts say what changed, how proposals, retention,
per-item keys, versions, snapshots and packs meet it. It is written before any
code. The questions it raised were answered by the owner on 24 Oct 2026; the
answers are stated below as settled, and listed at the end with their
decisions on the task (`e_j8df78ar`).

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
the key of the item it belongs to, kept in the **key vault**; the hash covers
each sealed value by its digest, so destroying a key and dropping the sealed
bytes forgets the item without breaking the chain. Large binaries are
**blobs**, sealed the same way and kept by their hash beside the log's rows.
Adding or removing a **pack** is a fact, and everything a pack registers is a
projection of the packs active at a position. Two stores sit outside the log:
the key vault and the **transient** table of short-lived values.

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
- **blob**: a large binary (a test's picture, an image) kept once by the
  SHA-256 of its sealed bytes, beside the log's rows; a fact holds only its
  hash (section 4).

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
| `pack` | object \| null | The pack whose code made it, when a pack's action or handler did: `{ "id": "time", "manifest": "<hash>", "action": "log" }` or `{ …, "handler": "on_push" }` (section 8). Replaces today's `ChangeInput.action` string. |
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
that refuses update and delete except by the compaction role (section 4)
and the forget role (section 5).
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
  its raw bytes. The chain verifies without any key, and still verifies after
  a forgotten item's sealed bytes are dropped, which a forget does (section 5;
  the owner, `e_k2aex62z`).
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
  "reason": "Started on it", "source": null, "pack": null, "undoes": null,
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
  cost of whole values is measured by the benchmark (section 9) before anyone
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
content). Type definitions a pack ships are not facts of their own: they are
read from the pack's manifest, which the pack's fact names by hash and the
log keeps as a blob (section 8). So a type whose pack is gone stays readable
(dormant) at any position, and today's `types.sync` becomes the pack's fact
asserted again when its manifest changes.

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
  "source": "e_src77", "pack": null, "undoes": null,
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
shown in clear above for reading. `r_p1` and `r_d1` have no fields of their
own, so they need no key; a link that has fields has a key of its own
(section 5).

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
`source`, `pack`, `keys`, `prev`, `hash`, are left out.)

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
  "source": null, "pack": null,
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
| holds | work, decisions, links, types, packs added and removed, a run's start and end, access granted and revoked, publications, acts made outside, proposals and their fates | operational state and observations |
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
  "when": { "type": "sys.run", "fields": ["story", "tokens_used", "cost_usd", "stale_flagged"] },
  "stream": "sessions",
  "keep": { "latest": true, "history": "P14D", "closed": "P180D" },
  "say": "A run's story and spend now, two weeks of how they got there, kept half a year after the run ends."
}
```

- `when` selects facts by what they are written to, with today's
  conditions (type, kind, op, fields), and `fields` matters here: a run's
  `story` and `tokens_used` go to the `sessions` stream while its start,
  end and the task it is on stay facts.
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

The owner settled these keeps (`e_uhpg9bug`). What is an act of authority is
kept forever as facts instead: a run's start, end and the task it is on
(`e_fst4wzsv`), and access granted and revoked (`e_x9wxnqz4`).

| stream | what | `keep` |
| --- | --- | --- |
| `sessions` | a run's story, tokens_used, cost, stale_flagged (its start, end and task are facts) | `latest`, `history: P14D`, `closed: P180D` |
| `claims` | `holds` links: claim and release | `latest`, `history: P30D`, `closed: P90D` |
| `notifications` | notification items and who may read them; outbox deliveries | `latest`, `closed: P30D` after read, `P90D` unread |
| `automations` | an automation's last_run, last_fired, last_result; the event cursor; `run_once` marks; `rechecked_at` | `latest`, `history: P7D` |
| `settings` | the workspace's settings, `me`, each person's `changes.seen` and `questions.confirmed` (not packs: adding and removing one is a fact, section 8; not secrets: they are in the vault) | `latest`, `history: P365D` |
| `access` | a token's last use (at most hourly), backup downloads (the grants themselves are facts) | `latest`, `history: P365D` |
| `pack:<id>` | a pack's own keys and values (today's `pack_store`), read only while the pack is active | `latest`; the pack may declare more |
| `observations` | readings from monitors and reports, connection reachability, imported external tool calls (`audit.import`), a test's picture (as a blob's hash) | `latest`, `thin: [["P1D", "PT1H"], ["P30D", "P1D"]]`; pictures `latest` only |

### Blobs

A large binary (a test's picture, an image) is not written into a fact
(`e_7kharzf2`). It is sealed with its item's key, stored once in a
content-addressed table beside the log's rows (`log_blob (ws, hash, bytes)`,
`hash` the SHA-256 of the sealed bytes), and the fact holds only
`{ "$blob": "<hash>", "size": n, "type": "image/png" }`. The chain covers the
hash, so a blob cannot change unseen. A blob no fact still kept names (its
observation compacted away) is deleted with the compaction that drops the
last one; a forget deletes the blobs of the item forgotten. Pack manifests
(section 8) are blobs too, in clear, kept forever.

### What is never stored

In memory only, gone on restart, never in a backup: presence, a run's
heartbeat (`last_seen`, `active`, `busy`), the pulse pages listen to, live
cursors, the throttle state of `src/limit.ts`.

### The transient table

Short-lived values that several servers on one Postgres must share (login
codes, OAuth state) go in an **unlogged** Postgres table, `transient (key,
value, expires_at)`, its entries expiring and swept, never backed up and
never part of the log (`e_a7fjzcwv`). It is the one store outside the log
besides the key vault, named so in `src/operational.ts`.

---

## 5. Per-item keys

### What is sealed and what stays clear

Each item has its own 256-bit key (AES-256-GCM, 12-byte random nonce, 16-byte
tag). The additional authenticated data is `ws \0 id \0 field`, so a sealed
value cannot be moved to another item or field.

**Sealed**: every value that is content.

- An item's `title`, `body` and every declared field's value (dates and
  numbers too: a salary is content).
- A link's own fields (`for`), with the link's own key, destroyed when
  either end is forgotten (`e_grqeftj2`): a link's words describe the tie to
  both items.
- A change set's `reason` and `authority.basis`, with the change set's own
  key, named by its id, so that a forget can reach them (`e_4uzgmsry`).
- A blob, with its item's key.

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

- the item's key is deleted from the vault, with the key of every link with
  fields that has it at either end;
- every sealed value of the item and of those links is replaced in
  `log_fact` by its digest form, `{ "$h": "<hex SHA-256(nonce || ciphertext)>" }`,
  and its blobs are deleted (`e_k2aex62z`);
- its rows leave every projection and the search index.

The chain still verifies, because the hash already covered each sealed value
by that same digest, never by its plaintext or its bytes. Replacing a sealed
value by its digest is the one change ever made to a stored fact, made only
by a forget, under the forget role. Snapshots and backups older than the
forget still hold the ciphertext, unreadable once the key is gone. What stays
of a forgotten item is its id, its type and the clear structure above: that
something of type `work.task` existed and was linked, not what it said.

**The reasons that mention it.** Free text in change set headers can name
what is forgotten. A forget finds, through the search index, the change sets
whose `reason` or `authority.basis` mentions the item, and offers them to the
person forgetting; they choose which to forget with it (`e_4uzgmsry`). For
each chosen one, the change set's key is deleted and its sealed reason and
basis are replaced by their digests, in the same transaction. Nothing is
forgotten with an item without the person choosing it.

### The key vault

- A table in the workspace's own database, outside the log, so a forget is
  one transaction (`e_98cdhgn6`): `vault_key (ws, id, version, wrapped,
  created_at)`, one row per item, per link with fields, and per change set
  with free text. Keys are created with what they seal, in the append
  transaction.
- **Secrets** live here too (`e_7cv7xefh`): a workspace's model account, a
  pack's webhook and host secrets, as `vault_secret (ws, name, version,
  wrapped)`. A secret must be truly deletable and never sit in the log's
  backups, as a key must not. Setting or removing one is recorded in the
  `settings` stream by name only, never its value.
- Each key is wrapped (AES-256-GCM) with the **vault key**, which is never in
  the database: `PELAGO_SECRETS_KEY`, or the key file beside the workspaces, as
  `src/secrets.ts` seals secrets today.
- Rotation of one item's key writes a new version; values sealed with the old
  version keep their `$k` and stay readable until the item is forgotten,
  which deletes every version.
- Deleting a row deletes it for real: on Postgres the row is gone from the
  table at once and from disk at the next vacuum. The vault is backed up apart
  from the log, and its backups are kept **30 days** (`e_98cdhgn6`), matching
  the promise that a workspace's data is deleted 30 days after its
  subscription ends: a forgotten item is unrecoverable 30 days after the
  forget at most.
- Reading: a server keeps unwrapped keys in an in-memory cache, by entry
  `keys`, so a page read decrypts nothing (projections are plaintext) and a
  replay unwraps each key once.

---

## 6. Versioning

- `v` is the version of the entry's format: the header's fields, the fact's
  shape, the canonical form. It is 1 for this spec.
- **An entry is never rewritten.** Not to upgrade it, not to fix it, not to
  rename a type in it. The bytes appended are the bytes hashed and kept. The
  one exception is a forget replacing a sealed value by the digest the hash
  already covered (section 5), which changes no hash.
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
| the registry: types, links, rules, views, actions, handlers, screens, routes, drawings, styles | the active pack set (`pack` facts) and each pack's manifest blob, plus `type_def` facts (section 8); dormant types from the last manifest of a pack no longer active |
| sessions, claims, notifications, settings, access | their streams' facts, newest per (id, field) |
| changed since | `log_entry` by `at` (a slice of the log, not a projection) |

Each projection declares the fields and streams it reads, and its version.
Projections are written in the append's transaction (commitment 2): a page
never sees the log ahead of them.

### As built

- **The projector** is `src/replay.ts`. The write path plans each op into
  facts and projects them at once, under the fact stream's lock, so the next
  op reads what it did; the entry is appended at the end of the same
  transaction. `rebuild` projects a log into empty tables the same way, and
  `test/projections.test.ts` compares the two row for row.
- **An item's kind is not a fact.** It is read from its type, as `is_open`
  is from its status, so a field a pack calls `kind` is the pack's own. A
  link is known by its id (`r_…`), so an item may have a field called `link`.
- **The activity log** reads change sets from the log (`src/eventlog.ts`):
  one event per item or link an entry touched, the before-values and the
  title then from the history index. Facts are numbered from the event
  table's sequence (`log_fact.seq`, not hashed), so one cursor runs over
  both. `event` keeps only what is not yet a fact. A backup carries the
  change sets as the events they read as, until it carries the log itself.
- **The review queue** (`proposal`) is projected: a pending record makes its
  row, the entry that decides it says what became of it.
- **The search index** is the indexes on `entity` (`src/search.ts`), kept
  current by the projector's writes. The part_of closure, blocking roots and
  the counts are not kept: measured on 20,000 items, the block graph of the
  whole map takes 36 ms, the open and blocked counts 48 ms and a hub's
  part_of closure 1 ms, while attention takes 345 ms, nearly all of it the
  lens read that none of them would save (the task records the numbers).
  They wait for the 10-million-event benchmark (section 9) to show a need.

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

## 8. Packs in space and time

Packs compose in space and in time (Rule 8 of the target model, `e_rjhdxurr`,
amended 24 Oct 2026; the principles kept from the kernel cut, `e_u7u7wvgm`,
after Cordis). In the log that means: which packs are active is a fact, what
a pack registers is a projection of that fact, and a change a pack's code
makes carries the pack and stays inside what it declares.

### In time: a pack's presence is a fact

Adding a pack to a workspace asserts it, on the id `pack:<id>`:

```json
["+", "pack:time", "pack", { "version": "1.4.0", "manifest": "9c1e…07af" }]
```

`manifest` is the SHA-256 of the pack's `pack.json` as it was when added,
kept as a blob in clear and forever (a manifest is schema, not content).
Removing it is `["-", "pack:time", "pack"]`. Moving to a new version, or a
manifest that changed on the server, asserts the fact again with the new
hash, in a system change set when the workspace opens (today's `types.sync`
and `PACKS_OFF` both become this). These are facts in the fact stream, kept
forever, never the compacted `settings` stream: who turned a way of working
on and off, when and on whose authority is part of the record.

- **Who decides.** A core rule makes adding and removing a pack the owner's:
  an agent's change to a `pack` fact waits for a person; a human's applies.
  The core pack is asserted in a workspace's first entry and a core rule
  refuses retracting it.
- **Server packs** are the same facts on the server's own log
  (`e_8g9feum7`), made by the operator; a server pack's keys and values are
  its `pack:<id>` stream on that log.
- **Removing a pack refuses** while another active pack requires it, unless
  the same change set removes that one too; the refusal names them.

### Every registration is a projection

Nothing a pack registers is stored apart: types, link types, rules, views,
actions and the tools they become, handlers, screens, routes, drawings and
styles are the **registry projection**, computed from the set of packs active
at a position and each one's manifest blob, with the workspace's own
`type_def` facts. So:

- **Removing a pack unwinds it.** The next position's registry has none of
  its registrations: its tools leave the agent surface, its screens and
  routes leave the app, its rules stop deciding, its handlers stop running.
  Nothing is deleted to make this so.
- **Its items stay.** Items of its types and links of its link types stay in
  the log and in the current state, their types **dormant**, read from the
  last manifest the pack had; core's `dormant` rule holds what is written to
  them. Its `pack:<id>` stream is no longer read and is kept by its own
  retention; adding the pack back reads it again.
- **Any moment is replayable.** The registry as of position P is the packs
  active at P with the manifests named then, so a view of the map as it was
  shows which packs were on and draws their types as they were declared.
- **Code that is missing.** A pack the log says is active but whose code the
  server lacks is **waiting**: its registrations are off and its types
  dormant until the code is back. Nothing is written for that: it is the
  projection reading what the server has.
- The registry projection is versioned like any other (section 7); a change
  to how manifests are read rebuilds it, and the manifests themselves never
  change.

### In space: what a pack requires and uses

A manifest declares, beside its types, links and the rest:

```json
{
  "id": "time",
  "requires": ["core", "software"],
  "uses": ["money"]
}
```

- `requires`: packs it cannot work without. While one is not active, the
  pack is **waiting**: active in the log, nothing registered.
- `uses`: packs it works with when present. Its registrations that name a
  used pack's types (a view over `money.invoice`, a handler on its events)
  are registered only while that pack is active.
- A pack's **reach** at a position is what it may touch: the types, link
  types and fields it declares; those of the packs it requires; those of the
  packs it uses that are active; and core's kinds.

### A change set a pack's code makes

When a pack's action (called by a person or an agent) or its handler (run on
an event or a schedule) makes a change, its entry's `pack` header names the
pack, the manifest it ran under and the action or handler:

```json
{
  "actor": { "id": "e_jmbe7v52" },
  "pack": { "id": "time", "manifest": "9c1e…07af", "action": "log" },
  "reason": "Logged 2h on the export work", "facts": [ … ]
}
```

For an action, `actor` is who called it; for a handler, `actor` is
`{ "id": "pack:time" }`, and the authority is the pack's (`of: "agent"`).
The rules then judge the change with the pack known, and a core rule refuses
one that reaches outside the pack:

```json
{
  "id": "pack_reach",
  "when": { "pack": true, "reach": "outside" },
  "then": "refuse",
  "say": "{pack} touched \"{title}\", a {type} it neither declares nor requires."
}
```

`reach: "outside"` holds when any fact writes an item or link whose type, or
a field, is outside the pack's reach at the head position. It is checked like
every other rule, in `decide`; nothing outside the rules refuses it.

---

## 9. Size and speed at scale

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
Blobs are outside these numbers: a picture is stored once, by hash.

### Rows per day for a team of ten with agents

From the live map (one person and agents, about 17,500 rows in three weeks)
scaled to ten people, each running a few agent sessions a day:

| stream | appended per day | kept after compaction |
| --- | --- | --- |
| facts: ~1,200 change sets of ~5 facts, with ~100 runs started and ended | ~1,400 headers + ~6,500 facts | all, forever (~2.8 million fact rows a year) |
| pending: proposals and their fates | ~100 | all |
| sessions: ~100 runs, ~50 entries each (story beats, token counts) | ~5,000 | latest per run for 180 days; two weeks of history |
| notifications | ~300 | ~30 to 90 days |
| claims, automations, settings, access | ~500 | mostly latest |
| observations | ~2,000 | thinned to ~50 per item and field a month |

About 15,000 rows appended a day, about 8,500 kept: some 9 million kept rows
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
   and the time to write and to load one; the registry projection at a past
   position with a different pack set.
5. **As-of reads**: one item's field at a random past position (one history
   index lookup); one item whole at a past time; a lens over a subtree as of a
   time a month back (snapshot plus replay).
6. **Undo and approval at head**: the fast-path check and a rebase for a
   proposal whose base is 10,000 entries behind.
7. **Compaction**: time to compact one day of `sessions` and `observations`,
   rows and blobs dropped; time to seal a segment.
8. **Forget**: time to delete the keys, replace the sealed values by their
   digests and delete the projection and search rows, for an item with 1,000
   facts and 100 links, and with 50 change set reasons chosen to go with it.
9. **Row-level security** on `log_fact` (its join to the current state) for
   a member reading an item's history and for `changed_since` over a day.
10. **Vault**: size with 1 million keys, unwrap cost per key, cache hit rate
    during replay.

---

## 10. Every write today, and where it goes

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
| `apply` with `input.action` (a pack action) | the `pack` header, judged by `pack_reach` (section 8) |
| `ensureSource`: `insert into entity` (sys.source), `log entity.create` | the source item's facts in the same change set |
| `supersede`: `update proposal set status = 'superseded'`, `log proposal.supersede` | a fact entry with no facts, `rule.outcome: superseded`, actor `system` |
| `fillKinds`: `update entity set kind` | a system change set asserting `kind` (only when a pack moved a type's kind) |
| `retype`: `update entity|relation set type`, lens and screen settings rewritten, `log type.moved` | a system change set asserting the new `type` (or `link`) and the renamed settings for each item touched (`e_w66xm7kt`) |
| `log` (the generic insert into `event`) | gone: the entry is the event; each caller is mapped below |
| `operational`: `last_seen`, `active`, `busy` | never stored (memory) |
| `operational`: `tokens_used`, `story`, `stale_flagged` | `sessions` stream |
| `operational`: `last_run`, `last_fired`, `last_result` | `automations` stream |
| `operational`: `rechecked_at` | `automations` stream |
| `operational`: `reach` (who may read a notification) | `notifications` stream |
| `claim`: `insert into relation` (holds), `log resource.claim` | `claims` stream: a `link` fact |
| `release`: `update relation set valid_to`, `log resource.release` | `claims` stream: `["-", r, "link"]` |
| `checkConnections`: `update entity set status` (outside `change` today), `log connection.check` | `observations` stream: the connection's reachability as an observed `status` (the connection item itself stays facts) |
| `setSecret`: `insert into setting`, `delete from setting` | the key vault's `vault_secret`; the `settings` stream records the name only (`e_7cv7xefh`) |
| `init`: owner person created through `apply`; `insert into setting` (`agent_changes`, `me`) | facts for the person; `settings` stream |
| `restoreRows` (restore from a backup) | gone: restoring is verifying a copied log and replaying it; a copy that diverged from this one has its later entries proposed here, rebased by section 3 (`e_u7a3ubgy`) |

### Stores named in `src/operational.ts`

| store | becomes |
| --- | --- |
| `MAP_TABLES`: `entity`, `relation`, `event` | the log (`log_entry`, `log_fact`, `log_blob`); `entity` and `relation` become projections; `event` goes |
| `ON_THE_MAP.sessions` | a run's start, end and the task it is on: facts (`e_fst4wzsv`); its story, tokens and stale flag: `sessions` stream; its heartbeat: memory |
| `ON_THE_MAP.claims` | `claims` stream |
| `ON_THE_MAP.notifications` | `notifications` stream; `src/notify.ts`'s `apply` and `src/outbox.ts`'s delivery write there |
| `ON_THE_MAP.automations` | `automations` stream; `automation.fire` and `run.stale` are entries there |
| `ON_THE_MAP.rechecks` | `automations` stream; `recheck.done` an entry there |
| `ON_THE_MAP.kinds` | the `kind` fact at creation |
| `token` | facts on the token's id, kept forever: its hash, hint, kind, name, item, expiry, revocation (`e_x9wxnqz4`); `last_used` in the `access` stream, at most hourly |
| `share` | facts, kept forever: granted and revoked (`e_x9wxnqz4`) |
| `setting` | `settings` stream; secrets in the key vault (`e_7cv7xefh`); the packs turned off are `pack` facts (section 8) |
| `member` | facts, kept forever: added, changed and removed (`e_x9wxnqz4`) |
| `proposal` | `pending` stream plus deciding entries (section 3) |
| `published` | a fact entry on a publication id (`pub_…`): the frozen text sealed with the document's key, so forgetting the document unpublishes it everywhere; unpublishing retracts it |
| `picture` | a blob sealed with the test result's key; its hash in the `observations` stream, `latest` only (`e_7kharzf2`) |
| `act` | a request that waits is a `pending` record like a proposal; `act.done` and `act.refused` are fact entries with no map facts and an `act` header, kept forever (a payment made outside cannot be taken back, and the chain should say so) |
| `type_def` | the registry projection: active `pack` facts, their manifest blobs and `type_def` facts (section 8) |
| `local_type` | a projection of `type_def` facts across workspaces |
| `transient` | an unlogged Postgres table, entries expiring, never backed up: the one store outside the log besides the vault (`e_a7fjzcwv`) |
| `pack_store` | the pack's `pack:<id>` stream (on the server log for a server pack), read only while the pack is active, kept by its retention after it is removed |
| `control_workspace`, `control_value`, `github_installation` | the server's own log, in this format, outside any workspace (`e_8g9feum7`); server packs added and removed are `pack` facts there |
| `schema_version` | gone: entries carry `v`, snapshots `projection_version` |

### Events written outside `src/pelago.ts`

| action | becomes |
| --- | --- |
| `changeset.undo` (`src/undo.ts`) | the undo change set itself, with `undoes` |
| `audit.import` (`src/audit.ts`) and its cursor setting | `observations` stream; cursor in `automations` |
| `workspace.import`, backup restores (`src/backup.ts`: `insert into event`, `proposal`, `setting`, `update token`) | replaying a log; imported entries keep their own positions and hashes in their own chain; a diverged copy's later entries become proposals (`e_u7a3ubgy`) |
| `workspace.backup_download` | `access` stream |
| `share.create`, `share.revoke`, `share.workspace` | facts, kept forever (`e_x9wxnqz4`) |
| token made, moved, revoked (`src/auth.ts`, `src/members.ts`, `src/tools.ts`) | facts, kept forever; last use in `access` |
| `PACKS_OFF` (`src/packstate.ts`) | `pack` facts: a pack added or removed (section 8) |
| `workspace.set` (`src/model-tools.ts`, `src/workspace-tools.ts`), `me` (`src/tools.ts`) | `settings` stream |
| `changes.seen`, `questions.confirmed` | `settings` stream, per person |
| `run_once` marks (`src/agent-run.ts`) and the automation cursor (`src/automations.ts`, now a fact position) | `automations` stream |
| pack secrets (`src/outside.ts`) | the key vault (`e_7cv7xefh`) |
| `act.done`, `act.refused` | fact entries, as above |
| `picture.stored`, `picture.removed` | a blob and its hash in `observations` |
| `document.publish`, `document.unpublish` | fact entries (`published` above) |
| `types.sync` (`src/typetable.ts`) | the `pack` fact asserted again with the new manifest hash, only when a manifest changed |
| `connection.made`, `connection.ended` | facts on the connection item (it is a thing on the map); its reachability in `observations` |
| `workspace.notify` (`src/outbox.ts`) | `notifications` stream |
| `server.workspace.add`, `server.workspace.deliver` | the server's own log (`e_8g9feum7`) |
| migrations (`src/schema.ts`: `update event`, `update token`) | gone: a format change is an upcaster |

---

## 11. Decided

The owner's answers of 24 Oct 2026 to the questions this spec raised, each a
decision under `e_j8df78ar`, stated as settled in the sections above:

1. Retention: the keeps in section 4, except a run's start and end and access
   grants, which are facts kept forever (`e_uhpg9bug`).
2. Forgetting an item offers the change set reasons and bases that mention
   it; the person chooses which go with it (`e_4uzgmsry`).
3. A link's fields are forgotten when either end is (`e_grqeftj2`).
4. A forgotten item's sealed bytes are dropped; the chain survives by digest
   (`e_k2aex62z`).
5. Secrets live in the key vault (`e_7cv7xefh`).
6. The vault is a table in the same database; its backups are kept 30 days
   (`e_98cdhgn6`).
7. Transient values go in an unlogged Postgres table, never backed up, the
   one other store outside the log (`e_a7fjzcwv`).
8. Large binaries are blobs in a content-addressed store beside the log,
   sealed with their item's key, the log holding the hash (`e_7kharzf2`).
9. A run's start, end and task are facts kept forever; its story, tokens and
   heartbeats are operational (`e_fst4wzsv`).
10. A diverged copy's later entries become proposals here (`e_u7a3ubgy`).
11. The server's own state is a server log in this format (`e_8g9feum7`).
12. Access grants (tokens as hash, members, shares) are facts kept forever;
    last use is operational (`e_x9wxnqz4`).
13. A type a pack moves is a system change set asserting the new type on
    every item (`e_w66xm7kt`).
