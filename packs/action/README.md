# action

The one way anyone changes anything. Provides `action.register`,
`action.list` and `action.invoke` ([spec](../../spec/action.md)); injects
`graph.commit`, and should be the only pack given it.

- A name must start with the registering pack's id; a taken name is refused.
- Who called is the calling context's: the actor and run interception set,
  else `pack:<id>` as the actor. The header's pack is the one that
  registered the outermost action.
- What an action and the actions it `call`s write is one change set,
  committed when the outermost returns, or nothing. A refusal anywhere comes
  back as `{ ok: false, refused }`.
- Input is checked only for its `required` keys; full schema checks are the
  schema pack's.
