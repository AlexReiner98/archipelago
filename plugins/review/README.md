# review

Issues raised about items on the map, by a person, an agent, or a check
of what a record measured. It knows no other plugin: it works on any item,
and checks any record of the right shape. Beside a
[reciprocal](../reciprocal/README.md) frame, its issues are on the beams.

| File | Runs | What it is |
|---|---|---|
| [index.ts](index.ts) | server | The actions. Injects `action.register`, `graph.read` |
| [view.ts](view.ts) | page | The issues about `here.item` and its parts, in the slot `reciprocal.side`. Injects `here.read`, `slot.fill`, `action.invoke`, `graph.watch` |

## On the map

No type of its own: the bases already say what an issue is.

| What | Is |
|---|---|
| An issue | a `question` of kind `review`, linked `about` each item it is raised on: open until decided (fixed, or accepted as it is) or dropped |
| Its evidence | a record that `bears_on` it: the measuring record a check raised or decided it from |

## Actions

Each is one change set; agents call them through `act`.

| Action | Takes | Does |
|---|---|---|
| `review.raise` | `title`, `about` (ids), `note?` | Raises an issue about the items. An item not on the map: refused (`review.missing`) |
| `review.of` | `items`, `open?` | Read only. The issues about each item and its parts (`part_of` it), open ones unless `open: false`, each with `about` and whether a check raised it (`measured`); and `measures`, the current measuring records about the items or what they are part of |
| `review.check` | `record`, `over?` (default 0.05) | Reads the record's `value.items`, item ids to a measured share. Raises an issue on each item over `over` that has none open; decides each open issue a check raised on an item now within it (`outcome` says the share). The record `bears_on` each issue it raised or decided. A record that measures nothing: refused (`review.not_measured`) |

An issue raised by hand is never decided by a check: a check decides only
issues a measuring record bears on. Mark one fixed or drop it with
`items.set` on its `status`, as for any question.

## A measuring record

Any plugin's record can be checked, if its `value.items` maps item ids to a
number: a share, where 0 is right and more is worse. A reciprocal solve's
is each beam's worst gap as a share of its diameter. That shape is the
whole agreement between the two plugins; neither imports the other.

## On the page

In the Reciprocal view, under the Beam section: the open issues about the
item shown (a frame, or the beam picked), each with **fixed** and
**drop**; a line to **Raise** one about it; and **Check the last solve**,
which runs `review.check` on the newest measuring record. It redraws when
a question or a record changes.
