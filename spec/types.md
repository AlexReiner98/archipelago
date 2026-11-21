# types

What kinds of item and link the map holds. The graph knows no types; the
types broker holds them, packs fill it, and the schema pack checks writes
against it in the write chain. Types: [types.ts](types.ts).

## Capabilities

| Key | Gives |
|---|---|
| `types.define` | Define a base, a flavour or a kind of link |
| `types.read` | What is defined now, resolved, and when it changes |

## Few bases, flavours

Decided (20 Nov 2026, "How do types grow without creeping?"):

- **A base** is a kind of item by behaviour: its statuses, open and
  closed. Edition 1's packs ship four: work, question, record, actor.
- **A flavour** names its base and adds fields, never statuses or
  behaviour. The broker refuses a flavour of a base that isn't there, or
  one that declares a field its base already has.
- **A field before a flavour**: `kind: bug` on work, until there is a real
  reason for a type.
- **A new flavour starts as a trial**, kept by its record and dormant
  when unused, under the same loop as nodes. `trial` says which.
- **Code knows bases and field kinds, never type names.** A UI draws a
  status by whether it is open or closed, and a field by its kind. A view
  for one flavour is a pack of its own.

Every base has `title`, `note` and `status` (`COMMON`); a base or flavour
declares only what it adds. A new item takes its base's first open status.

## Links

A kind of link names the bases its ends may be (`from`, `to`; absent, any),
a flavour counting as its base. Edition 1's packs ship five: `part_of`,
`depends_on`, `waits_on` (to an actor), `bears_on` (to a question) and
`about`. A grouping is a link, never a field.

## Names

Type names are unprefixed (`work`, `part_of`), so data moved from another
map lands as it is. A taken name is refused, never replaced: two packs
can't both define `work`. To replace a base, turn its pack off and load
another. Definitions are the defining pack's effects and go when it
unloads; what is on the graph stays, and the schema pack says what no
longer fits.
