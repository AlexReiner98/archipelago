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
3. `blocked`: the run is `waiting` on a resource, or works on an item with an
   open `depends_on`.
4. `working`: its latest turn is open.
5. `quiet`: open, no event for 30 minutes (a style's number, `quiet_after`).
6. `your_move`: its latest turn ended `asked`, `stopped` or `failed`.
7. `idle`: its latest turn ended `done`.

Its line: the question its latest turn asked, else its latest beat, else the
title of what it works on.

## Who builds what

| task | files it owns |
|---|---|
| 1. Raw session events (e_7frke95h) | `src/session-events.ts`, the `/hooks/events` route, `src/operational.ts`, the stream's retention in `packs/core/pack.json` `rules` |
| 2. Turns from events (e_xhvdjnj8) | `packs/core/sessions/turns.js` and its test |
| 3. Claude Code's adapter (e_4n6kxmd9) | `scripts/pelago-hook.mjs`, the setup that registers hooks |
| 4. A session's parent (e_ghdxec3h) | the link type in `packs/core/pack.json` `relations`, `src/sessions.ts` |
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
