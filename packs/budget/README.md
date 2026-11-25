# budget

A run past its estimate is asked once. Today an overrun is seen only
afterwards; this asks the agent while it can still say why. Learned from
Pydantic AI's usage limits, which stop a run at a token or cost limit:
here nothing is stopped, the agent keeps going and hears it. Injects
`exchange.read`, `agent.node`, `action.register`, `action.list`,
`action.invoke`, `graph.read` and `profile.read`.

| Step | How |
|---|---|
| Spend | The run's measured tokens, from the [transcript](../transcript/README.md) pack's `transcript.tokens` (usage rows, paged): input, cache writes and output, not cached re-reads, as the work base's `tokens_estimated` counts them. Nothing reads transcripts: no spend, no ask. |
| Estimate | The `tokens_estimated` of the run's task (its `task` fact). No task or no estimate: no ask. |
| Ratio | The first context filter the run is in ([profile](../profile/README.md)) whose `budget_ratio` is set, else the pack's config `ratio`, else 1.5. |
| Ask | The node `budget/ask` refuses at `reply_end` with the code `ask` once spend passes estimate × ratio, so the agent keeps going and hears why ([spec/agent.md](../../spec/agent.md#places)). Once per run: a refusal of its own among the run's events keeps it quiet, across restarts. As the grow pack's, an asking refusal is not a miss to the verdict pack. |
| Show | The read-only action `budget.spend` (`runs`, at most 50): each run's `spent`, `task`, `estimate`, `ratio`, `over`, `asked`, and `none` when no transcript was read. The [harness](../harness/README.md) shows it on each run's row and the run pane's head. |

## Config

```ts
{ id: "budget", pack: "packs/budget/index.ts", config: { ratio: 2 } }
```

## What the agent hears

> Before you finish: this run has spent 320k tokens, 1.6× its task's
> estimate of 200k (…), past the 1.5× this run is asked at. Say in one line
> why it ran over and whether the rest is worth it; if the estimate was
> wrong, set the task's tokens_estimated. You are asked once in this run.
