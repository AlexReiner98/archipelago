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
| `rule` | `fn` (a function a domain knows by name), `params` |
| `test` | `result`, `findings`, `version`, `decision`, `decided_version`, `decided_findings`, `reads` |

A test `checks` one or more subjects (items of any base), `applies` a
rule, and may `needs` other tests (held acyclic, so the tests form a DAG).
`against` is the older name of a second subject, for a two-subject test.

## A domain

A domain pack injects `checks.domain` and registers, as its own effect:

| Key | What |
|---|---|
| `subject` | The type, or types, of item its tests check |
| `fns` | Or: the rule functions it judges, whatever the subject (looked at before `subject`) |
| `judge({ subject, other?, subjects, fn, params, read? })` | Answers `{ passed, findings }`; throwing is an `error` result |
| `stamp` | Only for a judge that can't read the graph: the subject's field that is its stamp (a hash of a file) |
| `limits()` | Optional: per rule `fn`, which param is its limit and which side fails (`below` or `above`) |
| `finding(f)` | Optional: a finding's identity (the face it is on, the field it names), or undefined. See below |

One domain per subject type and per function. A test no domain judges is
left as it is until one does.

## What a test's version is

**Recorded reads** (a domain with no `stamp`). The judge gets `read`, a
tracked reader over the graph: `get(ids)` (at most `LIMIT_MAX`),
`links(id, { type, dir }, { limit, after })` (one page), and `today()`.
Its subjects come through it too. Reading an item's field records that
field; listing its fields records them all; reading a page of links
records the page; reading the day records the day. At most 1000 reads a
call. The test keeps what was read, as keys, in `reads`, and its version
is the hash of the values read, its rule's `fn` and `params`, its
subjects' ids, and the version and result of each test it needs.

To tell whether a test's inputs moved, the checker reads the same keys
again (a replay: no judge) and compares. So a change to a field the judge
didn't read moves nothing, and a judge that follows links from its
subject to the items it is made of stamps all of them: a composite subject
is a judge that reads further.

**A declared stamp** (a domain with `stamp`), for a judge that can't read
the graph, such as a remote service. It is given snapshots of its
subjects, and the version is its rule's `fn` and `params`, the first
subject's stamp field (under that field's name), the `against` subject's
(`other`), any further subjects' (`also`), and what it needs. These stamps
are pinned in the tests: a map solved before keeps its versions.

## The checker

The checker watches rules, tests and their links, each declared-stamp
domain's subjects, and every change set for what a recorded test read
(looked up in memory; rebuilt from the tests' `reads` when a domain
registers). It checks the day once a minute and replays the tests that
read it when it turns. A change solves the tests it reaches and what needs
them, in order, and nothing else: each goes `pending` at its new version,
then `pass`, `fail`, `blocked` (incomplete, or a test it needs didn't
pass) or `error`, written through `checks.result` on the test's word at
its version (`action.attest`). When a domain registers, every test is
looked at once, and those whose stamp moved meanwhile are solved.

The checker is in [checker.ts](checker.ts), apart from the runtime.

## Actions

| Action | Does |
|---|---|
| `checks.decide` `{ test, decision }` | A person's `accepted` or `rejected` at the test's version; refused until it has a result. Cleared when the version moves, unless carried by finding (below) |
| `checks.rejections` `{ rule? }` | Per rule with decided tests: the findings rejected and accepted (a finding counts by its number `measured`), and the limit that would spare every rejection and still catch every acceptance (`proposal`, null when none does). Writes nothing |
| `checks.preview` `{ rule, params, judge? }` | Solves the tests the rule reaches, and what needs them, against `params`, in memory: each moved test's result before and after, whether it `flips`, and its findings. Writes nothing |
| `checks.result` | The checker's own write, called through `action.attest` |

The reading is in [rejections.ts](rejections.ts).

## The Checks view

Page side, [view.ts](view.ts): a view in `center`, `checks/results`
("Checks"), off in [app/boot.ts](../../app/boot.ts) until a server runs this
pack (`page.set { pack: "checks", on: true }`). Tests grouped by rule or by
subject, each with its result mark, its first finding (all of them on a
click), and accept and reject (`checks.decide`, as the person at the page).
Under a rule, `try` previews other params (`checks.preview`, at most 50
judge calls) and lists what would flip. It knows no domain: lint and any
other show the same way.

What it shows is page keys, so a view item composes it as data:

| Key | What |
|---|---|
| `checks.query` | Which tests, in find's query; default `type:test` (`type:test in:<id>` for one hub's) |
| `checks.group` | `rule` (default) or `subject` |
| `checks.show` | The results to show, such as `["fail", "error"]`; absent, all |

For example, a view item with `center: "checks/results"` and `here:
{ "checks.group": "subject", "checks.show": ["fail"] }` is "what fails,
item by item". The bar's chips set the same keys. It reads the map through
find's index and writes only through actions.

Injects (page) `find.index`, `here.declare`, `here.read`, `here.set`,
`slot.fill`, `action.invoke`.

## Decisions per finding

Without a `finding` hook, a decision is cleared whenever the test's
version moves. With one, `checks.decide` also keeps the identities of the
findings decided on (`decided_findings`; refused if one has none), and
when the version moves the decision is kept, at the new version, while
the result is the same (`pass` or `fail`) and every finding decided on is
still found by identity; new findings beside them don't clear it. Else it
is cleared. A decision on a pass decides on no findings: it is carried
while the test passes.

## Previews cost judge calls

A preview is a solve over an overlay of the graph kept in memory
([preview.ts](preview.ts)): the proposed params stand in for the rule's,
and every result goes to the overlay, never the map. Like a live solve, it
judges only the tests whose stamp would move; unlike one, the results are
thrown away, so the same preview twice judges twice. With a judge that
costs (a paid service, a slow one), pass `judge`: at most that many calls,
the rest left `pending` and counted in `held_back` (and what needs them
with them). `judge: 0` judges nothing and says which tests would be.
