# changeset

A change, written in full. The journal keeps them, undo inverts them, and
they are what moves between two places (an export, a sync, a plugin's seed
data). Types: [changeset.ts](changeset.ts).

## Shape

```ts
{
  header: { actor, authority, plugin, action, reason, time, undoes?, run? },
  facts: [
    ["+", "e_1", "type",   "task"],
    ["+", "e_1", "title",  "Write the contracts"],
    ["-", "e_2", "status", "todo"],
    ["+", "e_2", "status", "doing"],
  ]
}
```

- A fact is `[op, id, field, value]`. `+` asserts, `-` retracts.
- A field holds one value. Changing it is `-` of the old value and `+` of
  the new one, in that order.
- An item is created by asserting its fields, `type` among them. A link is
  an item with `from` and `to` fields. Removing an item is retracting every
  field it has.
- A retraction always names the value it removes. That's what makes the
  set complete: the inverse is the facts reversed with each op flipped
  (`inverse()` in the types), and needs nothing read from the graph.
- `header.plugin` and `header.action` are always set: no change is made
  outside an action (see [action](action.md)).

## Undo

Undo is a new change set: the inverse of the old one's facts, `undoes`
naming it, with its own actor, authority and reason. It goes through the
write chain like anything else.

The graph applies a retraction only when the field holds that value now.
If something has changed the field since, the undo is refused with
`graph.conflict` and says which facts no longer hold. Undoing the later
change first, or a fresh change, resolves it. Nothing is merged silently.

## What it is not

The graph is the truth. Change sets are a record of how it got there, kept
by the history plugin, and the journal can be trimmed. Nothing rebuilds the
graph from them.
