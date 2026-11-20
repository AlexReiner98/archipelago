# items

The actions anyone edits the map with. Generic: it reads types from
`types.read` and knows bases and field kinds, never a type's name.

| Action | Does |
|---|---|
| `items.create` `{ type, title, fields?, part_of? }` | Makes an item at its base's first open status (or `fields.status`), linked `part_of` in the same change |
| `items.set` `{ id, fields }` | Sets fields, `null` clears one; a status must be its base's |
| `items.link` `{ type, from, to, fields? }` | Links two items; the ends must be of the bases the link allows |
| `items.unlink` `{ id }` | Takes a link away whole |

Each refuses early with the field named (`items.field_unknown`,
`items.status`, `items.link_end`, …); the schema pack checks the same in
the write chain for writes from anywhere. Injects `action.register`,
`graph.read`, `types.read`.
