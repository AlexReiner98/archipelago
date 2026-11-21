# verdict

Whether each node worked, per run, judged from the [exchange](../../spec/exchange.md).
Injects `exchange.read`, `exchange.watch`, `agent.tree`, and `graph.read`
and `graph.watch` for each node's `misses`; provides its own
`verdict.read`, the live read the sensory interface calls.

## The verdict

Per run, a node is judged from the first time it was said (or refused) there:

| Verdict | When |
|---|---|
| **failed** | one of its misses came after |
| **held** | a miss came before, and none after; or it refused, and nothing went wrong after; or a near miss came after, and no miss |
| **quiet** | no miss, no refusal and no near miss in the run: nothing to judge |

A **near miss** is the miss's situation coming up again and going right: a
call at the node's place that worked, whose answer holds one of the phrases
of its `misses` (16 characters or more, word for word). Its input doesn't
count, since a search for the error names it. Neither do a few words in
common, since any JSON output has "json" in it. `near` counts them.

A node's **miss** is something going wrong that it covers: a refusal by
another node, or an act with `ok: false`. An act stands at its place and at
the files its input names (`file_path`, `path`, `notebook_path`), so a node
said at `file:packs/*/page/*.js` is failed by a failed edit of such a file.

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

 Paths are made relative to the
run's `cwd` (from its `begin`), with `/` for separators, since Claude Code
gives them absolute. A node's own refusals are its saying, and so is the
denied call a refusal causes (an act whose output names the node as
`refused`): a refusal is the node working. An exchange `miss` (a node threw) is the exchange's fault, not the
agent's, and judges nothing. Nor does a refusal with the code `ask`, nor
the act it denies: it holds the agent back to ask it something (the grow
pack's question at `reply_end`), not because anything went wrong. A node no longer in the tree is judged at the
places it was said.

Only runs where a node was said judge it.

## The record

Per node: `said`, `runs`, `held`, `failed`, `quiet`, `last`, and `places`
(how often it was said at each). The [keep](../keep/README.md) pack promotes
and retires trial nodes by it.

## `verdict.read`

- `run(run)`: a run's verdicts, in the order each node was first said.
- `records(page)`, `record(node)`: records, most recently said first.
- `verdicts(node, page)`: one node's verdicts, newest run first.
- `watch(on)`: called with `{ run }` when a run's verdicts may have
  changed, or `{}` when the tree did. Returns a disposer.

It reads the whole record back on load and follows the exchange live; a
run is judged again only when it (or the tree) changed. Verdicts aren't
written to the graph yet: no action pack exists to write them through.

Judging is in [judge.ts](judge.ts), apart from the runtime.
