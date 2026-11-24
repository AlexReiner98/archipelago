# action

The one way anyone changes anything. Provides `action.register`,
`action.list`, `action.invoke` and `action.attest` (edition 11)
([spec](../../spec/action.md)); injects `graph.commit`, and should be the
only pack given it, and `graph.read`, to find an attestation's test.

- A name must start with the registering pack's id; a taken name is refused.
- Who called is the calling context's: the actor and run interception set,
  else `pack:<id>` as the actor. The header's pack is the one that
  registered the outermost action.
- When the reserved `history.undo` ran in the call, the header's `undoes`
  is the `change` it was given.
- What an action and the actions it `call`s write is one change set,
  committed when the outermost returns, or nothing. A refusal anywhere comes
  back as `{ ok: false, refused }`.
- An input is checked against the action's declared `input` before it
  runs ([input.ts](input.ts)): `type`, `required`, `properties`,
  `additionalProperties`, `items`, `enum` and `const`; anything else
  (`anyOf`, `$ref`, bounds) passes here. One that doesn't fit is refused
  `action.input`, its message each path and what it wants, its `detail`
  an `InputRefusal` (edition 11): a fix per path (`path`, `expected`,
  `example`) and the input with every fix applied. An example is what was
  given turned into the wanted kind where that is plain (`"3"` to 3, one
  value to a list of it), else the schema's `examples`, `default` or first
  `enum`, else a `<name>` placeholder; a key the schema shuts out is
  dropped. `fixLine` and `fixIn` write it after a refusal's words and read
  it back, for the mcp pack and the harness.
- `action.attest` runs an action on a test's word: the actor is
  `test:<id>` and the authority's basis `test <id> at <version>`. It is
  refused (`action.attest`) when the test isn't on the graph or the
  version is missing. The item page's history marks such a change ▲ with
  the version.
