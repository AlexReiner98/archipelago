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
| Your prompts (`talk:prompt`) | `prompt` | you |
| Claude's replies and thinking (`talk:reply`, `talk:thinking`) | `reply_end` | Claude |
| A tool's calls (`talk:call:<tool>`) | `tool:<tool>` | Claude |
| A tool's results (`talk:result:<tool>`) | `tool_result:<tool>` | Claude Code, or the MCP server |
| A compaction's summary (`talk:summary`) | `compact` | Claude Code |
| Claude Code's notes (`talk:note:<type>`: project instructions, the date, reminders, edited files) | `prompt` (`instructions`: `session_start`) | Claude Code |
| The session's own context (`talk:note:private`) | `session_start` | Claude Code: counted by its size, its text never read |

- **Where.** A run's `transcript` fact, which the Claude Code adapter adds
  from the hook's `transcript_path` ([claude-code](../claude-code/README.md)),
  read from the run's `begin` events. On a server that can't open it (it
  ran on another machine, or `files: false`), what the session's hook sent
  stands for it (`transcript.take`): the same records, made `slim` where it
  ran, the same nodes, sizes, history and token counts, but no text. Such a
  run's nodes say so (`elsewhere`), and its text is refused
  (`transcript.elsewhere`): the words stay on the machine it ran on.
- **Records as numbers.** Every record is read through `slim`
  ([slim.ts](../claude-code/slim.ts), which the hook carries): a local
  file's lines are made slim here, a server elsewhere gets them slim. A
  hook's context is matched to its hook's run by a hash of its start; the
  map's own is left out by its command, and, from a file here, by its
  words.
- **Reading** ([read.ts](read.ts)). A page at a time from a byte cursor
  kept per run (256 kB, a long line up to 16 MB, longer ones skipped), so
  each call reads only what was added, and at most 64 pages. A record of a
  kind it doesn't know, or a line that isn't JSON, is skipped. The latest
  request shape wins: a tool gone from it is gone.
- **Nothing kept.** Nothing goes in the graph. The index, in memory, holds
  names, places, counts and where each text is in the file; the text is
  read again from the file when asked for, with email addresses taken out.
  The session's own context (`session_context`, `environment`, the
  account) is counted by its size alone, never read. A home folder in any
  text shown is said as `~`, whose it is left out.
- **The map's own words** are left out: a hook context printed by
  Archipelago's adapter, or holding what the map said in the run (its `say`
  events), is already in the tree as the map's nodes.

- **The conversation** ([talk.ts](talk.ts)). Everything after the start
  is a node too, so the window can be told apart all the way down: each
  piece of it (a prompt, a reply, a tool's call or result, a note, as the
  model was sent it: an attachment's `rendered`) keeps its time and size,
  never its text, so a node is counted as of a moment, and what came
  before the last compaction is told from what is in the window now.
  Sizes start as characters / 4, an image by its pixels (width × height /
  750, once scaled to fit). Then they are **fitted** to the model's real
  counts: a message's thinking (the transcript keeps only its signature)
  is its real `output_tokens` less its reply and calls; what reached the
  model between two of its messages is scaled to the window's real growth
  between them (the next input less the last input and output, given
  words counted in the sum), within a factor of four; and what is there
  from the start (system prompt, tools, MCP instructions, model) to the
  first message's real input, less what else reached it, within 0.5 to 3.
  Each node says how many of its tokens are fitted (`fitted`); the rest,
  hooks' words and replies and calls among them, are estimates.
- **Token use and compactions** ([tokens.ts](tokens.ts)). Each of the model's
  messages' `message.usage` (input, cache read, cache write and output
  tokens, and its model), once per message however many records it was
  streamed in, and each `compact_boundary` with its `compactMetadata`
  (trigger, tokens before and after, dropped so far), in the order they
  were written, each with its place `n` and its time. Real tokens,
  numbers only. A side chain (a subagent's) is not the run's window and is
  left out. The [context](../context/README.md) pack reads them.

## Actions

They write nothing in the graph.

| Action | Input | Answers |
|---|---|---|
| `transcript.given` | `run`, `until?` (a time: the nodes as they were then), `after?`, `limit?` | a page of nodes by name (`name`, `title`, `by`, `at`, `count`, `size`, `first` and `last`: when it was first and last given; `tokens` and `fitted` for what is there from the start and the conversation; the conversation's also `window` and `fittedWindow`, those after the last compaction), `next`, `reading` while the file is still being read, `none` when the run has no transcript |
| `transcript.pieces` | `run`, `name`, `after?` (how many the pages before held), `limit?` | a page of one node's pieces in order (`n`, `time`, `tokens`, `fit`), `stays` (`start`: each request carries its latest; `listed`; `said`: until a compaction), `count`, `next` |
| `transcript.tokens` | `run`, `kind?` (`usage` or `compact`), `until?` (a time), `after?` (a row's `n`), `limit?` | a page of rows in order (`usage`: `input`, `cacheRead`, `cacheWrite`, `output`, `model`; `compact`: `trigger`, `pre`, `post`, `dropped`; each with `n` and `time`), `next`, `last` (the latest usage up to `until`), `compactions` (how many by then), `reading`, `none` |
| `transcript.take` | `run`, `from`, `to` (byte places), `lines` (each `[offset, length, record as numbers]`, at most 20,000), `size?`, `skipped?` | `at`: where the run's next page starts. Kept in memory: a page past `at` is left (one before it was lost), one from 0 begins the run again |
| `transcript.text` | `run`, `name` | the node's text (each distinct text, latest last), `cut` past 200,000 letters |

| Setting | Default | |
|---|---|---|
| `files` | true | Whether a run's transcript is opened on this server's disk. A server elsewhere sets false: it reads only what the hooks send |

The transcript's format is Claude Code's own, undocumented and internal to
its version: when it changes, nodes go missing, nothing breaks. Tested in
`test/transcript.test.ts`.
