# agent

Everything the map says to an agent and everything the agent does passes
through one service. Its registry of nodes is the harness view's tree.
Types: [agent.ts](agent.ts).

## Capabilities

| Key | Gives |
|---|---|
| `agent.node` | Add a node |
| `agent.tree` | The registry of nodes |
| `agent.run` | The adapter's side: begin, reach, act, end |

## Three verbs

| Verb | Direction | What |
|---|---|---|
| **say** | map → agent | A node gives words at a place: an instruction at session start, a trap on a file, a skill's text |
| **refuse** | map → agent | A node stops what is happening at a place: a tool call, a prompt, the end of a reply |
| **act** | agent → map | The agent did something: a tool call and its result, a reply. A person's prompt is recorded the same way, `by: person` |

An act's `kind` (`ACT_KINDS`): `tool`, `reply` and `prompt` since edition 1.
Edition 3 adds the person's side of a run:

| Kind | By | Place | What |
|---|---|---|---|
| `decision` | person | `tool:<name>` | The person allowed or denied a tool call the harness asked them about: output `allow` or `deny`, and a denial is `ok: false`, a miss like a failed call |
| `notice` | agent | `prompt` | The harness asked the person for something (a permission, input) and the run waits on them: input `{type, message}` |

## Places

A place is a moment in a run where the map can speak. The spec owns the
vocabulary (decided by Alex), and each place says the edition it came in.
Edition 1 has the six places an adapter can both reach and speak at, which
is what the harness view and verdicts need:

| Place | Reached when | Can refuse | Claude Code hook |
|---|---|---|---|
| `session_start` | the run begins, and again after a compaction | no | SessionStart |
| `prompt` | a person's message reaches the agent | yes | UserPromptSubmit |
| `tool:<name>` | the agent is about to call a tool | yes | PreToolUse |
| `file:<path>` | a tool is about to touch that file (with its `tool:`) | yes | PreToolUse, from the input |
| `tool_result:<name>` | a tool has returned (its result is the input) | no | PostToolUse |
| `reply_end` | the agent is about to finish its reply | yes (it keeps going) | Stop |

Edition 2 adds two places (Alex, 20 Nov 2026: skills and memory are
something the map writes). The map speaks there through the files the
harness loads, once it writes them; what the harness loaded is the moment's
input. Nothing can be refused there: the text is already loaded.

| Place | Reached when | Can refuse | Claude Code |
|---|---|---|---|
| `skill:<name>` | the harness loads a skill's text (`skill:<plugin>:<name>` for a plugin's) | no | the transcript, read at the next hook |
| `memory:<scope>/<path>` | the harness loads a memory file; scope `project`, `local`, `user`, `auto` or `managed`, the path with `/` and `~` for home | no | the transcript's `instructions` attachment |

Edition 3 (Alex, 20 Nov 2026: every way an agent and the map meet is
modelled) adds one place:

| Place | Reached when | Can refuse | Claude Code |
|---|---|---|---|
| `compact` | the harness is about to compact the run's context (input `{trigger}`) | no | PreCompact |

What was said before a compaction is gone from the agent's context, so a
node said again after it in the run is a **re-saying**: the agent pack
records that say with `detail.resaid: true`.

Left out on purpose: a session's end (nothing can be said to the agent
there; it's the run's `end` event). A subagent needs no place of its own:
it is a run whose `parent` is the run that started it, reaching
`session_start` as it starts and `reply_end` as it stops.

A reached place is concrete; a node's `at` may use `*` in the argument
(`tool:*`, `file:packs/*/page/*.js`). The adapter decides which places it can
reach (the Claude Code adapter maps them to its hooks); the vocabulary says
what each one means, so a node written for one adapter works under another.
The vocabulary is open: an edition can add a place, and a node may listen at
a place no adapter reaches yet. It stays quiet, and the tree shows it as not
reachable from the run's adapter (`RunStart.reaches`). A node that reads the
map has its pack inject `graph.read`; `speak` is handed nothing but the
moment and the run.

## Said once per context

Edition 4 (Alex, 20 Nov 2026). Words already in the agent's context add
nothing said again, and cost the same each time. So by default a node's
**same words** are said once per context: the agent pack holds back a say
whose node and text it already said in the run since the last `compact`.
After a compaction they are said again, marked re-said. A node whose words
must be fresh every time sets `repeat: "every"`. A refusal is never held
back, and words that differ (a node that tells what changed) are new words.
A moment with `again: true` (the agent asked to hear the place) says
everything, heard or not.

## Nodes

A node is anything said at a place: an instruction, a reflex, a rule, a
schema check, a skill, a memory, a tool's text. It has a stable id
(`pack/name`), a kind, the places it listens at, the map item it came from
if any, and `speak(moment)`, which returns words to say, a refusal, or
nothing.

- `node(def)` registers it and returns its disposer. It's a revertible
  effect: when the pack unloads, its nodes leave the tree.
- `nodes()` is the registry, and the harness view draws it as the tree.
  Nothing else holds a list of what is said to agents.

## A run

The adapter makes one child context per run, intercepted with the agent as
actor and the run's id, and calls `agent.run` from it. Every call in that
context belongs to the run without saying so.

```
begin(run) → reach({places: ["session_start"]}) → …
  reach({places: ["tool:Edit", "file:spec/agent.ts"], input}) → Answer
  act({kind: "tool", place: "tool:Edit", input, output, ok})
… → reach({places: ["reply_end"]}) → end(run)
```

At `reach`, every node listening at any of the places is asked. The answer
lists what was said in the config-tree order of the nodes' packs, and the first
refusal, if any. The adapter hands the words to the agent and, on a
refusal, stops the step and gives the agent the refusal's words.

Every say, refusal, act and failed node becomes one event on the
[exchange](exchange.md). A node that is asked and says nothing makes no
event; the verdict pack can still tell it was quiet from the registry and
the places the run reached.

A refusal from a node at a place that can't refuse isn't applied; it's
recorded as a `miss` so whoever wrote the node sees it.

## Facts

Edition 5 (Alex, 20 Nov 2026). A run carries **facts**: what is so about
it, by name (`RunInfo.facts`). They are open-ended, so whatever reads them
(a profile's match) matches on names, never on fixed fields.

| Capability | Gives |
|---|---|
| `agent.facts` | Add a fact source |

At each `begin` the agent pack makes the facts again: the start's fields
it has (`harness`, `cwd`, `parent`, `task`), then the start's own `facts`
(a subagent's `agent_type`), then each source's, in config-tree order. A
key already set is kept. A source is registered like a node, as a
revertible effect. The vocabulary is open (`FACTS` lists the ones the
spec's packs name):

| Fact | What |
|---|---|
| `harness`, `cwd`, `parent`, `task` | From the start |
| `agent_type` | A subagent's type |
| `remote`, `branch` | The git remote and branch of `cwd`. The remote is steadier than the folder, which worktrees and machines change |
| `hub` | The items the task is part of |

The `begin` event's detail is the run with its facts.

## Gates

Edition 5. A **gate** says "not this node for this run" before the node is
asked.

| Capability | Gives |
|---|---|
| `agent.gate` | Add a gate |

At each `reach`, every gate is asked about each node listening there, in
config-tree order. The first that gives a reason holds the node back: it
isn't asked, and the exchange records a `gated` event, once per run and
node, so the node is told apart from a quiet one. A **trial** hold is
only recorded (`detail.trial`): the node is still asked, so a gate can be
watched before it holds anything. Gates compose: profiles
are one ([profile](profile.md)), an experiment on what a subagent hears is
another. A gate holds nodes back; it doesn't choose which packs are loaded.
