# schema

A check stage on the graph's write chain ([spec](../../spec/graph.md)).
Before calling `next`, it checks each change set against the types defined
now (`types.read`, [spec](../../spec/types.md)). A set that doesn't fit is
refused whole and **quarantined**: kept with what was wrong, in SQLite
(`config.db`), or in memory without one. It is neither dropped nor applied
on its own.

| Action | Does |
|---|---|
| `schema.quarantined` `{ state?, limit?, after? }` | Held sets newest first, with header, facts and problems; writes nothing |
| `schema.release` `{ quarantine }` | Sends a held set again as the releaser's change; marked released once applied |
| `schema.drop` `{ quarantine }` | Stops holding it, with the call's reason; the record stays |
| `schema.check` `{ facts }` | Would these facts fit? Writes and holds nothing |
| `schema.record` `{ type? }` | Each type's record: items made of it, held sets it caused, when last, and whether it is a trial flavour; writes nothing |

The record is what the learning loop keeps a trial flavour by, or makes it
dormant by (decision "How do types grow without creeping?"). A type counts
as made when an item is new or given that type. A held set counts once
against each type it had a misfitting item of. Refusals made inside an
action before it writes (such as `items.*` checks) never reach the chain,
so they aren't counted. The pack names no type: statuses and fields come
from the base, through `types.read`.

What it checks (check.ts):

- An item made, or given a new type, is checked whole. On an item already
  there, only the fields the set asserts are, so what was written before a
  type was defined isn't refused for being touched.
- A field the type doesn't have: `schema.field_unknown`. A value not of the
  field's kind: `schema.field_kind`. A `status` not among its base's:
  `schema.status`. An `id` field naming nothing: `schema.id_missing`.
- A link needs `from` and `to` naming items that exist, of the bases the
  kind of link allows: `schema.link_end`. A link given a new type is checked
  with the ends it already had, read from the graph like any other. An item that isn't a link has
  neither: `schema.not_a_link`. Fields but no type: `schema.type_missing`.
- A type nobody defines passes unchecked, unless `config.strict`
  (`schema.type_unknown`). The harness packs write such types today.

The refusal is `schema.quarantined`, with the held id and every problem. A
release that still doesn't fit is refused with `schema.misfit` and stays
held; nothing new is held for it. Order in the tree: after the packs that
define types and before history, so history journals only what applied.
Without a `types.read` provider the pack is inactive and nothing is checked.

Injects `graph.stage`, `graph.read`, `types.read` and `action.register`.
Node only.
