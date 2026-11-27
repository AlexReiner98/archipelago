# since

"Since you last heard": one node, `since/heard`, at `prompt` and before
each tool call (`tool:*`). At each, it tells the agent, briefly, what a
person did on the map since the run last heard: the change sets whose actor
is a person and that weren't made in the run itself, one line each (what was
done, to which items by title, and the reason given), the last 8 at most,
with a count of any before them; and the calls to a model a person asked
that failed (below). When there is nothing, it is quiet. So a working agent
hears what a person does on the page at its next step, and an idle one at
its next prompt: the map can't wake an agent that is waiting.

## A person's failed calls

A call ([call](../call/README.md)) whose reply at `reply_end` failed, and
whose run's facts say a person asked it (`asked_kind: person`, as
the explain plugin in archipelago-apps records), is told under a heading of its own ("Since you
last heard, a call to a model a person asked failed:", apart from the
changes, since a failure is not one), a line with the call's title, its
model, what failed and where its replies are (`act typed.get { "run": … }`, when the typed plugin is loaded), so the
agent can suggest a fix. It is told to the run it was made under (its
`parent`: the session the person picked on the page), or to every run when
it was made under none (a plugin's own run of calls); never to another
agent's. A call an agent made itself is not told: its refusal came back in
its own tool result. Failures are kept in the order they came, and each run
is told each one once.

Injects `graph.read`, `graph.watch`, `exchange.read`, `exchange.watch` and `agent.node`. A person's change sets
are read back with `graph.since` when the plugin loads and followed with
`graph.watch` after that, at most `keep` (200) of them held. When the run's
last prompt isn't known here (the plugin reloaded), it counts from the run's
start.

| Config | Default | |
|---|---|---|
| `keep` | 200 | A person's change sets held to tell |
| `lines` | 8 | Lines said at most; the rest are counted |

The node is a reflex like any other: the context interface shows it, and the
verdicts judge it.

Its wording is on the map: a `node` item whose `voice` is `since/heard`,
made through `words.voice` the first time (the words plugin says nothing for
it). `{changes}` marks where the lines go; `words.set` rewords the rest.
