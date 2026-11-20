# action 0.1.0

Every change goes through a declared action, whether a person or an agent
makes it. A UI never writes directly; a tool an agent calls is an action;
a pack changing data does it through an action too. Types:
[action.ts](action.ts).

## Declaring one

```ts
actions.register({
  name: "verdict.judge",
  version: "1.0.0",
  title: "Record whether each node held in a run",
  input: { type: "object", properties: { run: { type: "string" } }, required: ["run"] },
  async run({ run }, ctx) {
    const said = await ctx.graph.of("said", { limit: 200 });
    ctx.write([["+", "e_v1", "type", "verdict"], ["+", "e_v1", "run", run]]);
    return { judged: said.items.length };
  },
});
```

- `name` starts with the pack's id. A second registration of a taken name
  is refused, never silently replaced.
- `input` and `output` are JSON Schema, so the same declaration gives a
  UI its form and an agent its tool.
- `register` returns a disposer; the action goes when its pack unloads.

## Calling one

```ts
actions.invoke({ action, input, actor, authority, reason, run? })
  → { ok: true, output, change? } | { ok: false, refused }
```

- Everything an action writes with `ctx.write`, including through actions
  it `call`s, becomes **one** change set, applied when the outermost action
  returns, all or nothing. Its header names the actor, authority, reason,
  the outermost action and the pack that provides it.
- The set goes down the graph's write chain (schema, history, store). A
  refusal anywhere comes back as `{ ok: false, refused }`, saying what
  would pass.
- An action that writes nothing makes no change set. Reading is fine.
- There are no holds. The call applies or is refused, and anything applied
  can be undone.

## Undo

`history.undo` is the one name the spec reserves. The history pack
provides it: given a change set id, it writes that set's inverse as a new
change set with `undoes` set. See [changeset](changeset.md).

## Who is calling

`actor` and `authority` are what the caller says. Without a sandbox, the
service can't prove them; the adapter that brings a person or agent in
(sign-in, the Claude Code adapter) is where they're set, and the record is
what makes misuse visible.
