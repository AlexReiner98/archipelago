# context

What is in a run's window at a moment: its parts by source and channel,
each with a size and a state, and the total in tokens against the window's
limit. The context interface shows it as the window bar under the agent in
focus, and as marks on its tree ([harness](../harness/README.md)). Injects
`exchange.read`, `agent.tree`, `action.list`, `action.invoke` and
`action.register`.

| Source | Its parts |
|---|---|
| `map` | each node the map said (or refused with) in the run; a skill of the map's never loaded |
| `harness` | each node Claude Code gave ([transcript](../transcript/README.md)): system prompt, tool definitions, MCP instructions, listings, the model, other hooks' words |
| `subject` | a [call](../call/README.md)'s own context, from the pack that made the call: one part per type (`subject:<type>`), its tokens as the call gave them, never its text |
| `agent` | the conversation since the start (the transcript pack's `talk:*` nodes: prompts, replies, thinking, each tool's calls and results, notes); without a transcript, the agent's acts by place |

Each part's channel is how it reaches the agent, as the tree shapes its
dot ([channels.ts](../harness/channels.ts)): `hook`, `rule`, `file`,
`context`, `talk` (the conversation); the agent's acts, without a
transcript, are `act`.

| State | Means |
|---|---|
| `start` | given at the start, and with every request since: the system prompt, tool definitions, MCP instructions, the model |
| `said` | said, or done, since the last compaction: in the window now |
| `listed` | only named in a listing (skills, agents, deferred tools): the thing itself loads when it is used |
| `dropped` | said before the last compaction, and not said again since: gone |

- **Sizes.** A part's size is characters / 4 (a say's words, an act's input
  and output, a given node's text), or the transcript pack's tokens where
  it knows better: the start and the conversation, fitted to the model's
  real counts. Each part says how many of its tokens are `fitted`, and so
  do the shares (`fitted.sources`, `fitted.channels`): the rest are
  estimates. The **total** is the model's own count
  when the transcript has it (`total.from: "usage"`): the latest message's
  input, cache read, cache write and output tokens by then, or what the
  last compaction left if it came after; else the parts summed
  (`"estimate"`). `unseen` is the real total over what the parts account
  for.
- **A call.** A call's answer may carry the model's own count (`usage`):
  with no transcript, that is the total (`from: "usage"`). Its subject is
  counted by its tokens, apart from the answer's size.
- **The limit.** 1,000,000 for a model named with `[1m]` or of the Claude 5
  family (`limit.from: "model"`), or once more than 200,000 was seen in the
  run (`"seen"`); else 200,000 (`"default"`).
- **Compactions.** The transcript's `compact_boundary` records
  (`transcript.tokens`); without a transcript, the run's own `compact`
  events.
- **Nothing kept.** Nothing goes in the graph. In memory, per run: each
  event's kind, node, place, time and size, never its text, read a page at
  a time so each call reads only what was added.

## Actions

| Action | Input | Answers |
|---|---|---|
| `context.window` | `run`, `at?` (an event's id; absent, the run's end), `after?` (how many parts the pages before held), `limit?` | `total` {tokens, from}, `limit` {tokens, from}, `model`, `compactions`, `compacted` (the last one's time, trigger, tokens before and after), `sources` and `channels` (tokens in the window), `fitted` (of those, fitted to the model's real counts), `unseen`, a page of `parts` biggest first (`id`: the tree's, `title`, `source`, `channel`, `state`, `tokens`, `count`, `fitted`), `next` |
| `context.node` | `run`, `id` (a tree node's: the map's, or `transcript/<run>#<name>`), `at?`, `after?`, `limit?` (30) | one node's share of the window over the run ([trend.ts](trend.ts)): `stays` (start: its latest size from the first time, through compactions; listed; said: every piece since the last compaction), `now` and `nowFitted` (at `at`), `peak`, `total` put in, `dropped` by compactions, `count` and `inWindow` pieces, `points` (at most 120, each the value at the end of a stretch of time and its `peak`), `compactions` (their times), a page of `pieces` latest first (`n`, `time`, `tokens`, `fit`, `in`), `next` |

They read; they write nothing. Tested in `test/context.test.ts`.
