# grow

A miss nothing covers proposes a trial node: the first step of the
learning loop. Injects `exchange.read`, `agent.tree`, `agent.node`,
`action.register` and `graph.read`.

| Step | How |
|---|---|
| Detect | At `reply_end`, the run's misses ([miss.ts](miss.ts)): a refusal, or an act with `ok: false`, standing at its place and at the files its input names (relative to the run's folder). A miss is covered when a node loaded now covers it (below). |
| Ask | The node `grow/ask` refuses at `reply_end` with the code `ask`, so the agent keeps going and hears the question; in Claude Code a say at `reply_end` reaches no one. The first line names the misses' seqs (`#12`), and the next ask reads them back from the exchange: each miss is asked about once, across restarts. |
| Write | The action `grow.trial` (`place`, `misses`, `words`, optional `seq`, `run`, `title`): through `words.add`, a node item with `status: trial`, `at` one exact place (no `*`; with `seq`, one of that miss's places), the words of the miss it should prevent (`misses`) and where it came from (`from_run`, `from_seq`). The agent calls it with the [mcp](../mcp/README.md) pack's tool `act`. |
| Say | The words pack says a trial node marked as one (`TRIAL_MARK`), at its place only. |
| Show | The Agents view marks trial nodes in the tree; the node pane shows the miss, edits the words (`words.set`) and retires it (`words.retire`). |

A node **covers** a miss when it would plausibly have prevented it: it
listens at one of the miss's places, and either as narrowly as the miss
allows (a `file:` pattern matching the miss's file; `file:**` names every
file and doesn't count), or its `misses` name the miss's words (at least
half of its own words, leaving out common ones like *error* or *failed*,
are in the miss's). A broad place alone covers nothing: a node at
`tool:Bash` without such words isn't every failed Bash call's. A node's
`misses` are the field of the map item it was made from (its `source`), as
`grow.trial` writes it. The grow and verdict packs decide coverage the same
way (`covers`, in both, kept in step by a test).

An asking refusal is not a miss: the verdict pack skips a refusal with the
code `ask` and the act it denies (the held-back reply), so a `reply_end`
node isn't judged failed by a question.

The [keep](../keep/README.md) pack promotes or retires a trial by its record.

The question's wording is on the map: a `node` item whose `voice` is
`grow/ask`, made through `words.voice` the first time. The code fills in
`{count}`, `{seqs}`, `{each}` and `{list}`; `words.set` rewords the rest. The
seqs always land on the first line, where the next ask reads them back.
