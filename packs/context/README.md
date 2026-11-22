# context

What is in a run's window at a moment: its parts by source and channel,
each with a size and a state, and the total in tokens against the window's
limit. The sensory interface shows it as the window bar over the agent in
focus, and as marks on its tree ([harness](../harness/README.md)). Injects
`exchange.read`, `agent.tree`, `action.list`, `action.invoke` and
`action.register`.

| Source | Its parts |
|---|---|
| `map` | each node the map said (or refused with) in the run; a skill of the map's never loaded |
| `harness` | each node Claude Code gave ([transcript](../transcript/README.md)): system prompt, tool definitions, MCP instructions, listings, the model, other hooks' words |
| `agent` | what the agent did, by place: tool calls and their results, replies, a person's prompts |

Each part's channel is how it reaches the agent, as the tree shapes its
dot ([channels.ts](../harness/channels.ts)): `hook`, `rule`, `file`,
`context`; the agent's own are `act`.

| State | Means |
|---|---|
| `start` | given at the start, and with every request since: the system prompt, tool definitions, MCP instructions, the model |
| `said` | said, or done, since the last compaction: in the window now |
| `listed` | only named in a listing (skills, agents, deferred tools): the thing itself loads when it is used |
| `dropped` | said before the last compaction, and not said again since: gone |

- **Sizes.** A part's size is characters / 4 (a say's words, an act's input
  and output, a given node's text). The **total** is the model's own count
  when the transcript has it (`total.from: "usage"`): the latest message's
  input, cache read, cache write and output tokens by then, or what the
  last compaction left if it came after; else the parts summed
  (`"estimate"`). `unseen` is the real total over what the parts account
  for.
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
| `context.window` | `run`, `at?` (an event's id; absent, the run's end), `after?` (how many parts the pages before held), `limit?` | `total` {tokens, from}, `limit` {tokens, from}, `model`, `compactions`, `compacted` (the last one's time, trigger, tokens before and after), `sources` and `channels` (tokens in the window), `unseen`, a page of `parts` biggest first (`id`: the tree's, `title`, `source`, `channel`, `state`, `tokens`, `count`), `next` |

It reads; it writes nothing. Tested in `test/context.test.ts`.
