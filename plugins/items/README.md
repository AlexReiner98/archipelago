# items

The actions anyone edits the map with. Generic: it reads types from
`types.read` and knows bases and field kinds, never a type's name.

| Action | Does |
|---|---|
| `items.create` `{ type, title, fields?, part_of? }` | Makes an item at its base's first open status (or `fields.status`), linked `part_of` in the same change |
| `items.set` `{ id, fields }` | Sets fields, `null` clears one; a status must be its base's |
| `items.link` `{ type, from, to, fields? }` | Links two items; the ends must be of the bases the link allows |
| `items.unlink` `{ id }` | Takes a link away whole |
| `items.merge` `{ keep, drop, rule?, fields?, across_types? }` | Makes two items for one thing one, in one change set (below) |

## Merging two items for one thing

`items.merge` writes one change set, so `history.undo` of it unmerges:

- Every link at `drop` is re-pointed to `keep`. One that would then tie
  keep to itself, or double a link keep has (same kind, same ends), is
  taken away whole instead.
- Drop's fields come over by the rule: one keep doesn't have, keep takes;
  one both hold, keep's stays, unless `rule: "drop"`, or `fields: { note:
  "drop" }` for one field.
- `drop` is taken away with every value it held, and keep's type is said
  again (retracted, then asserted: nothing changes), so the log names
  keep for a reader such as sync.
- Refused when either is missing (`items.missing`), the two are one
  (`items.merge_self`), either is a link (`items.not_an_item`), or their
  types differ (`items.merge_types`) unless `across_types: true`; then
  drop's fields keep's type has no room for are left, named in the
  answer's `left`, and back on undo.

It answers `{ keep, drop, moved, removed, took, left }`. An `id` field
elsewhere that names drop is not changed: links are the map's ties.

On the page ([view.ts](view.ts)): "merge…" on the item page, in its slot
`item.actions`, finds the item's twin among items of its type by a word
of its title; picking one shows both, which stays and which goes, the
links that move or go and each field that differs, worked out by the same
`mergeFacts` the action runs. "keep the other" swaps them. Merge runs
`items.merge` as the person at the page; its undo is in the item's
history. Tested in `test/items.test.ts`.

Each refuses early with the field named (`items.field_unknown`,
`items.status`, `items.link_end`, …); the schema plugin checks the same in
the write chain for writes from anywhere. Injects `action.register`,
`graph.read`, `types.read`; the page side `find.index`, `here.read`,
`here.set`, `slot.fill`, `action.invoke`.
