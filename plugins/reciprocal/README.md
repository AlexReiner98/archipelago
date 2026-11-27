# reciprocal

A mesh (nodes with normals, and edges) solved as a reciprocal frame: each
edge a beam, drawn as a cylinder, and each beam two agents, its ends. The
agents are particles in the Landscape's own arrays
([plugins/field/graph.ts](../field/graph.ts)) and are settled by the field's
own `step` ([plugins/field/step.ts](../field/step.ts)), with rules of their
own in place of gather, repel and springs. A frame is kept on the map as
items, so what was chosen is in the history and can be undone, and other
plugins (the [review](../review/README.md)) can work on its beams.

| File | Runs | What it is |
|---|---|---|
| [map.ts](map.ts) | server | The `frame` and `beam` flavours and the actions. Injects `types.define`, `action.register`, `graph.read` |
| [settings.ts](settings.ts) | both | Every dial, where each starts, and a kept frame as the settings the rules read. Pure |
| [pipeline.ts](pipeline.ts), [rules.ts](rules.ts), [beams.ts](beams.ts), [agents.ts](agents.ts), [mesh.ts](mesh.ts) | both | The solve. Pure: the server runs it with no page |
| [index.ts](index.ts) | page | The view "Reciprocal" in `center`. Injects `here.*`, `slot.*`, `graph.read`, `graph.watch`, `action.invoke` |

## On the map

Fitted to the bases ([spec/types.md](../../spec/types.md), "Fitting a new
idea"): a thing in a design is a `record`, current until superseded.

| Type | Is | Fields |
|---|---|---|
| `frame` | a flavour of `record`, on trial | `mesh` (dome, vault, fan), `detail` (1 to 4), `dials`: the design's dials that differ from where they start, by key |
| `beam` | a flavour of `record`, on trial, `part_of` its frame | `index`: the edge of the mesh, from 0; `diameter`: its own, in cm, absent for the frame's |
| a solve | a `record` of kind `solve`, `about` the frame | `value`: `{ by: "reciprocal.solve", frame, settled, steps, worst, under, items }`, `items` each beam's worst gap by its id, as a share of its diameter |

The graph holds what was chosen, not what was computed: the mesh, the
dials and the diameters. A solve is rebuilt from them, and kept as one
record that the next solve supersedes. The drawing's dials are the page's.

## Actions

Each is one change set; agents call them through `act`.

| Action | Takes | Does |
|---|---|---|
| `reciprocal.create` | `title`, `mesh`, `detail?`, `dials?`, `diameters?` (by index), `part_of?` | Makes the frame and a beam for each edge of its mesh. A frame's mesh and detail are fixed: another is another frame |
| `reciprocal.dial` | `frame`, `dials` (`null` puts one back) | Sets the design's dials. Out of range, mesh or detail: refused (`reciprocal.dial`), saying what would do |
| `reciprocal.diameter` | `beams` (ids), `diameter` (`null` for the frame's) | Gives beams their own diameter, in one change set |
| `reciprocal.solve` | `frame`, `record?` | Runs the rules on the server to settled (or the run's most steps), and keeps the result as a record about the frame, superseding the one before. The same choices again write nothing |

## On the page

- **Frame**: Scratch is a frame in page state only, as before; **Keep on the
  map** makes it a frame on the map, and picks it. A kept frame's dials
  and diameters are read from its items and written through the actions
  above once a dial is still for 400 ms, so a drag is one change set.
  **Solve and keep** runs `reciprocal.solve`.
- On a kept frame, the beam picked is `here.item`, so the item page and
  any panel that follows the item follow it.
- The slot `reciprocal.side`, under the Beam section, is where other
  plugins show what they have to say about `here.item` (the review's
  issues).

## The solve is a DAG of rules

[rules.ts](rules.ts) runs rules in an order where each comes after what it
needs, and again only where a dial it reads changed or a rule it needs ran
again. [pipeline.ts](pipeline.ts) holds them:

```
mesh ─▶ fans ─▶ rests ─▶ frame ─▶ solve ─▶ measure
  │        └──────────────▲         ▲
  ├──────────▶ radii ─────┼─────────┘
  └───────────────────────┘
```

| Rule | Makes | Dials |
|---|---|---|
| `mesh` | The input: seeded until meshes can be drawn ([mesh.ts](mesh.ts): dome, vault, fan) | `mesh`, `detail` |
| `fans` | At each node not a support, its beams sorted round the node's normal | |
| `rests` | Who rests on whom: each beam on the next round its fan, made a DAG | `turn` |
| `radii` | Each beam's radius: `diameter`, or the beam's own | `diameter`, `d_*` |
| `frame` | The agents, two per beam, seeded by sweeping the DAG from the supports up | `engage` |
| `solve` (live) | Each step: the DAG's sweep, then the agents' pushes through the field's step | |
| `measure` (live) | Each contact's gap and whether its end is on the normal's side | |

A beam's own diameter runs `radii` only: the solve takes the new radii and
warms from where it is. The side shows the DAG as it runs: each rule's
box says what it made, is lit when it ran on the last change, and dashed
when it is live ([diagram.ts](diagram.ts)).

## Rests on, as a DAG

Each fan is a cycle (beam 1 rests on 2, 2 on 3, …, the last on 1): that is
what reciprocal means. [beams.ts](beams.ts) `rests` makes the whole frame's
"rests on" acyclic: beams are taken from the supports up, each once what it
rests on is placed; where every beam left waits on one not placed, the one
nearest the supports goes anyway and the contacts it waited on are marked
closing. A beam's level is one more than the highest beam it rests on
through contacts that are not closing.

## The agents' rules

Each is vector code applied to every agent it touches, as a behaviour of
the field's kind ([agents.ts](agents.ts)):

- `rest`: each end moves to where it rests on the beam beneath
  (`restAt`): `engage` of that beam's length in from the node, the two
  radii off its centreline along the two beams' common perpendicular, on
  the node normal's side. The beam beneath takes the other side of the
  push.
- `collide`: beams of one fan that are not next to each other keep their
  two radii apart.
- `hold` and `length`, off to start: each end drawn to where it started,
  each beam to its first length.
- `sweep`, the DAG's rule: once a step, before the pushes, in the DAG's
  order, each end resting through a contact that is not closing moves
  `sweep` of the way to `restAt`. It and `rest` aim at the same point, so
  they settle at the same place; closing contacts are left to the pushes.
  On the seeded dome the sweep settles in about a third of the steps the
  pushes take alone, with a smaller worst gap (`test/reciprocal.test.ts`).

## Drawing it

- Cylinders in WebGL2 ([gl.ts](gl.ts), [engine.ts](engine.ts)), coloured by
  their worst contact's gap (held when touching, failed when off), by DAG
  level, or plain (`colour`). Contacts are dots; a closing one is ringed.
  The input mesh and its normals are faint lines; supports are grey dots.
- Drag to turn, shift- or right-drag to pan, wheel to zoom, double-click
  to fit. A click picks a beam, shift-click adds one: the Beam section
  ([inspect.ts](inspect.ts)) then tunes its own diameter (several at once),
  lists what it rests on and carries with each gap, and its DAG level.
- Every number is a dial, in the field's panel: the input, each agent
  rule, the sweep, the field's run dials (started for centimetres:
  `RUN_HERE` in [dials.ts](dials.ts)) and the drawing.
- Page state: `reciprocal.frame` (the frame shown), `reciprocal.dials`
  (the drawing's, and a scratch frame's), `reciprocal.diameters` (a scratch
  frame's, by `<mesh>.<detail>.<beam>`) and `reciprocal.beams`; the browser
  remembers the first three.
