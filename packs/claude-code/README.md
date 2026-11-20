# claude-code

The Claude Code adapter. Claude Code's hooks and an MCP server are mere
callers of `agent.run` ([spec](../../spec/agent.md)): what a hook or tool
tells the model is what the nodes say or refuse at a place, and what the
agent does comes in as an act. Nothing past this pack knows which harness
runs. Injects `agent.run`, `action.invoke` and `action.list`, so it waits
for an agent pack and an action pack.

## Hooks to places

| Hook | Calls | The hook answers |
|---|---|---|
| SessionStart | `begin` (once per session), reach `session_start` | what was said, as context |
| UserPromptSubmit | reach `prompt`, then act `prompt` by the person | context, or block on a refusal |
| PreToolUse | reach `tool:<name>` and `file:<path>` (from `file_path`, `notebook_path`, relative to the run's folder) | context, or deny on a refusal; a denied call is its own act, `ok: false` |
| PostToolUse / PostToolUseFailure | act `tool`, then reach `tool_result:<name>` with the result | context |
| Stop | reach `reply_end` with the reply, then act `reply` (on a refusal, a denied act: the reply as input, the refusal as output) | block on a refusal: the agent keeps going |
| SessionEnd | `end` | nothing |

Claude Code rejects some tool calls before any hook runs (an Edit whose
`old_string` isn't in the file): the model sees the error, the hooks don't.
So at Stop, the turn's errored tool results that no hook saw are read from
the transcript and recorded as failed tool acts, ahead of `reply_end`.

The run is the session id; each run has its own context, intercepted with
the agent as actor and the run, and its hooks are handled one at a time in
the order they came. Long tool inputs and results are cut at 4000
characters per string before they're recorded. The reply comes from the
hook, or from the transcript's last assistant text.

## The MCP server

Two tools. `hear`: what the nodes say at a place the agent names
(`file:spec/agent.ts`, `tool:Bash`). Its answer is only what `reach`
answers; a refusal comes back as an error result. `act`: the agent invokes
a declared action (`action`, `input`, `reason`) as itself, in its run, on
its own authority; its description lists the actions declared now, and a
refusal comes back as an error saying why. This is how an agent writes a
trial node (`grow.trial`). A tool call doesn't name its session, so the run
is found from the tool use id the PreToolUse hook saw for it.

## Running it

```
node packs/claude-code/host.ts [--port 5181] [--demo] [--journal file]
```

starts exchange, agent and this pack in one hot-reloaded process, with a
live tail of the exchange on the console. `--demo` adds a few nodes
([dev/demo.ts](dev/demo.ts)) so there is something to say. The journal
defaults to `packs/claude-code/.data/exchange.jsonl`.

Point Claude Code at it with [settings.json](settings.json) (the hooks) and
[mcp.json](mcp.json) (the MCP server):

```
claude --settings packs/claude-code/settings.json --mcp-config packs/claude-code/mcp.json
```

The hooks are Claude Code's `http` hooks, posting to `POST /hook`, except
SessionStart, which Claude Code runs only as a command:
[hook.ts](hook.ts) forwards it. If the adapter isn't running, every hook
says nothing and the agent carries on.

## Every session

To have every Claude Code session, in any repo, report here: run the app
server on its own, and add the hooks at user level.

```
npm run server:start      # also server:stop, server:status
```

starts `app/server.ts` detached ([scripts/server.ts](../../scripts/server.ts)),
with its data, log and pid in `app/.data`, so it outlives the terminal and
keeps its runs across restarts.

In `~/.claude/settings.json`, beside whatever hooks are there, add one group
per event (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse,
PostToolUseFailure, Stop, SessionEnd; `"matcher": "*"` on the tool events),
each with:

```json
{ "type": "command", "command": "node \"<repo>/packs/claude-code/hook.ts\"", "timeout": 5 }
```

Command hooks, not http: an http hook to a server that is down shows as a
hook error in the session ("Stop hook error occurred", a PreToolUse
warning). [hook.ts](hook.ts) prints nothing and exits 0 when the server is
down or slow (3 s, `ARCHIPELAGO_HOOK_TIMEOUT_MS`), at about 0.2 s a hook.
