# claude-code

The Claude Code adapter. Claude Code's hooks and an MCP server are mere
callers of `agent.run` ([spec](../../spec/agent.md)): what a hook or tool
tells the model is what the nodes say or refuse at a place, and what the
agent does comes in as an act. Nothing past this plugin knows which harness
runs. Injects `agent.run`, `agent.tree`, `action.invoke`, `action.list` and
`exchange.read`, so it waits for an agent plugin, an action plugin and an
exchange.

## What the agent gets

What the nodes say at a moment is one block (`context.ts`), each node's
words under a short tag naming it, so the agent can weigh and cite them and
a miss can be tied to a node:

```
[Branch up to date before merge]
Before a branch is merged, bring it up to date with main: …

[Since you last heard] A person retitled one item.
```

The tag is the node's title (from `agent.tree`), at most 48 characters, with
no path or id in it: a path is cut to its last name, an id gives way to the
node's kind. One line of words gets a one-line tag; longer words get the tag
on its own line. A refusal's words are tagged the same way. A node that is
no longer loaded when its words go out is said untagged.

At `session_start` (and a subagent's) the standing words, the `instruction`
nodes, come first, ordered by node id, not by when their plugins loaded; what
changes per run (any other node said there: the run's own facts, what
changed since it last heard) comes after them. So the start of what the map
says is the same from run to run with the same nodes. Elsewhere the order is
the answer's (config-tree order).

### A budget

Claude Code keeps about 10,000 characters of a hook's `additionalContext`;
past that the model gets a short preview and the rest goes to a file it is
not made to read. So the block is kept under a budget, `contextMax`
characters (default 9,000, `CONTEXT_MAX`), and the same budget holds for a
refusal's reason. Under it, every node's words are whole. Past it
(`fitted`):

- a refusal is said first, whole;
- then the other nodes said at this place, then the standing words, are
  said whole in the answer's order, each while it still fits;
- every node left over is one line: its tag and how to get its words in
  full, `get` on the map item it was made from, else `hear` on the place.

```
[More from the map] The words here pass this hook's 9000 characters, so 2 of its 7 nodes are one line each. Get any of them in full with the tool its line names.
- [Branch up to date before merge] in full: get {"ids":["e_5mrg7up2"]}
- [Plugins stay revertible] in full: hear {"place":"session_start"}
```

Those said whole keep the order above (standing words first at
`session_start`); the lines come after them. If even the lines don't fit,
the last ones become one line that counts them. Only the hook's text is cut:
the exchange still records each node's say whole, so a listed node is held
back the next time like any node said once in the context, and it is the
agent's to ask for. Which nodes went out as a line is not yet on the
exchange; that needs a spec change (an edition after 12).

The Context interface's run pane shows, on an opened say or refusal, the
whole block as the agent got it, rebuilt with the same `context.ts` from the
moment's events (with the nodes' titles as loaded now). Words said at
`skill:` and `memory:` places are not handed back, so they show none.

### Reading the cache in a transcript

Each assistant entry in a Claude Code transcript carries its message's
usage: the cache-read input tokens are the part of the prompt read from the
cache, the cache-creation input tokens the part written to it. On a
session's first entry the read is the system prompt and tools another
session already cached (the same count across sessions of one setup); the
first user message, where the SessionStart context sits, is written. The cache matches
a prefix only up to a cache breakpoint, so the map's words count as read
only when everything before such a breakpoint is the same as in a run that
wrote it: stable standing words are what makes that possible, they don't
promise it. The harness view's window (plugins/transcript) shows these counts.

## Hooks to places

| Hook | Calls | The hook answers |
|---|---|---|
| SessionStart | `begin` (once per session), reach `session_start` | what was said, as context, standing words first |
| UserPromptSubmit | reach `prompt`, then act `prompt` by the person | context, or block on a refusal |
| PreToolUse | reach `tool:<name>` and `file:<path>` (from `file_path`, `notebook_path`, relative to the run's folder) | context, or deny on a refusal; a denied call is its own act, `ok: false` |
| PostToolUse / PostToolUseFailure | act `tool`, then reach `tool_result:<name>` with the result | context |
| Stop | reach `reply_end` with the reply, then act `reply` (on a refusal, a denied act: the reply as input, the refusal as output) | block on a refusal: the agent keeps going |
| SessionEnd | `end` (and of any subagent run still open) | nothing |
| SubagentStart | `begin` the subagent's run, reach `session_start` (input `{source: "subagent", agent_type}`) | what was said, as context |
| SubagentStop | as Stop, on the subagent's run and its own transcript, then `end` it | block on a refusal: the subagent keeps going |
| PreCompact | reach `compact` (input `{trigger}`): the agent plugin records it, and marks what is said again after it as re-said | what was said there, as plain text: Claude Code's instructions for the summary it writes (below) |
| PermissionRequest | note the ask; the person's answer becomes a `decision` act at `tool:<name>` | nothing: the dialog shows |
| Notification | act `notice` at `prompt` (input `{type, message}`): the run waits on the person | nothing |

## At a compaction

Claude Code takes a PreCompact command hook's plain stdout (exit 0) as
instructions for the summary it writes, kept under 10,000 characters. So
what the nodes at `compact` say is handed on there, each under its tag, in
the same budget as any hook's context: the server answers it as
`text/plain` (`instructions` in [mapping.ts](mapping.ts), `plainOf`), and
[hook.ts](hook.ts) prints it as it is. The map decides what the summary
keeps; the adapter only hands it on. Three nodes speak there now:

| Node | Says |
|---|---|
| `hub/task` | the run's task, by title, id and status, and what it is part of |
| `claim/kept` | the run's open claims, their intent and files, and the files written this turn |
| `words/heard` | the titles and ids of the map's nodes the run was told |

```
PreCompact ─▶ reach compact ─▶ hub/task, claim/kept, words/heard ─▶ text/plain ─▶ hook.ts stdout ─▶ the summary keeps them
SessionStart (compact) ─▶ reach session_start ─▶ re-said
```

The summary then carries the task, the claims and what was told across the
compaction, whatever comes back at `session_start` after. PreCompact must
be a command hook: an http hook's plain text answer is a hook error. A
manual `/compact` with its own focus still reaches `compact` the same way;
how Claude Code joins the two isn't documented.

## The person's decisions

A PermissionRequest names no tool use id, so an ask is matched to its call
by place and input. The answer shows in what follows: the call's
PostToolUse means allowed, and its result in the transcript, read at the
next prompt or stop, says whether the person rejected it (Claude Code's
"The user doesn't want to proceed…"). Either way it is a `decision` act by
the person, before the call's own act; a denial is `ok: false`, a miss the
verdicts and grow see, and a denied call has no tool act, since it never ran.

## Subagents

A subagent is a run of its own, `<session>:<agent_id>`, whose `parent` is the
session's run and whose title is its type ("Explore subagent"). Every hook
from inside it carries its `agent_id`, so its tool calls are its own acts,
judged in its own run. A SubagentStop for a subagent that never started
(Claude Code's own helpers, such as prompt suggestions) is not a run.
What a subagent loads is in its own transcript, which its hooks name only
when it stops: at SubagentStop its skills and memory files are reached in
its run, ahead of `reply_end`.

Claude Code rejects some tool calls before any hook runs (an Edit whose
`old_string` isn't in the file): the model sees the error, the hooks don't.
So at Stop, the turn's errored tool results that no hook saw are read from
the transcript and recorded as failed tool acts, ahead of `reply_end`.
What is already on the record is read back from the exchange (the turn's
tool acts, from the prompt's time on), not only remembered: each recorded
call at a place with the same input accounts for one transcript call. So a
call is recorded once even when the server restarted mid-turn and forgot
what its hooks saw, and a second Stop adds nothing.

## Skills and memory

Every hook but SessionEnd first reads the transcript from where the last
one stopped, for what Claude Code loaded: memory files from an
`instructions` attachment (`memory:<scope>/<path>`), a skill's text from
the meta entry after it loads (`skill:<name>`, named by its Skill call, else
its folder), and skills an `invoked_skills` attachment loads again after a
compaction. Each is noted with the action `loaded.note`, when a plugin
declares it ([loaded](https://github.com/AlexReiner98/archipelago-loop/blob/main/loaded/README.md)), and reached with what was
loaded as the input, ahead of the hook's own places: a memory file is said
before the turn's first tool call. What is said there isn't handed back:
the map speaks there through the file itself, which it writes once the
file is adopted ([written](https://github.com/AlexReiner98/archipelago-loop/blob/main/written/README.md)). Both places are edition 2
terms, listed in the adapter's `reaches`.
After a restart the transcript is read from its start, and the loads the
exchange already holds are skipped.

The run is the session id; each run has its own context, intercepted with
the agent as actor and the run, and its hooks are handled one at a time in
the order they came. Long tool inputs and results are cut at 4000
characters per string before they're recorded. The reply comes from the
hook, or from the transcript's last assistant text.

## The MCP server

The adapter provides `mcp.host` ([host.ts](../mcp/host.ts)) and serves
whatever tools plugins add to it: the [mcp](../mcp/README.md) plugin's `hear`,
`act`, `get`, `query`, `tell` and `run`. It knows none of them. It lists
them, says where each is called (`tool:mcp__archipelago__<tool>`, with the
`name` config the server is added under), and hands each call its run: a
tool call doesn't name its session, so the run is found from the tool use
id the PreToolUse hook saw for it, else the last run about to call one of
this server's tools. Without the mcp plugin the server answers with no tools.

A client without hooks (claude.ai, a desktop chat: any client but Claude
Code) gets an `Mcp-Session-Id` at `initialize`, and its session is a run of
its own, `mcp-<id>`, with the client as agent and harness. The adapter does
what the hooks would: it begins the run, reaches `session_start`, reaches
each call's `tool:` place before it and `tool_result:` after it, records the
call as an act, and hands back what was said with the result. `DELETE /mcp`
ends the run; a session the server doesn't know (it restarted) is a 404, and
the client starts a new one.

### A map by name

A server that serves a map by name (`app/server.ts --map`) takes any free
port, so nothing can name its address in advance. [registry.ts](registry.ts)
says where each map's server is (`~/.archipelago/servers/<name>.json`, or
under `ARCHIPELAGO_HOME`), and two scripts read it on every call:

- `hook.ts --map <name>`: the hook, sent to the map's adapter wherever it is;
  nothing, exit 0, while the map isn't running, except when a session starts
  (or is cleared): then one line, to the person and the agent, that the map
  is down and `archipelago` starts it.
- `proxy.ts <name>`: a stdio MCP server passing each message on to the map's
  `/mcp`. When the map moves, it opens a session there with the client's own
  `initialize`; while it is down it answers with no tools, and tells the
  client its tools changed (`notifications/tools/list_changed`) once the map
  starts.

A folder connected from such a map's page holds these
([connect](../connect/README.md)).

### The current map: one switch

`current` in place of a name (`hook.ts --map current`, `proxy.ts current`,
or `proxy.ts` with no name) follows the switch: `~/.archipelago/current`,
one map's name, set with `npm run map -- use <name>`. Both scripts read it
again on every call, so a switch moves every running session at once, with
nothing to restart. User-level hooks and MCP server set to `current` are
the one place that decides which map a session on this machine reports to.

A map may be served elsewhere: `npm run map -- remote add <name> <url>
--token-env VAR` keeps `~/.archipelago/remotes/<name>.json` (its address,
and the variable its token is in, never the token). Such a map is reached
at `<url>/mcp` and `<url>/hook`, with the token as `Authorization: Bearer`,
read from the variable at each call. `registry.ts` `reachOf` answers, for a
name or `current`, where a map is reached now; `npm run map -- ls` marks the
current map with `*`, and each map's page says whether it is the current
one ([serving](../serving/README.md)).

## Running it

```
node plugins/claude-code/host.ts [--port 5281] [--demo] [--journal file]
```

starts exchange, agent and this plugin in one hot-reloaded process, with a
live tail of the exchange on the console. `--demo` adds a few nodes
([dev/demo.ts](dev/demo.ts)) so there is something to say. The journal
defaults to `plugins/claude-code/.data/exchange.jsonl`.

Point Claude Code at it with [settings.json](settings.json) (the hooks) and
[mcp.json](mcp.json) (the MCP server). Both name 5281, the dev port, so
they reach this host or the dev app server (`npm run dev`, or `npm run serve`), never live:

```
claude --settings plugins/claude-code/settings.json --mcp-config plugins/claude-code/mcp.json
```

The hooks are Claude Code's `http` hooks, posting to `POST /hook`, except
SessionStart, which Claude Code runs only as a command:
[hook.ts](hook.ts) forwards it. If the adapter isn't running, every hook
says nothing and the agent carries on.

`ARCHIPELAGO_TOKEN`, when set, else the file `ARCHIPELAGO_TOKEN_FILE`
(default `~/.archipelago/token`) when it is there, goes with every post as
`Authorization: Bearer`, for a server that takes a token. A map with no run yet shows what
to copy, this server's own ([connect](../connect/README.md)).

hook.ts adds `git_remote`: origin of the session's folder as
`host/owner/name`, read where the session runs (no credentials leave), and
`git_branch`, the branch checked out there (none for a detached HEAD). The
run begins with them as its `remote` and `branch` facts, so a server that
can't see the folder still knows the repository and the branch
([git](../git/README.md), [claim](../claim/README.md)).

The run's transcript is its `transcript` fact: the hook's
`transcript_path`, and for a subagent its own file (`agent_transcript_path`,
else `<session>/subagents/agent-<agent_id>.jsonl` beside the session's).
The transcript plugin reads what the agent was given from it
([transcript](https://github.com/AlexReiner98/archipelago-loop/blob/main/transcript/README.md)). It is a path on this machine, so
the context interface never shows it.

A server elsewhere can't open that path, so hook.ts reads the transcript
where the session runs and sends it with each hook, as numbers: the next
page from a byte cursor it keeps per session (in the temp folder, by a
hash; `ARCHIPELAGO_HOOK_STATE` moves it), at most 1 MB a call, each record
made `slim` (its kind, time, sizes, tool names and token counts; a hook's
context by a hash of its start; never text, a path or an address). A page
that comes to more than 256 kB is not sent: the hook says how many bytes it
skipped. One call of a session holds the cursor at a time; another goes
without a page, and doesn't wait. The page is `archipelago_transcript` in
the hook input. The adapter takes it out before the hook is handled (it is
never in the run's record), gives it to the transcript plugin
(`transcript.take`), and answers with a header, `x-archipelago-transcript`:
`own` when it reads the file itself (a map on the same machine: the hook
then sends no more for that session), else `send <bytes>`, where the
run's next page starts, so a page that didn't land, or a server that
started again with nothing, is sent again. `ARCHIPELAGO_TRANSCRIPT=off`
stops the sending. hook.ts and [slim.ts](slim.ts) beside it import
nothing else from the repository, so a server elsewhere serves the two as
they are (`/hook.ts`, `/slim.ts`). `slim`, `readPage` and who a hook is
live in slim.ts, and the transcript plugin reads local files through the same
`slim`. The hook loads slim.ts only when it is there: without it, it
forwards as before and sends no transcript.

| Setting | Default | |
|---|---|---|
| `contextMax` | 9000 | A hook's context, and a refusal's reason, at most, in characters ("A budget"). Past it, nodes are listed a line each |
| `files` | true | Whether a transcript a hook names is opened on this server's disk (also the last reply, read from it). A server elsewhere sets false: a hook's path names a file on another machine, and it reads only the pages the hook sends. The path isn't kept either: such a run has no `transcript` fact |

## Every session

To have every Claude Code session, in any repo, report here: run the live
server, and add the hooks at user level.

```
npm run live:setup        # once: the live worktree, beside this checkout
npm run live:start        # also live:stop, live:status
```

starts `app/server.ts` detached from the live worktree, at a fixed commit
with hot reload off ([scripts/live.ts](../../scripts/live.ts)), with its
data, log and pid in the worktree's `app/.data`, so it outlives the
terminal, keeps its runs across restarts, and isn't touched by edits here.
`npm run promote` moves it to new code (the main README, "Live").

In `~/.claude/settings.json`, beside whatever hooks are there, add one group
per event (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse,
PostToolUseFailure, Stop, SessionEnd, SubagentStart, SubagentStop,
PreCompact, PermissionRequest, Notification; `"matcher": "*"` on the tool
events and PermissionRequest),
each with:

```json
{ "type": "command", "command": "node \"<live worktree>/plugins/claude-code/hook.ts\"", "timeout": 5 }
```

And the MCP server, at user level, so any session can `hear` and `act`
(how an agent writes the trial node the grow plugin asks for):

```
claude mcp add --scope user --transport http archipelago http://127.0.0.1:5181/mcp
```

When the server is down, the session shows the MCP server as failed and
carries on.

The adapter answers only `127.0.0.1:<port>` and `localhost:<port>` as its
Host, and refuses a request carrying an Origin that is not the page's or one
in `config.origins` ([runtime/guard.ts](../../runtime/guard.ts)), so a web
page in the owner's browser can't post to `/hook` or `/mcp`. Hooks and MCP
clients send no Origin.

Command hooks, not http: an http hook to a server that is down shows as a
hook error in the session ("Stop hook error occurred", a PreToolUse
warning). [hook.ts](hook.ts) prints nothing and exits 0 when the server is
down or slow (3 s, `ARCHIPELAGO_HOOK_TIMEOUT_MS`), at about 0.2 s a hook.
