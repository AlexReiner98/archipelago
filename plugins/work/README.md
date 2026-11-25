# work, question, record, actor, links

The map's four bases and five links ([spec/types.md](../../spec/types.md)),
one plugin each, so any one can be turned off or replaced. Each injects
`types.define` and nothing else.

| Plugin | Base | Open | Closed | Fields it adds |
|---|---|---|---|---|
| work | work | todo, doing | done, dropped | kind, priority, due, seen_working, to_see, tokens_estimated, tokens_used |
| question | question | open | decided, dropped | kind, options, outcome, rationale, decided_on |
| record | record | current | superseded | kind, value, unit, as_of, published |
| actor | actor | active | inactive | kind (person, agent) |

`links` defines `part_of`, `depends_on`, `waits_on` (to an actor, with
`for`), `bears_on` (to a question) and `about`.

The fields are the ones Focus uses today; its other types land as these
bases plus a field or a flavour (task → work, decision → question,
finding → record with `kind: finding`). Waiting is a `waits_on` link, not a
status.
