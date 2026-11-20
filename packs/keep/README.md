# keep

The learning loop's second half. The [grow](../grow/README.md) pack writes
trial nodes from misses; this pack promotes or retires them by their record,
and keeps a node that can't be trusted from ever reaching a run.

## Standing

A trial node's record is the [verdict](../verdict/README.md) pack's, without
the run it was written in. Its miss came first there only because the node
was written for it. From that record ([rule.ts](rule.ts)):

| Standing | When (defaults) |
|---|---|
| **promote** (`held`) | it held in 3 runs, failing in at most a third as many |
| **retire** (`failing`) | its miss came again after it was said, in 2 runs, more than it held |
| **retire** (`idle`) | said in 12 runs and nothing it is about came up: neither held nor failed. This catches stale nodes and advice too generic to matter |
| **retire** (`duplicate`) | another node at its place, kept or written before it, shares 60% of its words |
| trial | none of these yet: the standing says how far each is |

A node holds when a miss came before it was said and none after, or when
its miss's situation came up again after it was said and went right: a call
at its place answered with one of its miss's phrases (16 characters or
more, word for word) and worked. This is the verdict pack's `near`.

The thresholds are the pack's config (`promote`, `fail`, `idle`, `same`), so
the person changes them in the config tree. `apply: false` shows the
standing and changes nothing.

## Apply

There is no human gate. When a standing says promote or retire, the pack
applies it through `keep.apply`. That calls `words.promote` or
`words.retire`, and writes `decided` (state, rule, why, by, at, the node,
the record) in the same change set, so `history.undo` takes both back. After
an undo, the pack doesn't decide that node again until its record has a new
run. It decides only trial nodes. To keep one or retire it by hand, a person
uses the same action, from the harness view.

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
| `keep.review` `{ node? }` | Each trial node's record, standing and checks, with the nodes decided. Writes nothing |
| `keep.apply` `{ node, state, rule?, why? }` | `promote` or `retire`, with `decided` |

The harness view ([keep.ts](../harness/keep.ts)) shows the standing in the
tree (trial, promote, retire, held back) and the kept and retired nodes in
the tree's last group. In the node pane it shows the record against the
thresholds, why, the gate's checks, and Keep and Retire.

Injects `verdict.read`, `agent.tree`, `agent.gate`, `graph.read`,
`graph.watch`, `graph.stage`, `action.register`, `action.invoke` and
`action.list`. Node only.
