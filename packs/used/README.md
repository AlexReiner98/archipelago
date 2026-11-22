# used

Which tools and MCP servers Claude Code gave its runs, and which they
used, across runs: about half of what an agent is given is tool
definitions, and one tool can be 37k letters. Shown on a given node's pane
in the Sensory interface ([harness](../harness/README.md)): "used in 3 of
40 runs · 36k letters", and on the tree as a hollow orange dot when no run
used it.

- **Given**: a run's `tool:<name>` and `mcp:<server>` nodes from
  `transcript.given` ([transcript](../transcript/README.md)), with their
  size. A tool a run called counts as given to it.
- **Used**: the run's tool acts on the exchange (`act`, kind `tool`, at
  `tool:<name>`). A server is used in a run when one of its tools is
  (`mcp__<server>__<tool>`).
- **Size**: in the newest run given it. A server's is its tools' and its
  instructions' together.
- **Which runs**: the newest 50 (`WINDOW`) that have a transcript, read a
  page at a time (`LIMIT_MAX`). An ended run read to its end is kept in
  memory and not read again; a live one at most every few seconds, its
  events from where it left off. Nothing is written.

## Action

| Action | Input | Answers |
|---|---|---|
| `used.tools` | `names?` (at most `LIMIT_MAX`), `profile?` (only its runs), `after?`, `limit?` | `runs` counted, `window`, `tools` (`name`, `given`, `used`, `size`) by name, `next`, `reading` while a transcript is still being read |

The rules are in [tally.ts](tally.ts). Injects `exchange.read`,
`profile.read` and `action.register`; calls `transcript.given` from inside
its action. Tested in `test/used.test.ts`.
