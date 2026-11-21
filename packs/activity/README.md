# activity

What agents are doing and what they changed, newest first, with an undo
on each change set. Page side. Two fills over one store:

| Fill | Region | Shows |
|---|---|---|
| Activity (`activity/view`) | `center` | Each run with the change sets it made; changes made outside a run, grouped by who made them |
| Status | `bottom` | The live runs, whether the page reaches the server, and the newest change with its undo |

Marks: ● a live run (begun or heard from in the last 15 minutes), ◌ open
but quiet (not ended, nothing heard: a session left open or one that
stopped without saying so), ○ ended, ◇ changes outside a run. A change
set: ● it stands, ↶ it undoes another, ⊖ undone (and by which set).
Under it, each item it touched: + made, − removed, ~ fields set, with
their new values (∅ cleared).

- Runs come from `exchange.read` (50), change sets from the journal's
  `history.list` (100 a page, "older changes" for the next). Both follow
  live: `exchange.watch` for runs, `graph.watch` for changes. Titles of the
  items touched are read by id through `graph.read`.
- Undo runs `history.undo` through `action.invoke`, on the person's
  authority; on an undo the button says redo. A refusal shows under the
  set, such as `graph.conflict` when a later change moved the same field.
  People write nothing else here.
- Runs that changed nothing and aren't live are hidden behind "+ N quiet".
- It meets the harness through `here.run`: a run picked here is the run the
  harness shows, and `⇢ harness` opens it there. The harness shows what was
  said and done in a run; this shows what it changed. An item opens on the
  Map (`here.item`).
- The connection is the bridge client's own key `bridge.link`
  ([bridge](../bridge/README.md)).

The grouping and lines are pure ([model.ts](model.ts)), tested in
`test/activity.test.ts`. Injects `slot.fill`, `here.*`, `exchange.read`,
`exchange.watch`, `graph.read`, `graph.watch`, `action.invoke`,
`bridge.link`. Unloading it removes both fills and its styles.
