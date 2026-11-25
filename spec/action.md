# action

Every change goes through a declared action, whether a person or an agent
makes it. A UI never writes directly; a tool an agent calls is an action;
a pack changing data does it through an action too. Types:
[action.ts](action.ts).

## Capabilities

| Key | Gives |
|---|---|
| `action.register` | Declare an action |
| `action.list` | The declared actions and their schemas |
| `action.invoke` | Run one |
| `action.attest` (11) | Run one on a test's word, at the version of its inputs |

An `action.input` refusal says how to fix the input (11): see below.

## Declaring one

```ts
// the verdict pack injects action.register and exchange.read
ctx["action.register"].register({
  name: "verdict.judge",
  title: "Record whether each node held in a run",
  input: { type: "object", properties: { run: { type: "string" } }, required: ["run"] },
  async run({ run }, call) {
    const events = await ctx["exchange.read"].events(run, { limit: 500 });
    call.write([["+", "e_v1", "type", "verdict"], ["+", "e_v1", "run", run]]);
    return { judged: events.items.length };
  },
});
```

- `name` starts with the pack's id. A second registration of a taken name
  is refused, never silently replaced. Actions have no versions: one whose
  input or output must change incompatibly gets a new name, and the old one
  is retired.
- The call context grants nothing. What the action reads, its pack
  injected.
- `input` and `output` are JSON Schema, so the same declaration gives a
  UI its form and an agent its tool.
- `register` returns a disposer; the action goes when its pack unloads.

## Calling one

```ts
ctx["action.invoke"].invoke({ action, input, authority, reason })
  → { ok: true, output, change? } | { ok: false, refused }
```

- Everything an action writes with `ctx.write`, including through actions
  it `call`s, becomes **one** change set, applied when the outermost action
  returns, all or nothing. Its header names the actor and run (from the
  calling context), the authority and reason (from the call), the
  outermost action, and the pack that registered it (from its context).
- The set goes down the graph's write chain (schema, history, store). A
  refusal anywhere comes back as `{ ok: false, refused }`, saying what
  would pass.
- An action that writes nothing makes no change set. Reading is fine.
- There are no holds. The call applies or is refused, and anything applied
  can be undone.

## A refusal says how to fix it

Edition 11. An input that doesn't fit the action's declared `input` is
refused with code `action.input`, and its `detail` is an `InputRefusal`:

```ts
{ fix: [{ path: "/title", expected: "a string", example: "42" }],
  input: { type: "work", title: "42" } }
```

- `path` is a JSON Pointer into the input (`""` the input itself,
  `/links/0/to`); `expected` says in words what the schema wants there
  (`a string`, `one of todo, done`, `not here: it takes …`); `example` is
  a value that would pass there, null for a key that should go.
- `input` is the input given with every fix applied: what a caller can
  send instead, once any `<placeholder>` is a real value.
- The message says the same in a line. An agent corrects its next call
  from it without guessing at the schema.

## Undo

`history.undo` is the one name the spec reserves. The history pack
provides it: given a change set id, it writes that set's inverse as a new
change set with `undoes` set. See [changeset](changeset.md).

## Who is calling

A caller never says who it is. The action pack reads it from the calling
context (`Caller` in common.ts): the pack is the context's own, and the
actor and run are metadata that interception set where the person or
agent came in. Sign-in intercepts a person's page with them as actor; the
Claude Code adapter makes one child context per run with the agent and the
run. A pack can't pass itself off as another or put words in a person's
mouth through the call. Only the authority and the reason vary call by
call, so only they are said.

## On a test's word

Edition 11. Some changes are neither a person's word nor an agent's
judgement: a check's result, written by the pack that runs it. A pack that
injects `action.attest` runs an action on a test's word:

```ts
ctx["action.attest"].invoke({ action, input, attest: { test, version }, reason })
```

- `test` is the id of the item that is the test; it must be on the graph.
  `version` is the version of the test's inputs its result is for, one
  word (a hash of them, say).
- The change set's actor is the test (`test:<id>`, of kind `agent`: no
  person decided it), and its authority is `of: "agent"` with basis
  `test <id> at <version>`. The header keeps its shape, so everything that
  reads change sets reads these; `attested(header)` gives the test and
  version back, and undefined for anyone else's change.
- Otherwise it is `action.invoke`: one change set, applied or refused
  whole, and undone like any other.
