# typed

A typed call: a plugin asks a model for items of one type, and gets back
facts that fit the map's types, or the problems that stopped them. The
map's own types say what the model must produce; a model's answer becomes
a proposed, checked change. For when the graph decides the next step;
open-ended work stays with agents over MCP.

```
type (types.read) ─▶ JSON Schema ─▶ model ─▶ reply ─▶ facts ─▶ schema.check
                                      ▲                            │ misfit: its problems,
                                      └──── sent back (retries) ◀──┘ in the reply's words
                                                                   │ fit
                                                       proposed facts (nothing written)
```

Provides `typed.ask`, its own key. Injects `call.ask`, `types.read`,
`action.invoke` (for `schema.check`), `action.register`, `exchange.read`
and `agent.run` (to record attempts in the call's run).

## `typed.ask(start)`

| `start` | |
|---|---|
| `type` | A base or a flavour, as `types.read` resolves it |
| `prompt` | What to make, with what the model should know (ids it may link to) |
| `system` | More for the system prompt |
| `links` | Kinds of link the model may give each item. Absent: every kind whose `from` allows the type's base |
| `attach` | Links the caller adds to every item (`{type: "part_of", to: <hub>}`) |
| `fields` | Only these of the type's fields go into the schema the model sees (title required only when offered); a field it gives that wasn't offered is a problem |
| `set` | Fields the caller sets on every item, over the reply's, before any check: bookkeeping (a version stamp, the id it is about) the model is never offered |
| `follow` | `{item, version}`, passed to `call.ask`: the item whose decision at this version judges the call. `{made: true, version}`: the item the call makes (it then asks for exactly one), followed once the reply fits, through the answer's `follow` |
| `subject` | The caller's own context in the prompt, `{type, tokens}`: recorded on the answer by kind and size, so the context plugin counts it (`subject:<type>`) |
| `min`, `max` | How many items |
| `retries` | How many times a misfit is sent back (default the config's, else 1) |
| `model` | The model, chosen call by call: a spec (`anthropic:claude-sonnet-5-5`, `openai:<model>`, `claude[:<model>]`) or an adapter (below). A spec with no key on the server, or no such provider, is refused (`typed.model`) saying which. Default the configured one |
| `check` | The caller's own rule, for what a schema can't say: `({ items, facts }) => problems`, run once `schema.check` finds nothing. Its problems (`by: "caller"`) are sent back and fail the call like the schema's; a throw fails it like the model's. Programmatic only, not in the `typed.ask` action |
| `title`, `parent`, `places`, `facts` | As `call.ask`'s. `places` default `typed:<type>`: what nodes say there goes into the system prompt |

It answers `{ ok: true, run, facts, ids, attempts, usage }` (`ids`: each
item's ref → its new id) or `{ ok: false, run, problems, attempts,
usage }`. A model that throws is thrown on, recorded as a failed answer.

## The schema ([shape.ts](shape.ts))

Built from the type, nothing written per type: `{ items: [ { ref, title,
note, status, …fields, links: [{ type, to }] } ] }`. Each field by its kind
(`choice` an enum, `date` and `id` strings said so, `json` anything), the
statuses its base's, the kinds of link those allowed out of its base, `to`
an existing id or another item's `ref`. A flavour has its base's fields and
statuses and its own. `strictSubset` makes it the shape providers' strict
modes take (every property required, optional ones nullable).

The reply becomes facts: each item new, at its base's first open status
unless it gives one, each link an item of its own. Shape problems (no
`items`, no title, a ref used twice, `type` given) are found here;
everything else (a field the type hasn't, a value of the wrong kind, a
status not its base's, a link end that isn't there or isn't of the bases
allowed) is the schema plugin's `schema.check`, the same check the write
chain makes. A problem names the item as the reply did (`item "sweep":
…`), never an id the model never saw.

## Models ([model.ts](model.ts))

An adapter takes `{ system, messages, schema, name }` and answers `{ json?,
text, usage? }`. A provider's strict mode is only an optimization, since
the subsets of JSON Schema they take differ; the guarantee is the check.
No client library: each is one `fetch` or one process.

| Adapter | Asks |
|---|---|
| `anthropic` | The Messages API, the schema as a forced tool's input |
| `openai` | Any OpenAI-compatible chat completions endpoint (OpenAI, Gemini's and Ollama's compatible endpoints, a gateway): `response_format` json_schema (`mode` `schema`), strict (`strict`), or JSON mode with the schema said (`json`) |
| `command` | Any program reading a prompt on stdin and writing text: the JSON is parsed out of the words (`jsonIn`). `reply: "claude-json"` reads `claude -p --output-format json` |
| `scripted` | Answers given in advance, for tests |

Config: `model`, an adapter's options with its `provider`, or a short
spec: `anthropic:<model>`, `openai:<model>` (`OPENAI_BASE_URL` for another
endpoint) or `claude[:<model>]` (the Claude Code CLI, no tools, no project
or user settings). A key is named by its environment variable (`key_env`,
default `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`), never written in config.
The server reads `ARCHIPELAGO_MODEL`. With none, `typed.ask` is refused
(`typed.no_model`) unless the caller gives a model.

A caller chooses the model call by call with `model`, in `typed.ask` and
its action alike, so every plugin built on it (and every agent through
`act`) can. `typed.models` lists the specs offered (`choices` in config,
default Haiku, Sonnet and Opus 5.5 and the Claude Code CLI), whether the
server holds each one's key (`ready`, the variable's name in `key`; never
the key) and the configured default. Config `models` names models by spec,
looked up first: for tests and demos (`{ "scripted": scripted([...]) }`,
with `model: "scripted"`).

## In the record

A typed call is a [call](../call/README.md): a run (`harness: "call"`,
`typed: <type>`, `model`, `caller`) under its parent, so it shows like any
other call in the Context interface, under the run that made it (or
"typed calls"). Its run, in order:

| Place | Act | Holds |
|---|---|---|
| `typed:<type>` | (said) | What the map's nodes said to it |
| `typed:attempt` | `reply` | Input: the attempt, the model, the schema (first) or the retry sent (later). Output: the reply (`json`, or its `text`), its `usage`. Ok: it fit |
| `typed:check` | `tool` | Input: the facts. Output: `fits`, `problems`, and the `retry` sent back or why none (`failed`) |
| `reply_end` | `reply` | The answer: how many fit, on which attempt; a misfit is a failed reply |

The prompt's words are never recorded: the model gets them, the exchange
gets the schema, the replies, the problems and the retries sent, and the
caller's context only by its `subject`.

Each act's input says what it is (`description`), so the run pane's line
reads "attempt 2 · …, after a misfit sent back"; opened, every part shows.

| Action | Does |
|---|---|
| `typed.ask` | `typed.ask` with the configured model, for a person or an agent. Writes nothing |
| `typed.models` | The specs a call can name, whether each one's key is on the server, and the default. Writes nothing |
| `typed.get` `{ run }` | The call read back from the exchange: type, model, schema, each attempt (reply, usage, problems, retry), outcome (`fit`, `misfit`, `failed`, `open`), the proposed facts. Writes nothing |
| `typed.calls` `{ limit?, after? }` | The newest typed calls, each with its outcome and attempts (at most 50 a page). Writes nothing |
| `typed.apply` `{ run }` | Writes a fitting call's proposed facts as the caller's change, through the write chain (checked again). Refused for a misfit |

Nothing writes on its own: a plugin writes the facts through an action of its
own (`call.write(result.facts)`), a person through `typed.apply`.
Tested in `test/typed.test.ts`.
