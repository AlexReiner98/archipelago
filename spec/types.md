# types

What kinds of item and link the map holds. The graph knows no types; the
types broker holds them, plugins fill it, and the schema plugin checks writes
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
  closed. Edition 1's plugins ship four: work, question, record, actor.
- **A flavour** names its base and adds fields, never statuses or
  behaviour. The broker refuses a flavour of a base that isn't there, or
  one that declares a field its base already has.
- **A field before a flavour**: `kind: bug` on work, until there is a real
  reason for a type.
- **A new flavour starts as a trial**, kept by its record and dormant
  when unused, under the same loop as nodes. `trial` says which.
- **Code knows bases and field kinds, never type names.** A UI draws a
  status by whether it is open or closed, and a field by its kind. A view
  for one flavour is a plugin of its own.

Every base has `title`, `note` and `status` (`COMMON`); a base or flavour
declares only what it adds. A new item takes its base's first open status.

## Marks

Edition 10: the plugin that defines a base names the shape its items are
drawn in (`types.mark` `mark(base, shape)`, one of the style's
`MARK_SHAPES`), so no two bases look alike. A shape another base holds, or
a second shape for one base, is refused. A base none names takes the first
shape no base holds, in the order bases are defined; `marks()` gives every
base defined now with its shape. Edition 1's plugins name theirs: work a
square, question a diamond, record a circle, actor a triangle; the profile
plugin's base is a hexagon. A shape is the naming plugin's effect and goes
when it unloads.

## Links

A kind of link names the bases its ends may be (`from`, `to`; absent, any),
a flavour counting as its base. Edition 1's plugins ship five: `part_of`,
`depends_on`, `waits_on` (to an actor), `bears_on` (to a question) and
`about`. A grouping is a link, never a field.

## Acyclic kinds of link

Edition 11: a plugin can hold a kind of link acyclic (`types.acyclic`), so
the links of that kind form a DAG: an order of steps, a tree of tests. The
schema plugin then refuses a change set whose links of that kind would close
a loop (`schema.cycle`, naming the loop). Only what a set touches is
judged: a loop already on the graph is refused once a set changes one of
its links, not before. A kind stays held while any plugin holds it.

## Fitting a new idea

How a plugin puts a new idea on the map without a new base or a new kind
of field (decided 27 Nov 2026, on a reciprocal-frame solver that fit
without either). The words plugin's seed says these where a run writes a
plugin (`app/tree.ts`, "A new idea fits the schema").

- **A base by behaviour.** A thing in a model or a design (a point, a
  beam, a part) is a record: current until superseded. A new base is for
  new statuses, and that is the spec owner's call.
- **A field before a flavour.** `kind` on the base first; a flavour, on
  trial, once the idea needs fields of its own.
- **A relation is a kind of link**, with a few fields of its own if it
  needs them (a beam's diameter). A grouping is `part_of`, never a field.
  An order or a tree is an acyclic kind (`types.acyclic`).
- **Geometry is `json`**, its shape and unit in the field's `doc` (a point
  `[x,y,z]` in cm), not a new kind of field.
- **The graph holds what was chosen, not what was computed.** Inputs and
  decisions are items. A solve, a layout or a simulation is rebuilt from
  them, or kept as one record `about` its input that the next one
  supersedes; never an item per particle or per frame.
- **Every write is a declared action** (`items.create`, `items.set`,
  `items.link`), so it is journaled and undone like any other, and every
  read is bounded. `schema.check {facts}` says whether facts fit before
  they are sent.

## Names

Type names are unprefixed (`work`, `part_of`), so data moved from another
map lands as it is. A taken name is refused, never replaced: two plugins
can't both define `work`. To replace a base, turn its plugin off and load
another. Definitions are the defining plugin's effects and go when it
unloads; what is on the graph stays, unchanged, and fits again when the
type is defined again. Views drawn from the types leave those items out
meanwhile; the schema plugin lists them (`schema.untyped`, with the plugin
that last defined each type) and checks what is written to them.
