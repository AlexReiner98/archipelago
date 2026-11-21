# harness

The harness view: one view of every run, live or replayed, and every
profile. What the map says to an agent is a tree of places and nodes; the
run looked at lights it, step by step. Three fills, linked through `here`;
the two beside show while the view does
(`when: { "here.view": "harness/view" }`).

| Fill | Region | Shows |
|---|---|---|
| Harness (`harness/view`) | `center` | The bar (run and its verdicts ✓ ✕ ○, profile, grouping), the tree, the timeline |
| Node (`harness/node`) | `left` | Its words, standing, places, pack, kind, record, and its verdict per run |
| Run (`harness/run`) | `right` | The run's profiles, then one line per event, → to the agent, ← from it; the wider side, as an opened line needs the room |

## Picking

- **Run:** `here.run`, else the newest. ● not ended, ○ ended.
- **Profile:** `harness.profile` (this pack's own page key), else the run's
  own. A profile picked shows over the tree what a run in only that
  profile would not hear (`profile.read.hears`), whatever run is shown.
- **Playhead:** `here.event`. Unset, the view follows the run's end live.

## The tree ([layout.ts](layout.ts), [canvas.ts](canvas.ts))

Every node in `agent.tree` hangs under one root at its first place: tool,
then the MCP server, then the tool; file, then its glob's top folders;
memory, then its scope; skill, then each part of its name. "pack" hangs it
from its pack and kind, "profile" from the profile it is in. Nodes said
nowhere show on "never said". Nodes kept or retired by the keep pack hang
from one "decided" bough as well, retired ones struck.

| Mark | Means |
|---|---|
| name blue | the run said it, by the playhead |
| name red | the run refused with it |
| faint, struck | a profile held it back (a `gated` event; or the profile picked) |
| dashed dot | only a shadow profile would have |
| ring | its verdict in the run (blue held, red failed, dashed quiet), once looked at to the end |
| dot hue | its pack: the map's words purple, what grow learned gold |
| hollow dot | its item is a trial |
| dot size, number | how often it was said, across runs |
| ↑ ↓ ⊝ | the keep pack's standing: promote, retire, held back by a check |

A step of the playhead runs a light from the root to its node (red for a
refusal), or sparks on the bough of an act's place (amber, red when it
failed). Under reduced motion only the names light. Drag to move, wheel to
zoom, double-click to fit; "key" shows the marks.

## The timeline ([timeline.ts](timeline.ts), [replay.ts](replay.ts))

One tick per event, in order: blue a say, red a refusal or a failed act,
amber an act, grey a hold, white the run's own. The map's ticks sit high,
the agent's low. Click or drag to move the playhead; ⏮ the start, ▶ plays
a step at a time, "● live" (or "■ end") follows the end again.

## The run ([events.ts](events.ts))

The line at the playhead is picked; those after it are faint. A click
opens a line in place ([expand.ts](expand.ts)): for the map to the agent,
the node, place, pack and what was said, whole; for the agent to the map,
the act's input and output field by field, each label over its value.
Each part folds past a dozen lines. A red edge: the event failed the node picked.

## The node ([node.ts](node.ts), [keep.ts](keep.ts))

Words made from a map item are edited through `words.set`, and the next
say uses them; any other node shows what it last said. A trial shows the
miss it came from and can be retired (`words.retire`). With the keep pack:
its record against the thresholds, its checks, Keep and Retire
(`keep.apply`). A node the map writes a file from shows the file and its
rule (`written.rule`).

Injects `slot.fill`, `here.*`, `agent.tree`, `exchange.read`,
`exchange.watch`, `verdict.read`, `action.list`, `action.invoke`,
`graph.read`, `graph.watch`, `profile.read`. Unloading it removes the three
fills, its page key and its styles. The pure parts are tested in
`test/harness.test.ts`.
