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
| `words.say` `{ node, say }` | How it is said at `session_start`: `whole` (the default) or `listed`, one line |
| `words.retire` `{ node }` | Retires a node: `status: retired`, no longer said |
| `words.promote` `{ node }` | Keeps a trial or retired node: its `status` goes, and it is said as kept |
| `words.voice` `{ voice, title, kind?, at, words }` | The wording item of a code-made node (`voice`: its id, such as `grow/ask`): made the first time, found after. This pack doesn't say it; that node does, with `{name}` filled in, and `words.set` rewords it |

A node item with `repeat: "every"` is said each time its place is reached;
otherwise its same words are said once per context (spec edition 4).

## Listed, whole at its place

A node item with `say: "listed"` is said at `session_start` as one line:
its title, the other places where its whole words are said, and its id for
the words tool. At its other places it says its whole words. Without
`say`, it says them whole everywhere, as before.

The pack `words-tool` ([tool.ts](tool.ts)) serves the MCP tool `words` on
the adapter's server (`mcp.host`): `node` (an id or a title) gives that
node's whole words; no input, the listed nodes one line each. Injects
`mcp.host`, `words.heard` and `graph.read`.

## Told what changed

The pack remembers, per run since its last `compact`, what each of its
nodes said to it (its whole words, or its line) and what the words tool
handed it (`words.heard`, a pack-own key it provides). One more node,
`words/changed` ("Changed since heard", at `prompt` and `compact`), tells
a run at its next prompt what changed in the nodes it heard, one line
each: a rewording with the new words, a retired (or emptied, or gone) node
as no longer applying. A node told that way doesn't say the same new words
again at its place in that context. Reached at its place before the
prompt, a reworded node says its new words itself, and the agent pack
records that say `reworded`. At most 200 runs are held.

A node whose item has `held` (a reason) is held as written: `words.set`,
`words.title` and `words.retire` refuse it, with the reason (`words.held`). The
[written](../written/README.md) pack sets it for the files the map writes.

`config.seed` lists nodes made through `words.add` when the graph has none.
Injects `graph.read`, `graph.watch`, `agent.node`, `action.register`,
`action.invoke`.
