# types

What kinds of item and link the map holds. The graph knows no types; the
types broker holds them, packs fill it, and the schema pack checks writes
against it in the write chain. Types: [types.ts](types.ts).

## Capabilities

| Key | Gives |
|---|---|
| `types.define` | Define a base, a flavour or a kind of link |
| `types.read` | What is defined now, resolved, and when it changes |
| `types.acyclic` (11) | Kinds of link held acyclic, which no change may close a loop of |
| `types.mark` (10) | The shape each base is drawn in |

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

## Marks

Edition 10: the pack that defines a base names the shape its items are
drawn in (`types.mark` `mark(base, shape)`, one of the style's
`MARK_SHAPES`), so no two bases look alike. A shape another base holds, or
a second shape for one base, is refused. A base none names takes the first
shape no base holds, in the order bases are defined; `marks()` gives every
base defined now with its shape. Edition 1's packs name theirs: work a
square, question a diamond, record a circle, actor a triangle; the profile
pack's base is a hexagon. A shape is the naming pack's effect and goes
when it unloads.

## Links

A kind of link names the bases its ends may be (`from`, `to`; absent, any),
a flavour counting as its base. Edition 1's packs ship five: `part_of`,
`depends_on`, `waits_on` (to an actor), `bears_on` (to a question) and
`about`. A grouping is a link, never a field.

## Acyclic kinds of link

Edition 11: a pack can hold a kind of link acyclic (`types.acyclic`), so
the links of that kind form a DAG: an order of steps, a tree of tests. The
schema pack then refuses a change set whose links of that kind would close
a loop (`schema.cycle`, naming the loop). Only what a set touches is
judged: a loop already on the graph is refused once a set changes one of
its links, not before. A kind stays held while any pack holds it.

## Names

Type names are unprefixed (`work`, `part_of`), so data moved from another
map lands as it is. A taken name is refused, never replaced: two packs
can't both define `work`. To replace a base, turn its pack off and load
another. Definitions are the defining pack's effects and go when it
unloads; what is on the graph stays, and the schema pack says what no
longer fits.
