# scripted

An agent with no model. It plays a run through `agent.run`
([spec](../../spec/agent.md)) the way the [claude-code](../claude-code/README.md)
adapter would, so a test or a plugin drives a whole run and reads what was
said, refused and judged. Injects `agent.run` and `exchange.read`; provides
its own `scripted.play`. Playing is in [script.ts](script.ts), apart from
the runtime, so a test can play from any context that injects `agent.run`
with `playAs`, without loading the plugin.

## A script

A script is a run's start (title, `cwd`, …; harness `scripted` unless it
says another) and its steps. The run begins, reaches `session_start`, plays
each step, and ends (`open: true` leaves it open). Each step may give its
`time`.

| Step | Plays |
|---|---|
| `{prompt}` | reach `prompt`, then act `prompt` by the person (`ok: false` when refused) |
| `{tool, input, output, ok}` | reach `tool:<name>` and a `file:` place for each `file_path` or `notebook_path` (relative to `cwd`); on a refusal the denied call is the act (output the refusal, `ok: false`) and no result is reached; else act `tool`, then reach `tool_result:<name>` with the output |
| `{reply}` | reach `reply_end`, then act `reply`; a refusal holds it back, a denied act with the reply as input |
| `{reach, input, again}` | the places as they are, with no act: a skill loaded, a compaction |
| `{act}` | an act as it is, with no reach: a person's decision, a recorded act |

`play` answers with the run, each step's answers, everything said (with
the places reached) and every refusal. What was judged is the
[verdict](../verdict/README.md) plugin's, read for the run as for any other.

```ts
const played = await playAs(ctx, {
  start: { cwd: "/home/me/repo" },
  steps: [{ tool: "Edit", input: { file_path: "/home/me/repo/a.ts" }, output: "String to replace not found in file.", ok: false }, { reply: "Done." }],
}, { run: "s1" });
played.refused; // the grow plugin's ask at reply_end
```

## A recorded run, played again

`scriptOf(events)` makes a script from a run recorded on the
[exchange](../../spec/exchange.md), and `scripted.play`'s
`replay(run)` plays it under a new run id against the nodes loaded now.
The replay's start is the recorded run's latest `begin` without its parent,
harness `scripted`, titled "Replay of …", with the fact `replay_of`.

- Its acts are played as they were recorded, a denied one included: the
  agent's side is what happened; the map's side is asked again.
- The exchange records a reach only where something was said, so the
  reaches are rebuilt. The events one reach recorded (says, refusals,
  holds, a node's miss, a compaction) share its time and make one reach.
  Where no node spoke, the reach is worked out from the acts as the adapter
  makes them: `session_start` as the run begins, `prompt` before a person's
  prompt, a tool call's `tool:` and `file:` places before its act (with its
  input) and `tool_result:` after (with its output; a denied call has
  none), `reply_end` before a reply. A recorded reach at a tool call's
  places gains the ones it left out.
- So a run played and replayed records the same exchange, and a node
  added since is heard at the places the run reached, where it went quiet
  too, and judged there.

The [replay](../replay/README.md) plugin uses this to judge a trial node on
past runs where its place came up.

A call Claude Code rejected before any hook ran (read back from the
transcript at Stop) reached nothing in the recorded run; replayed, it
reaches its places like any call.

## Where it shows

A scripted run is a run like any other: the harness view lists it, with
its harness `scripted`, and its events and verdicts show there.
