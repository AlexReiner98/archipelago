# otel

The exchange as OpenTelemetry spans: each run is a span, each act a child
span, posted as OTLP/HTTP JSON with `fetch` to any collector (Jaeger,
Grafana Tempo, Honeycomb, Logfire, an OpenTelemetry Collector). No
dependency: the request is built by hand ([spans.ts](spans.ts)). Off unless
config names an endpoint.

- **Run**: one span, `invoke_agent <agent>` (a subagent's `agent_type`, else
  the harness), from its `begin` to its `end`. Its trace id is the run id when
  that is a UUID (a Claude Code session id is), so a trace is found by the
  session; else a hash of it. It carries `gen_ai.operation.name`,
  `gen_ai.agent.name`, `gen_ai.agent.id` and `gen_ai.conversation.id` (the
  run), the token use from the transcript (`gen_ai.usage.input_tokens`,
  cache reads and writes counted in, `gen_ai.usage.output_tokens`,
  `gen_ai.usage.cache_read.input_tokens`,
  `gen_ai.usage.cache_creation.input_tokens`, `gen_ai.response.model`) when
  the transcript plugin answers `transcript.tokens`, and `archipelago.*`: the
  run, harness, parent run, task item, and how many acts, says and
  refusals. A run started by another links to the parent's run span.
- **Acts**: a child span each, sent as soon as it is recorded. A tool call
  is `execute_tool <tool>` with `gen_ai.tool.name` and `gen_ai.tool.type`
  (`extension` for an MCP tool, else `function`); it starts when the map was
  last reached at its place (the says before it), else when it was
  recorded. A failed one has status error and `error.type`. Prompts,
  replies, decisions and notices are spans named by their kind.
- **Says, refusals, gates and misses**: events on the run span
  (`archipelago.say`, …) with the node and its plugin, at most 128 a run (the
  rest counted as dropped).
- **Words**: none leave the machine unless `include_content` is true. Off
  (the default), nothing said, no tool input or output, no title, no
  folder, and a place only by its kind (`file`, never `file:<path>`), but a
  tool's name. On, a tool call carries `gen_ai.tool.call.arguments` and
  `gen_ai.tool.call.result`, other acts `archipelago.act.input` and
  `.output`, says `archipelago.text`, each cut at 4096 letters.
- **Sending**: in batches, at most every `batch_ms` (2 s) or at 200 spans.
  A batch that fails is tried once more, then dropped. Only what is
  appended after the plugin loads is sent: the journal is not sent again on
  a restart.

## Config

| Key | Default | |
|---|---|---|
| `endpoint` | none: off | OTLP/HTTP base (`http://127.0.0.1:4318`) or its `/v1/traces` |
| `headers` | none | Sent with each request (a backend's key). Never shown. |
| `include_content` | `false` | Send the words (above) |
| `service` | `archipelago` | `service.name` |
| `batch_ms` | 2000 | |

The app's server ([tree.ts](../../app/tree.ts), `otelFromEnv`) reads the
standard variables: `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` or
`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` (`k=v,k=v`),
`OTEL_SERVICE_NAME`; and `ARCHIPELAGO_OTEL_CONTENT=1` for the words.

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 npm run serve
```

## Action

| Action | Input | Answers |
|---|---|---|
| `otel.status` | `runs` (ids, at most `LIMIT_MAX`) | `on`, `endpoint` (no credentials or query), `include_content`, and per run `spans` taken, `failed` (dropped), `sent` (when last), `whole` (the run's own span went), `error` (the last send's, while it stands) |

## UI

[view.ts](view.ts), the page side, fills the harness's `harness.run` slot,
the line under the Run pane's head: `⇢ otel · <host>` once the collector
took spans for the run (how many, when, whether the run span went, in its
title), `otel · waiting` before, `otel · failed` in the failure colour with
the error. Nothing while the server's otel is off.

Injects `exchange.watch`, `exchange.read` (a run begun before the plugin
loaded: its `begin`, one event), `action.register` and `action.invoke`
(`transcript.tokens`). Tested in `test/otel.test.ts` against a local
receiver.
