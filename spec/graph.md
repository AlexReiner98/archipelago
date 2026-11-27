# graph

The graph plugin stores items and links. The log of committed change sets
is the truth and the graph's tables are its projection (decided 27 Nov
2026): the history plugin keeps the whole log, and `graph.since` only the
last sets, for watchers. This is what every other plugin sees of it. Types: [graph.ts](graph.ts).

## Capabilities

| Key | Gives |
|---|---|
| `graph.read` | Bounded reads |
| `graph.watch` | Live watch |
| `graph.stage` | Add a stage to the write chain |
| `graph.commit` | Enter the write chain (the action plugin only) |

## Items and links

An item is `{ id, type, fields }`. A link is an item with `from` and `to`.
The graph knows no types: which types exist, their fields and their
statuses are the schema plugin's, enforced in the write chain.

## Reads are bounded

| Read | Bound |
|---|---|
| `get(ids)` | the ids given, at most `LIMIT_MAX` |
| `of(type, page)` | a page |
| `links(id, {type, dir}, page)` | a page |
| `since(page)` | a page of committed change sets |
| `now()` | a cursor |

A page is at most `LIMIT_MAX` (500). No read returns the whole graph. A
query language, search or views are plugins built on these.

## Watch

`watch(filter, on)` calls `on` with every committed change set that
touches the filter, in commit order, once it is applied. With `after` it
catches up from that cursor first, so a watcher that drops can resume
without missing anything. It returns the disposer that stops it. This is
what makes the harness view live.

## The write chain

```
action ──▶ stage ──▶ stage ──▶ … ──▶ store
           (in config-tree order of their plugins)
```

A change enters through the action plugin and nowhere else. Every stage is
the same shape, `(change, next) => Promise<Committed>`, and what it does
depends on which side of `next` it works:

- **Before `next`**, a stage checks and may refuse by throwing `Refused`.
  The schema plugin works here. Refusing is a rule saying no, not a person
  being asked: there are no holds.
- **After `next`**, a stage sees what was applied. History calls `next`
  and journals the committed set it gets back, so it never records a
  change that failed, wherever it sits in the chain.
- No stage rewrites facts. If a stage wants a different change, it refuses
  and says what would pass, and the caller sends that.
- Stages chain in the config-tree order of their plugins, the first
  outermost. There are no ranks: to reorder, move the entry.
- A stage is added with `stage(fn)` as the calling plugin's, and goes when
  the plugin unloads.

The store applies the set atomically: all facts or none. A retraction whose
value isn't the field's current value fails the whole set with
`graph.conflict`.

## Who may commit

`graph.commit` is a capability like the others, so who holds it is the
orchestrator's choice, not a convention: it is given to the action plugin
alone, and every other change reaches the graph through `action.invoke`.
There is no sandbox, so a plugin that reached past its context could still
write; that breaks the contract the same way ignoring its types would.
