# checks

Rules and tests on the map, kept true to what they check by a forward
checker, and a person's accept or reject of each result. It does not know
what a subject is: a domain pack plugs that in. Not in the default tree;
add `{ id: "checks", pack: "packs/checks/index.ts" }` after `items`, and a
domain pack after it.

Injects `types.define`, `types.acyclic`, `action.register`,
`action.attest`, `graph.read`, `graph.watch`; provides its own
`checks.domain`.

## On the map

| Type | Fields |
|---|---|
| `rule` | `fn` (a function the judge knows by name), `params` |
| `test` | `result`, `findings`, `version`, `decision`, `decided_version` |

A test `checks` a subject, `applies` a rule, may check it `against` a
second subject, and may `needs` other tests (held acyclic, so the tests
form a DAG).

## A domain

A domain pack injects `checks.domain` and registers, as its own effect:

| Key | What |
|---|---|
| `subject` | The type of item its tests check |
| `stamp` | The subject's field that goes into a test's stamp (a hash of a file, a revision) |
| `judge({ subject, other?, fn, params })` | Answers `{ passed, findings }`; throwing is an `error` result |
| `limits()` | Optional: per rule `fn`, which param is its limit and which side fails (`below` or `above`) |

One domain per subject type. A test whose subject no domain judges is left
as it is until one does.

## The checker

A test's version is the stamp of its inputs: its rule's `fn` and `params`,
its subject's stamp field, the other subject's (only for a two-subject
test), and the version and result of each test it needs. The checker
watches rules, tests, their links and each domain's subjects. A change
solves the tests it reaches and what needs them, in order, and nothing
else: each goes `pending` at its new version, then `pass`, `fail`,
`blocked` (incomplete, or a test it needs didn't pass) or `error`, written
through `checks.result` on the test's word at that version
(`action.attest`). When a domain registers, every test is looked at once,
and those whose stamp moved meanwhile are solved.

The checker is in [checker.ts](checker.ts), apart from the runtime.

## Actions

| Action | Does |
|---|---|
| `checks.decide` `{ test, decision }` | A person's `accepted` or `rejected` at the test's version; refused until it has a result. Cleared when the version moves |
| `checks.rejections` `{ rule? }` | Per rule with decided tests: the findings rejected and accepted (a finding counts by its number `measured`), and the limit that would spare every rejection and still catch every acceptance (`proposal`, null when none does). Writes nothing |
| `checks.result` | The checker's own write, called through `action.attest` |

The reading is in [rejections.ts](rejections.ts).
