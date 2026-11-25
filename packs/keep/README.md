# keep

The learning loop's second half. The [grow](../grow/README.md) pack writes
trial nodes from misses; this pack promotes or retires them by their record,
and keeps a node that can't be trusted from ever reaching a run.

## Standing

A trial node's record is the [verdict](../verdict/README.md) pack's, without
the run it was written in. Its miss came first there only because the node
was written for it. Its replayed record (runs the [replay](../replay/README.md)
pack played again with it said) is kept apart from the live one, and counts
less. From the two ([rule.ts](rule.ts)):

| Standing | When (defaults) |
|---|---|
| **promote** (`held`) | it held in 3 runs, one of them live, failing in at most a third as many |
| **retire** (`failing`) | its miss came again after it was said, in 2 live runs, more than it held |
| **retire** (`idle`) | said in 12 runs and nothing it is about came up: neither held nor failed. This catches stale nodes and advice too generic to matter |
| **retire** (`duplicate`) | another node at its place, kept or written before it, shares 60% of its words |
| trial | none of these yet: the standing says how far each is |

| A run | Counts toward held and quiet | Toward failing |
|---|---|---|
| live | 1 | 1 |
| replayed | `replay`, default 0.5 | 0 |

A replay plays the recorded agent's acts as they were: it never heard the
node, so a replay can't show the node preventing its miss, only that its
place came up and how the run went there. So it counts half a live run
toward held and quiet, a promotion still needs one live held run, and a
replayed failure (the miss came after the node would have been said)
counts toward nothing.

A node holds when a miss came before it was said and none after, or when
its miss's situation came up again after it was said and went right: a call
at its place answered with one of its miss's phrases (16 characters or
more, word for word) and worked. This is the verdict pack's `near`.

The thresholds are the pack's config (`promote`, `fail`, `idle`, `same`,
`replay`), so
the person changes them in the config tree. `apply: false` shows the
standing and changes nothing.

## Labels

A person's allow or deny is a label to check the thresholds against, never
to change them by. A `decision` act ([agent spec](../../spec/agent.md),
editions 3 and 11) after a node was said, at a place it listens or on the
reply, is that run's label (the verdict's `label`). `keep.review` counts,
per node and over all, the labels (`allow`, `deny`) and whether its verdict
there agreed (held with allow, failed with deny) or `disagree`d, and lists
under `against` the nodes whose standing goes against their labels:
promoted with a deny, retired with an allow.

## Apply

There is no human gate. When a standing says promote or retire, the pack
applies it through `keep.apply`. That calls `words.promote` or
`words.retire`, and writes `decided` (state, rule, why, by, at, the node,
the record, the replayed record) in the same change set, so `history.undo` takes both back. After
an undo, the pack doesn't decide that node again until its record has a new
run. It decides only trial nodes. To keep one or retire it by hand, a person
uses the same action, from the context interface.

## Checks

- **Gate** (`agent.gate`, `trusted`): a node is held back from every run when
  its map item is in a set the [schema](../schema/README.md) pack holds in
  quarantine (`schema.quarantined`, read every 5 s at most), doesn't fit its
  type now (`schema.check`), or its words fail their check. The words check
  fails on no words, more than 1200 characters, a person's home folder, what
  looks like a secret, or the trial mark itself. Each hold is a `gated` event
  in the run.
- **Self-edit** (a `graph.stage`): a change made in a run to a node's
  `words`, `status`, `at`, `when`, `refuse` or `misses` is refused
  (`keep.self_edit`) when that node failed in the same run: its miss came
  after it was said there. A run can't quiet its own misses by rewriting,
  promoting or retiring what it was told. Another run, or a person, can.

## Actions

| Action | Does |
|---|---|
| `keep.review` `{ node? }` | Each trial node's record, replayed record, labels, standing and checks, with the nodes decided, and the labels over all. Writes nothing |
| `keep.apply` `{ node, state, rule?, why? }` | `promote` or `retire`, with `decided` |

The Context interface ([keep.ts](../harness/keep.ts)) shows the standing in the
tree (trial, promote, retire, held back) and the kept and retired nodes in
the tree's last group. In the node pane it shows the live record against the
thresholds, the replayed one beside it, the labels, why, the gate's checks,
and Keep and Retire.

Injects `verdict.read`, `agent.tree`, `agent.gate`, `graph.read`,
`graph.watch`, `graph.stage`, `action.register`, `action.invoke` and
`action.list`. Node only.
