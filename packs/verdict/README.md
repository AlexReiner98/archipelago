# verdict

Whether each node worked, per run, judged from the [exchange](../../spec/exchange.md).
Injects `exchange.read`, `exchange.watch` and `agent.tree`; provides its own
`verdict.read`, the live read the harness view calls.

## The verdict

Per run, a node is judged from the first time it was said (or refused) there:

| Verdict | When |
|---|---|
| **failed** | one of its misses came after |
| **held** | a miss came before, and none after; or it refused, and nothing went wrong after |
| **quiet** | no miss and no refusal in the run: nothing to judge |

A node's **miss** is something going wrong where it listens: a refusal by
another node, or an act with `ok: false`, at a place matching one of the
node's `at`. An act also stands at the files its input names (`file_path`,
`path`, `notebook_path`), so a node said at `file:packs/*/page/*.js` is
failed by a failed edit of such a file. Paths are made relative to the
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
(how often it was said at each). The reflex record without its growth loop:
promoting and retiring nodes comes later.

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
