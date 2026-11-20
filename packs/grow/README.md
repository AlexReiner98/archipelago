# grow

A miss nothing covers proposes a trial node: the first step of the
learning loop. Injects `exchange.read`, `agent.tree`, `agent.node` and
`action.register`.

| Step | How |
|---|---|
| Detect | At `reply_end`, the run's misses ([miss.ts](miss.ts)): a refusal, or an act with `ok: false`, standing at its place and at the files its input names (relative to the run's folder). A miss is covered when a node loaded now listens at one of its places. |
| Ask | The node `grow/ask` refuses at `reply_end` with the code `ask`, so the agent keeps going and hears the question; in Claude Code a say at `reply_end` reaches no one. The first line names the misses' seqs (`#12`), and the next ask reads them back from the exchange: each miss is asked about once, across restarts. |
| Write | The action `grow.trial` (`place`, `misses`, `words`, optional `seq`, `run`, `title`): through `words.add`, a node item with `status: trial`, `at` one exact place (no `*`; with `seq`, one of that miss's places), the words of the miss it should prevent (`misses`) and where it came from (`from_run`, `from_seq`). From Claude Code, the agent calls it with the adapter's MCP tool `act`. |
| Say | The words pack says a trial node marked as one (`TRIAL_MARK`), at its place only. |
| Show | The harness view marks trial nodes in the tree; the node pane shows the miss, edits the words (`words.set`) and retires it (`words.retire`). |

An asking refusal is not a miss: the verdict pack skips a refusal with the
code `ask` and the act it denies (the held-back reply), so a `reply_end`
node isn't judged failed by a question.

Not here yet: promoting or retiring a trial by its record.
