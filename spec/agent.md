# agent (draft)

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

## Places

A place is a moment in a run where the map can speak. **Draft vocabulary,
open as a question to Alex:**

| Place | Reached when | Can refuse |
|---|---|---|
| `session_start` | the run begins | no |
| `prompt` | a person's message reaches the agent | yes |
| `tool:<name>` | the agent is about to call a tool | yes |
| `file:<path>` | a tool is about to touch that file (with its `tool:`) | yes |
| `skill:<name>` | a skill is loaded | no |
| `memory:<scope>` | memory of that scope is loaded (`project`, `user`, …) | no |
| `reply_end` | the agent is about to finish its reply | yes (it keeps going) |

A reached place is concrete; a node's `at` may use `*` in the argument
(`tool:*`, `file:packs/*/page/*.js`). The adapter decides which places it can
reach (the Claude Code adapter maps them to its hooks); the vocabulary says
what each one means, so a node written for one adapter works under another.
The vocabulary is open: an edition can add a place, and a node may listen at
a place no adapter reaches yet. It stays quiet, and the tree shows it as not
reachable from the run's adapter (`RunStart.reaches`). A node that reads the
map has its pack inject `graph.read`; `speak` is handed nothing but the
moment and the run.

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
