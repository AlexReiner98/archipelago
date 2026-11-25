# lint

Map lint: rules over the map's own items, judged by local functions, as a
[checks](../checks/README.md) domain. No service: each function reads the
item it checks, and what it needs around it, through the checks plugin's
tracked reader, so a test is solved again exactly when something it read
moves (a field, a page of links, the day). Not in the default tree; add
`{ id: "lint", plugin: "plugins/lint/index.ts" }` after `checks`.

Injects `checks.domain`, `action.register`, `graph.read`, `types.read`.

## Rules are map items

A rule is a `rule` item with `fn` one of lint's and `params`; its tests
are `test` items that `checks` an item and `applies` the rule. The
thresholds are data: change a rule's params (or preview a change with
`checks.preview`) and its tests are solved again.

| `fn` | Fails when | Params |
|---|---|---|
| `lint.has` | the item has no value in `field` (blank text is none) | `field` |
| `lint.linked` | it has fewer than `min` links of kind `link` (`out` from it, or `in` with `dir: in`); reads a page of only `min` | `link`, `dir`, `min` (1) |
| `lint.overdue` | it is more than `grace_days` past its `due`; reads the day | `grace_days` (0) |

Each also takes `statuses`: it checks an item only while its status is
one of them, and passes it otherwise (a done task needs no owner).

A finding carries `key`, its identity (`field:to_see`, `link:part_of:out`),
which lint gives the checks plugin as its `finding` hook: a decision on a
finding is carried while that finding is still found. `lint.linked` and
`lint.overdue` give their threshold to `checks.rejections` (`min` fails
below, `grace_days` above).

## Actions

| Action | Does |
|---|---|
| `lint.cover` `{ rule, type, limit?, after? }` | A test of the rule for each item of `type` that has none, one page at a time (`next` for the next) |

The functions are in [rules.ts](rules.ts), apart from the runtime. The
results show in the checks plugin's Checks view.
