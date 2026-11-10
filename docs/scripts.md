# Scripts

What is in `scripts/`, by what it is for. Each script's own first lines say how to run it, with its arguments; this
page is where to find the one you need. Every `.ts` script is type-checked with the rest (`npm run typecheck`).

## Tests

| script | what it does |
| --- | --- |
| `test.ts` | the tests as a set: `npm test`, `test:full`, `test:changed`, `shard k/n`, `unprivileged` (`test/sets.ts`) |
| `test-weights.ts` | the seconds each test file takes, into `test/weights.json`, from CI (`ci`) or here (`local`) |

## Running and filling a map

| script | what it does |
| --- | --- |
| `demo.ts` | `npm run demo`: a server of its own on a small map of Archipelago itself |
| `demo-approvals.ts` | `npm run demo:approvals`: a second demo, a planning file with changes held for review |
| `gen-map.ts` | a year-three map generated from a seed, for timing at scale |
| `principles.ts` | `npm run principles`: the facts a principle's page draws that live in code, read onto the map |
| `publish-diagrams.ts` | `npm run diagrams:publish`: this checkout's diagrams put on a map, after a push to main |

## Connecting a project

| script | what it does |
| --- | --- |
| `pelago-setup.mjs` | connects a project to a server, or takes it out again (served at `/connect/setup.mjs`) |
| `pelago-install.mjs` | connects this computer's agents (Claude Code, Codex, Cursor) in one go; what `/connect/install`'s one line runs (served at `/connect/install.mjs`) |
| `pelago-login.mjs` | the machine's one browser sign-in, kept in ~/.pelago: `sign-in`, `headers` (the plugin's tools), `call` (before the tools load) |
| `pelago-hook.mjs` | the Claude Code hook that tells the map about a session |
| `pelago-events.mjs` | a session's events, read from its hooks and transcript, for the hook to send |
| `pelago-sdk-runner.mjs` | a sketch: one prompt on the Claude Agent SDK, its session told to the map |

## Timing

| script | what it does |
| --- | --- |
| `bench-scale.ts` | `npm run bench:scale`: the views at year-three size, in one command |
| `bench-views.ts` | the heavy reads and a typical write, end to end, against a running server |
| `bench-log.ts` | the log at size, read and written as the server does (`docs/log.md`, section 9) |
| `bench-rebuild.ts` | `npm run bench:rebuild`: the projections rebuilt from the log at scale |
| `measure-plan.ts` | what the limits per plan (`src/plan.ts`) rest on, measured on a copy of a map |
| `hero-bench.ts` | how soon the landing page's hero is on screen over a slowed network |

## Looking at drawings and pages

| script | what it does |
| --- | --- |
| `look.ts` | a page as a reader sees it, kept as a PNG for an agent to read |
| `stable-page.ts` | whether an item's page stays still while agents write to the map under it |

## Pictures and fonts

| script | what it does |
| --- | --- |
| `emblems.ts` | the emblem drawn once per theme, kept on the theme as a PNG |
| `ridges-svg.ts` | a ridges picture baked as SVG from the Ridges style's code and a saved setup |
| `text-widths.ts` | the width table the server measures text by (`src/text-widths.ts`) |

## Evaluations

| script | what it does |
| --- | --- |
| `reader-eval/` | `npm run eval:reader`: the push reader replayed on each candidate model and scored, naming a default (`main.ts`) |
