# transcript

What Claude Code's transcript shows an agent was given, beside what the
map said: read-only nodes, each at a place, marked by who said it. The
sensory interface hangs them into each agent's tree
([harness](../harness/README.md)). Injects `exchange.read`,
`exchange.watch` and `action.register`.

| Node | Place | By |
|---|---|---|
| System prompt (`system`) | `session_start` | Claude Code |
| A tool's definition (`tool:<name>`): its description and input | `tool:<name>` | Claude Code, or the MCP server for `mcp__<server>__…` |
| A server's MCP instructions (`mcp:<server>`) | `tool:mcp__<server>__*` | the server |
| Skill listing (`skills`) | `skill:*` | Claude Code |
| Agent listing (`agents`) | `tool:Agent` | Claude Code |
| Deferred tools (`deferred`) | `tool:ToolSearch` | Claude Code |
| Model (`model`) | `session_start` | Claude Code |
| Another hook's context (`hook:<place>:<who>`) | the hook's: `session_start`, `prompt`, `tool:<name>`, `tool_result:<name>`, `reply_end`, `compact` | the plugin, else the hook's script, never a path |

- **Where.** A run's `transcript` fact, which the Claude Code adapter adds
  from the hook's `transcript_path` ([claude-code](../claude-code/README.md)),
  read from the run's `begin` events.
- **Reading** ([read.ts](read.ts)). A page at a time from a byte cursor
  kept per run (256 kB, a long line up to 16 MB, longer ones skipped), so
  each call reads only what was added, and at most 64 pages. A record of a
  kind it doesn't know, or a line that isn't JSON, is skipped. The latest
  request shape wins: a tool gone from it is gone.
- **Nothing kept.** Nothing goes in the graph. The index, in memory, holds
  names, places, counts and where each text is in the file; the text is
  read again from the file when asked for, with email addresses taken out.
  The session's own context (`session_context`, `environment`, the
  account) is never indexed, and neither are prompts, replies and tool
  results: those are acts, in the run pane.
- **The map's own words** are left out: a hook context printed by
  Archipelago's adapter, or holding what the map said in the run (its `say`
  events), is already in the tree as the map's nodes.

- **Token use and compactions** (`TokenIndex`). Each of the model's
  messages' `message.usage` (input, cache read, cache write and output
  tokens, and its model), once per message however many records it was
  streamed in, and each `compact_boundary` with its `compactMetadata`
  (trigger, tokens before and after, dropped so far), in the order they
  were written, each with its place `n` and its time. Real tokens,
  numbers only. A side chain (a subagent's) is not the run's window and is
  left out. The [context](../context/README.md) pack reads them.

## Actions

All three read; they write nothing.

| Action | Input | Answers |
|---|---|---|
| `transcript.given` | `run`, `after?`, `limit?` | a page of nodes by name (`name`, `title`, `by`, `at`, `count`, `size`, `first` and `last`: when it was first and last given), `next`, `reading` while the file is still being read, `none` when the run has no transcript |
| `transcript.tokens` | `run`, `kind?` (`usage` or `compact`), `until?` (a time), `after?` (a row's `n`), `limit?` | a page of rows in order (`usage`: `input`, `cacheRead`, `cacheWrite`, `output`, `model`; `compact`: `trigger`, `pre`, `post`, `dropped`; each with `n` and `time`), `next`, `last` (the latest usage up to `until`), `compactions` (how many by then), `reading`, `none` |
| `transcript.text` | `run`, `name` | the node's text (each distinct text, latest last), `cut` past 200,000 letters |

The transcript's format is Claude Code's own, undocumented and internal to
its version: when it changes, nodes go missing, nothing breaks. Tested in
`test/transcript.test.ts`.
