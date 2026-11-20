# since

"Since you last heard": one node, `since/heard`, at `prompt`. At each of a
run's prompts it tells the agent, briefly, what a person changed on the map
since the run's last prompt (or its start): the change sets whose actor is a
person and that weren't made in the run itself, one line each (what was
done, to which items by title, and the reason given), the last 8 at most,
with a count of any before them. When there are none, it is quiet.

Injects `graph.read`, `graph.watch` and `agent.node`. A person's change sets
are read back with `graph.since` when the pack loads and followed with
`graph.watch` after that, at most `keep` (200) of them held. When the run's
last prompt isn't known here (the pack reloaded), it counts from the run's
start.

| Config | Default | |
|---|---|---|
| `keep` | 200 | A person's change sets held to tell |
| `lines` | 8 | Lines said at most; the rest are counted |

The node is a reflex like any other: the harness view shows it, and the
verdicts judge it.

Its wording is on the map: a `node` item whose `voice` is `since/heard`,
made through `words.voice` the first time (the words pack says nothing for
it). `{changes}` marks where the lines go; `words.set` rewords the rest.
