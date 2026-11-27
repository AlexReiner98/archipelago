# verdict

Whether each node worked, per run, judged from the [exchange](../../spec/exchange.md).
Injects `exchange.read`, `exchange.watch`, `agent.tree`, and `graph.read`
and `graph.watch` for each node's `misses`; provides its own
`verdict.read`, the live read the context interface calls.

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
said at `file:plugins/*/page/*.js` is failed by a failed edit of such a file.

A node **covers** a miss when it would plausibly have prevented it: it
listens at one of the miss's places, and either as narrowly as the miss
allows (a `file:` pattern matching the miss's file; `file:**` names every
file and doesn't count), or its `misses` name the miss's words (at least
half of its own words, leaving out common ones like *error* or *failed*,
are in the miss's). A broad place alone covers nothing: a node at
`tool:Bash` without such words isn't every failed Bash call's. A node's
`misses` are the field of the map item it was made from (its `source`), as
`grow.trial` writes it. The grow and verdict plugins decide coverage the same
way (`covers`, in both, kept in step by a test).

 Paths are made relative to the
run's `cwd` (from its `begin`), with `/` for separators, since Claude Code
gives them absolute. A node's own refusals are its saying, and so is the
denied call a refusal causes (an act whose output names the node as
`refused`): a refusal is the node working. An exchange `miss` (a node threw) is the exchange's fault, not the
agent's, and judges nothing. Nor does a refusal with the code `ask`, nor
the act it denies: it holds the agent back to ask it something (the grow
plugin's question at `reply_end`), not because anything went wrong. A node no longer in the tree is judged at the
places it was said.

A person's **decision on a reply** (a `decision` act at `reply_end`, a
[call](../call/README.md)'s answer accepted or rejected) judges every node
said before it in the run, as everything said in a one-request run was said
to that reply: rejected is a miss after each (failed), accepted holds each.
Only the run's last decision counts, so a change of mind is followed. A
decision at a tool's place (Claude Code's allow or deny) is a miss as any
failed act is, where it is covered.

Only runs where a node was said judge it.

A person's last decision after a node was said, at a place it listens or
on the reply, is its verdict's **label** (`allow` or `deny`): what the
[keep](../keep/README.md) plugin checks its thresholds against.

A **replay** (a run whose `begin` has the fact `replay_of`: a recorded run
played again by the [replay](../replay/README.md) plugin) is judged the same
way, and its verdict says `replay_of`. Its record is kept apart: `record`
and `records` are live runs only, `replayed` is the replays'.

## What it holds

Per run, a digest of what judging reads (`RunDigest` in
[judge.ts](judge.ts)), never the run's events:

- its `cwd` and what it replays, from its first `begin`;
- per node said there, its sayings added up: the first one's seq and
  time, how many, whether one was a refusal, how many at each place, the
  last one's time;
- its misses (refusals, failed acts): seq, place, the paths the input
  names, who refused or whose refusal denied it, and its words, each once
  (the `wordsOf` of the first 4,000 characters of what it answered, all
  that `covers` reads of them);
- people's decisions: seq, place, paths, allowed or not;
- for acts that worked, no output at all: only the set of places they
  stood at and paths they named, and per node the seqs of its near misses,
  found as each act comes in with the node's places and phrases then.

Places, nodes and paths are kept once however often they repeat. Judging a
run again (a node's place or `misses` changed) reads only its digest. A
near miss is the one thing it can't decide from the digest, since it looks
for a phrase in what an act that worked answered: when a node's places or
phrases change, the runs it was said in where an act that worked stood at
one of its places are read back from the exchange (`exchange.read.events`,
a page at a time) and their near misses looked for again. Nothing else is
read again: a node said at `session_start` reads nothing, a node at
`tool:Bash` reads the runs it was said in. A change to the tree that
changes no node's places or `misses` judges nothing again. A run whose
`begin` came after an act naming a path is read again once, with its cwd.

Why: the exchange keeps its journal on disk and only an index of it in
memory (`FileLog`), and the log is the truth, so no plugin should hold a
copy of it. Holding every act, even slim (its start: 400 characters of
one that worked, 4,000 of one that failed), grew with the journal and
filled a hosted map's 512 MB heap on load (27 Nov 2026). On a journal
shaped like that map's (700 runs, 164,000 events, 305 MB, mostly acts with
1.5 to 2 KB outputs) loading the verdict adds about 17 MB to the heap,
where the slim copies added about 150 MB. Keeping the 400 characters of
each act that worked, to find near misses without reading back, would add
about 50 MB more.

## The record

Per node: `said`, `runs`, `held`, `failed`, `quiet`, `last`, and `places`
(how often it was said at each). The [keep](../keep/README.md) plugin promotes
and retires trial nodes by it.

## `verdict.read`

- `run(run)`: a run's verdicts, in the order each node was first said.
- `records(page)`, `record(node)`: records from live runs, most recently said first.
- `replayed(node)`: a node's record from replays, apart from the live one.
- `verdicts(node, page)`: one node's verdicts, live and replayed, newest run first.
- `watch(on)`: called with `{ run }` when a run's verdicts may have
  changed, or `{}` when the tree did. Returns a disposer.

It reads the whole record back once on load, a page at a time, and follows
the exchange live; a run is judged again only when it changed, or a node
said in it did. A read waits for judging again that is under way. Verdicts aren't
written to the graph yet: no action plugin exists to write them through.

Judging is in [judge.ts](judge.ts), apart from the runtime.
