# words

Agent nodes whose words are on the map. Each graph item of type `node`
(`title`, `kind`, `at`, `words`, `refuse`, `when`) is registered as a node
with the item as its `source`. Its words are read from the graph at every
say, so an edit takes effect the next time it speaks. A node with `when` (a
reflex's condition) speaks only when the moment's input holds that text.

| Action | Does |
|---|---|
| `words.set` `{ node, words }` | Changes what a node says |
| `words.title` `{ node, title }` | Renames a node. `node` is not a type the items pack edits, so `items.set` can't |
| `words.add` `{ title, kind, at, words, refuse?, when? }` | Adds a node |
| `words.retire` `{ node }` | Retires a node: `status: retired`, no longer said |
| `words.promote` `{ node }` | Keeps a trial or retired node: its `status` goes, and it is said as kept |
| `words.voice` `{ voice, title, kind?, at, words }` | The wording item of a code-made node (`voice`: its id, such as `grow/ask`): made the first time, found after. This pack doesn't say it; that node does, with `{name}` filled in, and `words.set` rewords it |

A node item with `repeat: "every"` is said each time its place is reached;
otherwise its same words are said once per context (spec edition 4).

A node whose item has `held` (a reason) is held as written: `words.set`,
`words.title` and `words.retire` refuse it, with the reason (`words.held`). The
[written](../written/README.md) pack sets it for the files the map writes.

`config.seed` lists nodes made through `words.add` when the graph has none.
Injects `graph.read`, `graph.watch`, `agent.node`, `action.register`,
`action.invoke`.
