# Sessions, read turn by turn

What a session did is kept as raw events; its turns, state and line are worked
out from them. Any source feeds the map through an adapter that speaks the
vocabulary below: Claude Code's hooks now, an Agent SDK runner later. The plan
is the project "Sessions read turn by turn" (e_b9ad9s5t) on the map; the
choice behind it is e_zf44u9gt.

## Principles

- **Events are the record; turns are worked out.** What a turn, "stalled" or
  "your move" means can change and is worked out again from the events kept,
  as the log is the truth and tables its projections.
- **Adapters in, one vocabulary.** An adapter turns what its source sees into
  these events and decides nothing else. Names follow OpenTelemetry's
  conventions for generative AI agents where one fits.
- **Sessions form a tree.** A session started by another is linked to it.
- **States are pack data.** Their names and how each is worked out live in a
  pack, tested with events in and state out, no database.
- **Free text is a gist, sealed.** A prompt or reply is kept as its first
  sentence cut to 200 characters, a question whole up to 500; never a
  transcript. Sealed with the run's key like the log's free text.

## An event

```json
{ "at": "2026-11-04T00:30:21.166Z", "kind": "tool.end", "turn": "t3", "...": "fields of its kind" }
```

- `at`: when it happened, ISO time, from the source's clock.
- `kind`: one of the kinds below.
- `turn`: the source's id for the turn it belongs to, when it knows one
  (Claude Code: the prompt's uuid); else the projection assigns events to the
  turn open at their time.

Sent in batches: `POST /hooks/events` with
`{ "session_id": "...", "source": "claude-code", "events": [ ... ] }`, with
the same token and resolution of the run as the other hooks
(`resolveRun`). The server keeps them in order per run; an event it already
has (same run, `at`, `kind`, `turn`) is dropped, so an adapter may resend.

## The kinds

| kind | fields | when |
|---|---|---|
| `turn.start` | `by`: `person` \| `session` \| `event`, `from`?: run id or event name, `gist`?: the prompt's gist | a prompt reaches the session |
| `tool.end` | `tool`: `read` \| `edit` \| `shell` \| `search` \| `map` \| `web` \| `agent` \| `other`, `name`: the tool's own name, `ok`: boolean, `files`?: paths changed, `items`?: ids read or changed | a tool call returns |
| `test.run` | `ok`: boolean, `passed`?, `failed`?: numbers, `command`?: the command, cut to 120 | a shell call that ran tests returns |
| `commit` | `sha`, `subject` | a commit was made |
| `wait.start` | `for`: `permission` \| `input`, `gist`?: what it waits on | the session stops to ask its client |
| `wait.end` | `for` | the wait is answered |
| `turn.end` | `ended`: `asked` \| `done` \| `stopped` \| `failed`, `question`?: the question, whole up to 500, `gist`?: the reply's gist, `tokens`?: `{ input, output, cache_read, cache_write }` | the reply ends |
| `session.start` | `parent`?: run id of the session that started it, `title`?, `branch`? | the session starts |
| `session.end` | `reason`?: as `ended_by` | the session ends |

`ended: "asked"` is a reply that ends on a question for its person (Claude
Code: the reply's last paragraph ends in `?`, or the turn closed with a
question in its next-step box); `stopped` is a turn its person interrupted;
`failed` one that ended in an error.

## A turn

Worked out from a run's events, in order:

```json
{ "turn": "t3", "began": "...", "ended": "...", "by": "person", "from": null,
  "gist": "...", "tools": { "edit": 4, "shell": 2 }, "files": ["..."], "items": ["e_..."],
  "tests": { "runs": 2, "ok": 1, "failed": 1 }, "commits": ["sha"],
  "waits": [{ "for": "permission", "began": "...", "ended": "..." }],
  "end": "asked", "question": "...", "tokens": { "input": 0, "output": 0 } }
```

A turn is open from its `turn.start` until its `turn.end`; `ended` and `end`
are absent while it is open.

## A state

Worked out from the run's latest turn, its open wait, its claims and links,
and the time now. The first that holds:

1. `done`: the run is closed.
2. `waiting`: a `wait.start` with no `wait.end` (`for` says which).
3. `blocked`: it works on an item with an open `depends_on`. A run's status
   `waiting` is not it: a chat's run waits once its agent says it is done.
4. `quiet`: its latest turn is open and nothing has come for 30 minutes (a
   style's number, `quiet_after`): a turn under way gone silent, likely dead.
   A turn that ended is waiting on its person and is never quiet.
5. `working`: its latest turn is open; for a run that has sent no events
   yet (its checkout's hook is older), its heartbeat says `busy`.
6. `your_move`: its latest turn ended `asked`, `stopped` or `failed`.
7. `idle`: its latest turn ended `done`.

A beat a rule asked for (`asked`) is not the session's own and is never its
line. Its line: what its open wait is for, else the question its latest turn
asked, else its latest beat, else what its latest turn was asked to do (its
gist), else the title of what it works on (drawn beside it, so the last
resort).

## Who builds what

| task | files it owns |
|---|---|
| 1. Raw session events (e_7frke95h) | `packs/sessions/kernel/session-events.ts`, the `/hooks/events` route, `packs/log/kernel/operational.ts`, the stream's retention in `packs/core/pack.json` `rules` |
| 2. Turns from events (e_xhvdjnj8) | `packs/core/sessions/turns.js` and its test |
| 3. Claude Code's adapter (e_4n6kxmd9) | `scripts/pelago-hook.mjs`, the setup that registers hooks, `src/claude-code.ts` (the shape of a hook's answer), core's instructions for `server_restarted` and `setup_behind` |
| 4. A session's parent (e_ghdxec3h) | the link type in `packs/core/pack.json` `relations`, `packs/sessions/kernel/sessions.ts` |
| 5. States (e_ees7hr6q) | `packs/core/sessions/states.js` and its test |

A change to this vocabulary is made here first, and said to every task that
reads it.

## Claude Code's telemetry

Claude Code can export OpenTelemetry metrics and log events (from its
monitoring docs, read 3 Nov 2026). The adapter does not use it: every job it
does, a hook already does, without a collector on each machine.

- **What it carries.** Events `claude_code.user_prompt` (`prompt_length`,
  `prompt`), `tool_result` (`tool_name`, `tool_use_id`, `success`,
  `duration_ms`, `error`), `api_request` (`model`, `cost_usd`, tokens by
  kind), `api_error`, `tool_decision` (accept or reject, and its `source`),
  and more; metrics for sessions, lines changed, commits, pull requests, cost,
  tokens and active time. Every event has `session.id` and `prompt.id`, the
  same id hooks are given as `prompt_id`.
- **What it keeps back.** Prompt text is redacted unless
  `OTEL_LOG_USER_PROMPTS=1`; tool inputs and commands unless
  `OTEL_LOG_TOOL_DETAILS=1`; replies unless `OTEL_LOG_ASSISTANT_RESPONSES`.
- **How it is turned on.** `CLAUDE_CODE_ENABLE_TELEMETRY=1` and an exporter
  (`OTEL_LOGS_EXPORTER=otlp`, `OTEL_EXPORTER_OTLP_ENDPOINT`) in the
  environment Claude Code is started with; a project's settings cannot set
  the exporter. Logs are sent every 5 seconds.
- **Where it would do better.** Cost in dollars, time per tool and how a
  permission was decided, which no hook says. Worth taking only if the map
  wants those: it would need an OTLP route and the owner to set the
  environment on each machine.

How the hooks feed the vocabulary: a turn is named by the hook's `prompt_id`
(`promptId` on the transcript's lines); `turn.start` is told on
UserPromptSubmit, `session.start` and `session.end` on SessionStart and
SessionEnd; `tool.end`, `test.run` and `commit` are read off the transcript at
Stop, and again at the next prompt for a turn stopped (which hears no Stop),
with its `turn.end` `stopped`; `wait.start` on Notification (a permission
prompt or a question to answer, not the idle reminder), `wait.end` at the next
tool, prompt or Stop; `turn.end` `failed` on StopFailure. A Stop the server
answers with a block has no `turn.end`: the reply goes on.

## The Agent SDK adapter

`scripts/pelago-sdk-runner.mjs` runs one prompt on the Claude Agent SDK and
tells its session in this vocabulary, with `source: "agent-sdk"`. A sketch,
for the harness to grow from (e_k3g5c8yh).

- **How it is run.** `node scripts/pelago-sdk-runner.mjs "the prompt"
  [--title ...] [--parent <session id>]`, against `PELAGO_URL` with
  `PELAGO_AGENT_TOKEN`. The SDK is no dependency: it is imported only if
  present (`npm i --no-save @anthropic-ai/claude-agent-sdk`), and uses Claude
  Code's sign-in.
- **The run.** Made on the SDK's `system` `init` message, by its
  `session_id`, through `/hooks/session-start`, as a hook makes one; ended
  through `/hooks/session-end`. The run's surface is still `claude-code`.
- **The mapping** is `sdkEvents` (test/sdk-runner.test.ts): the messages as
  received, each stamped with the runner's clock (the SDK's carry no time),
  in; events out. One prompt is one turn. `init` is `session.start`, then
  `turn.start`; each `tool_result` in a `user` message, against its
  `tool_use`, is read by the hook's own `callEvents` (`tool.end`, `test.run`,
  `commit`); `session_state_changed` to `requires_action` and back is a
  `wait` for permission; `result` is `turn.end`, `done` or `asked` as the
  hook reads a reply (`replyEnd`), `stopped` for `aborted_*`, else `failed`,
  with its `usage` as `tokens`. A subagent's messages
  (`parent_tool_use_id`) are left out, as the hook leaves its transcript out.
- **Sending.** After each message the runner sends what is new, with
  `eventsPost` from `pelago-events.mjs`; the server drops what it has.

## Wired: what the server gives

Phase 2 builds against these shapes; the wiring (`packs/runs/kernel/session-state.ts`)
makes them true.

- `sessionState(l, run, now?)`, in `packs/runs/kernel/session-state.ts`: reads the run's
  events (`sessionEvents`), works out its turns (`turnsOf`) and its state
  (`stateOf`, with its latest beat from `story`, the title of what it works
  on, its open `depends_on`, and `quiet_after` from the house style's
  `numbers`), and answers
  `{ state, for?, line, since, turn?: <its latest turn>, turns: <count> }`.
- `sessionStates(l, runs, now?)`: the same for many runs, in a bounded number
  of reads (runs by id), as a `Map` by run id.
- The `sessions` view: each open run also has `session: { state, for?, line,
  since }` and `turn` (its latest turn), and the open ones are ordered by the
  states' order of attention: `waiting`, `your_move`, `blocked`, `quiet`,
  `working`, `idle`, each oldest `since` first.
- The flat answer (`query` `flat`, `packs/query/kernel/query-flat.ts`): an item that is a run
  has `session: { state, for?, line, since }` beside `status` and `phase`.
- A new read `turns` (`query` name `turns`, params `run`, `limit?`): the run's
  turns, newest first, as "A turn"; built by task 10.
- The house style (`packs/core/pack.json` `styles`) names `quiet_after` (30,
  minutes) and `quiet_end_after` (1440, minutes) in `numbers`.

## Who builds phase 2

| task | files it owns |
|---|---|
| Wiring (part of e_ees7hr6q) | `packs/runs/kernel/session-state.ts`, `packs/query/kernel/views.ts` (the `sessions` view only), `packs/query/kernel/query-flat.ts`, the two numbers in the house style |
| 7. Ended leave; quiet dim, then end (e_9jduzn9c) | the stale sweep in `packs/sessions/kernel/session-quiet.ts`, `packs/sessions/kernel/sessions.ts` if ending needs it |
| 8. A Sessions view (e_htwjh45d) | a lens preset and style preset in `packs/core/pack.json` (`views`, `styles`), `packs/canvas/layouts/flow/state.js` and the flow's marks for a session |
| 9. The tab bar's count (e_82rggead) | `ui/tab-bar.js`, `ui/tab-life.js` |
| 10. A session's page shows its turns (e_ezyzr7ms) | `packs/sessions/kernel/session-turns.ts` (the `turns` read), a screen piece in `packs/loader/kernel/declared.ts` and its `ui/` module |
| 11. What turns tell (e_ys9d9n25) | `packs/runs/kernel/session-measures.ts` and its view's one line in `packs/query/kernel/views.ts` |
| 12. An SDK adapter (e_bu29txug) | `scripts/pelago-sdk-runner.mjs`, `scripts/pelago-events.mjs` if it shares the posting |

Tasks 8 to 11 build against the shapes above, not the wiring's code: where
they need a run's state before the wiring lands, they read it from a fixture.
