# call

One request to a model, made by a pack (a domain's judge explaining a
finding), recorded as a run of its own on the exchange, under the run that
made it. Provides its own `call.ask`. Injects `agent.run`, `exchange.read`,
`graph.read`, `graph.watch` and `action.register`.

```
parent run ── call run (harness: "call", parent)
                begin ─ say at its places (the umwelt's nodes) ─ reply act ─ end
                                         later: decision act (a person) ─▶ verdict
```

## `call.ask(start, ask)`

| `start` | |
|---|---|
| `title` | A name for the call (a rule's function) |
| `places` | Where the map speaks to it: `check:<fn>`, `finding`, or any place of the open vocabulary |
| `parent` | The run that made it. Absent: the calling pack's own run of calls (`calls:<pack>:…`, titled "`<pack>` calls"), begun at its first call and ended when this pack unloads |
| `facts` | More facts: `fn`, a test's id |
| `follow` | `{item, version}`: an item whose decision at this version judges the call (a checks test) |

It begins the run (`harness: "call"`, `parent`), reaches the places through
`agent.run`, so what is said there is chosen as it is for an agent: nodes
listening there, held back by gates (the [profile](../profile/README.md)
pack's umwelts), each say on the exchange. `ask` gets the run and what was
said (`{node, text}`), sends it with its request, and answers `{text,
subject?, usage?}`. The answer is a `reply` act at `reply_end`: its output
the text and the model's own count (`usage`: input, output, model), its
input only the subject's **type and size** (`{subject: {type, tokens}}`):
the domain's own context never reaches the exchange. A throw is a failed
reply (`ok: false`, the error's words) and is thrown on. The run always
ends.

## Decisions

A call that follows an item is followed: when the item's `decision`
(`accepted` or `rejected`) is set with `decided_version` at the call's
version, the call's run is begun again, a `decision` act by the person at
`reply_end` is recorded (rejected: `ok: false`), and it ends again
([spec/agent.md](../../spec/agent.md), edition 11). A change of mind is
recorded too; the same decision twice is not. The
[verdict](../verdict/README.md) pack judges every node said to the call by
the last one: rejected fails them, accepted holds them. On load, the newest
200 runs' calls are followed again.

| Action | Input | Does |
|---|---|---|
| `call.decide` | `run`, `decision` | Records a decision in a call's run by hand; refused for a run that isn't a call. Writes nothing in the graph |

## In the window

The [context](../context/README.md) pack counts a call's subject as a
source of its own (`subject`, one part per type, its tokens as given), and,
with no transcript, the answer's `usage` as the model's own total.
Tested in `test/call.test.ts`.
