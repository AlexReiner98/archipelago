# claim

Agents working on one repository at once, in one folder or in worktrees of
it, agree on a shared plan, and the map keeps it and holds them to it: who
works on what, which files each holds for it, who waited for whom and what
each built on. Without it, two agents that both change one file find out
at merge time, or never; with it, the second is turned away at its first
write, told who holds the file and why, and waits for it, then builds on the
first agent's work.

```
agent A ─ claim.take {files, intent} ─▶ intent "rename greet" (doing) ─part_of─▶ plan "Shared plan: owner/repo"
agent B ─ Edit src/greet.js ─▶ file: ── held by A? ─▶ refused, naming A, its intent and its branch
agent B ─ claim.take {…, wait_s} ─ waits ─ A ends ─▶ intent "add farewell" ─depends_on─▶ "rename greet"
                                                     └▶ "run git merge rename first"
```

| File | Runs | What it is |
|---|---|---|
| [plan.ts](plan.ts) | both | The plan as plain data: holds, intents, plans, rounds, paths, the words an agent hears |
| [index.ts](index.ts) | server | The flavours `plan` and `intent`, two nodes, three actions, `claim.read`. Injects `agent.node`, `action.register`, `action.invoke`, `exchange.watch`, `graph.read`, `graph.watch`, `types.define` |
| [view.ts](view.ts) | page | The page key `claim.plan` and the view **Shared plan** (below). Injects `claim.read`, `here.*`, `slot.fill` |

## On the map

| Type | Is | Fields |
|---|---|---|
| `plan` | a flavour of `work`, one per repository (or folder) | `scope`: `repo:host/owner/name`, or the folder |
| `intent` | a flavour of `work`, one per claim, `part_of` its plan | `run`, `agent`, `files`, `scope`, `branch`, `folder`, `since`, `ended`, `asked` (when it waited first) |

An intent is `doing` while its run holds its files, `done` when the run's
turn ended (or the run, or it let go after writing there), and `dropped`
when it let go without writing. An intent that waited for another `depends_on` it: it was built on
that one. Both flavours ship kept (`trial: false`).

The map is the truth. The holds the nodes check are the open intents,
followed through `graph.watch`, so an intent closed on the map by anyone
(a person's `items.set`, an undo) lets its files go at once. A hold taken on
a file's first write is not a claim: it stays off the map and goes with its
run.

## Nodes

| Node | At | Does |
|---|---|---|
| `claim/plan` | `session_start`, `prompt` | When another agent is live on the same repository: how to claim (once), and what the others hold, with their branches. Alone, it says nothing |
| `claim/turn` | `reply_end` | Says nothing: as a run's reply ends, it lets go of what it holds, its intents done |
| `claim/held` | `file:**` | A write (`Edit`, `Write`, `MultiEdit`, `NotebookEdit`) to a file another live run holds is refused (`claim.held`), naming the holder and its intent, and its branch to merge when it works in another checkout. A read of one is told. A write to a file nobody holds holds it for the writer. A run that started first hears how to claim here, once, when a second agent starts beside it |

A refusal is a miss like any other on the exchange: the sensory interface
shows it on the run that was turned away.

## Actions

| Action | Input | Does |
|---|---|---|
| `claim.take` | `files` (≤ 50; a folder ends in `/`), `intent`, `wait_s?` (≤ 25) | Puts an intent on the plan (the run's open intent with the same words grows instead). When another run holds any of the files: with `wait_s`, waits that long for them, queued, then claims and `depends_on` what it waited for, answering `merge: [branch]` when that was in another checkout; else, or still held, refused, writing nothing |
| `claim.drop` | `files?` | Lets go of those, or of all; an intent left with no files is done or dropped |
| `claim.release` | `run` | Marks a run's open intents done. The plugin calls it when a run's reply ends, or the run ends or goes quiet; a run may call it for itself only |

An agent calls them through the MCP `act` tool. Only a call from a run can
claim.

Waiting matters. A refusal with no way to wait turns a collision into lost
work: in the first live trial the turned-away agent reverted its half-done
rename and stopped. The refusal says how to wait, and one call waits at most
25 seconds, under a harness's tool call timeout; the agent calls again while
the file is still held.

## Worktrees

Two agents in two worktrees of one repository, each on its own branch,
never see each other's edits: they collide at merge, as a text conflict or
as code that merges cleanly and breaks. Holds are kept per repository (the
`remote` fact), so the second agent is still turned away at its first
write. The plugin reads each run's branch from its folder, and when the
holder works in another checkout the refusal and `claim.take` say to merge
its branch once it lets go, so the second agent builds on the first one's
work instead of beside it. An agent in a worktree should commit when it is
done, or there is nothing to merge.

Measured on 27 Nov 2026 with two Sonnet agents, one renaming `greet` to
`hello` and one adding a `farewell` that calls the greeting, each in its own
worktree, both branches then merged. Without the plugin, 0 of 3 trials
merged (a conflict in the app file each time, and each farewell still
called the old name). With it, 3 of 3 landed: one agent waited, merged the
other's branch and built on it. It cost more: about 80 s instead of 40 s,
and $0.39 instead of $0.29 for the pair. In one folder there was no gain:
both landed in 3 of 3 either way, since Claude Code already refuses an
edit to a file changed since it was read.

## The view: Shared plan

A fill in center, so a view of its own in the list. One plan at a time (a
tab per repository when there are more), and one round of it: a stretch
when agents worked on it together, its intents overlapping or less than two
minutes apart (a tab per round, the latest first).

- **Lanes on a time line**, one per agent, in its run colour, named by its
  branch (its words under it); a filled dot while it is live. A click opens the run in the
  Sensory interface.
- **An intent is a bar** from its claim to its end: solid while held, faint
  once done, dashed and struck through when dropped. Its files are under
  its words; a click opens its item.
- **A wait** pulses in its lane until it is let in, and stays as a dotted
  lead-in to the intent it became.
- **Built on**: a dashed curve from the end of the intent a wait was for to
  the start of the one built on it.
- **✕** where a write was turned away, with who held the file.
- A **legend** under the time line says what each mark means.
- **What happened**: the round in words, in order: who claimed what and
  why, which write was turned away and who held it, who waited for whom,
  who finished, and who got the files and built on whose work (told to
  `git merge` its branch first). A new line flashes as it comes in.
- Under it, **Held now**, file by file (● claimed, ○ held on its first
  write, ◌ waiting).

The page key `claim.plan` holds the same data for any other look or query.

A replay ([replay](../replay/README.md)) plays a past run again to judge a
trial node: it is not an agent working now, so the nodes leave it alone.

## How long a hold lasts

A turn: it goes when the run's reply ends (`reply_end`), when the run ends
or has been quiet for `quiet_min` minutes (15, as a session counts as live),
or when the run drops it. The intent stays on the map, done or dropped, as
the plan's record, and a next turn claims again.

A turn, not a session: a session in the desktop app stays open for hours,
and a hold for its life would turn every other agent on the repository away
from each file it ever wrote, and leave a waiting agent waiting for a
session to close. A turn is when an agent is changing files. Across
worktrees one gap stays: a holder that has not committed by the end of its
turn leaves nothing for the waiting agent to merge, no worse than without
claims.

## Config

| Key | Default | |
|---|---|---|
| `by` | `repo` | What two runs share: their repository (the `remote` fact), so worktrees and clones of one repository share one plan; a run with no remote shares its folder. `folder`: only the folder |
| `quiet_min` | 15 | Minutes quiet before a run's holds go |

## What it does not catch

A file written by a shell command (`Bash`) reaches no `file:` place, so it
is neither held nor turned away. Two agents that change the meaning of
something both use, in different files, are not stopped; the plan they both
hear is what helps there.

Tests: [test/claim.test.ts](../../test/claim.test.ts): the same two agents
played with the plugin and without it, the plan on the map, two real
worktrees, and the holds following the map.
