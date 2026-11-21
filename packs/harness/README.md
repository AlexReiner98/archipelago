# harness

The harness view: the hub to watch every agent at once, and every run,
live or replayed, and every profile. What the map says to an agent is a
tree of places and nodes. It lands on every live run: each agent has a tree
of its own, holding the nodes its profile lets it hear, under its name in
its colour and its profile, and what it is told colours that tree. Nothing
moves. Three fills,
linked through `here`; the two beside show while the view does
(`when: { "here.view": "harness/view" }`), and start folded to rails (the
frame's `folded` config in `app/boot.ts`), so the landing is the tree and
the agents only. Picking a node opens the node pane; a click on the
background, picking none, folds it.

| Fill | Region | Shows |
|---|---|---|
| Harness (`harness/view`) | `center` | The bar; live, a tree per agent; one run or all, the tree and the timeline |
| Node (`harness/node`, "Node") | `left` | Its words, standing, places, pack, kind, record, and its verdict per run |
| Run (`harness/run`, "Run") | `right` | The run's profiles, then one line per event, → to the agent, ← from it; the wider side, as an opened line needs the room. Live: every live run's events, interleaved. All runs: the runs, or a profile's |

## The bar ([bar.ts](bar.ts))

Kept quiet: the run picker, the live dot and the ✓ ✕ ○ tally. The profile
looked at, how the tree hangs (place, pack, profile), nodes never said,
the key and the view's dials ([dials.ts](dials.ts), ↺ to put one back)
are in one ⋯ menu.

## Picking

Every live run at once (where it lands), one run, or every run. The counts
and the ✓ ✕ ○ tally follow the choice. Runs come last active first (`exchange.read.runs`),
so a long run acting now is at the top, and the list reads again as events
come.

- **A run:** `here.run`, or the last active ("last active" sets
  `harness.live` to false). ● not ended, ○ ended. The counts
  are what that run said, up to the playhead; the tally, its verdicts; its
  holds, its own `gated` events. Picking a run anywhere (the node's runs,
  Activity) looks at it alone.
- **Live:** `harness.live` (this pack's own page key), "live" in the run
  picker, and what the view shows while nothing else is picked. Every run
  not ended, of the last 50 active, each in its own colour
  ([live.ts](live.ts)): the style's six hues, then round again mixed toward
  the text colour, then toward the page, so there is no limit and every
  colour is made of tokens. A run keeps its colour while it stays live. Each is an agent with a tree of its own (below). The right pane interleaves their events as they
  come (the last 300, nothing from before), each edged in its run's
  colour; a click looks at that run at that event.
- **All runs, or a profile:** `harness.all` (this pack's own page key). The
  counts and the tally are all time; the right pane lists the runs. A
  profile picked (`harness.profile`) is looked at this way, lists only the
  runs it has in it (`profile.read.of`, of the last 50), and shows over the
  tree what a run in only that profile would not hear
  (`profile.read.hears`).
- **Playhead:** `here.event`, in one run. Unset, the view follows the run's
  end live.

## The agents ([trees.ts](trees.ts), [tint.ts](tint.ts), [agents.ts](agents.ts))

Live mode and the agents are one idea: each live run is an agent, in the
colour live mode gives it, with a tree of its own. One is in focus, big,
with every name; the others are small previews in a column beside it, in
the order of their colours so each keeps its place, and a click on one
brings it into focus. The switch is smooth: the one clicked grows into
the big place while the old one shrinks into the column (a view
transition of the tree drawings, or a line's dot, only, each named by
its colour slot; headers and text change in place; `switch_s` seconds, at once under
reduced motion). Focus starts on the last active agent and stays
where it is put while that agent is live. Trees go to the agent in focus
and the three last active besides, as previews; every other live agent is
one line under the previews (its colour, name and profile), a click from
focus, and its tree grows out of its coloured dot, so a run that stopped without ending costs a
line, not a tree. The previews and lines scroll. Hearing is asked once per
set of profiles (`groupsOf`), not once per agent. Its
tree holds only the nodes it hears (`profile.read.hears`), hung as the big
tree is, with how many of all it hears. Small, a tree fits its dots to fill its cell
(`dotsBox`), and names only what is lit, what the agent was told, and
what is picked. Faint until it does
something while watched (one that stopped without ending stays live). A
click on the focused agent's name looks at it alone.

What an agent is told colours that node and its branch from the root in
the agent's colour, and they fade back. Nothing travels.

| Event | Coloured |
|---|---|
| say | its node and branch, in the run's colour; the name shows |
| refusal | the same, in `failed` |
| hold (`gated`) | the same, in `quiet` |
| act | the branch to the bough of its place (`failed` when it failed) |

Every number is a dial, in the bar's ⋯ menu: how long a branch keeps its
colour, how long the colour takes to come and go, and how long a switch
of focus takes. Their values are
`harness.dials` (page scope), so an agent can set them; the browser
remembers them. Colours are style tokens only. One run looked at alone
keeps its lights along the playhead.

Over each agent's tree, its profile from `profile.read.of`: ● the one it
matches, ○ the workspace's fallback (nothing else placed it), – none. A
click on it lists the profiles, and picking one moves the agent there
through the profile pack's `profile.place`, and its tree changes to match;
the page never writes itself.

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
| dot size, number | how often it was said: in the run, or all time |
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
picks its node for the node pane: its own, or for an act the node it
failed, else the node told just before it (`nodeOf`, replay.ts); and it
opens the line in place ([expand.ts](expand.ts)): for the map to the agent,
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

The node pane is open while a node is picked and folds to its rail when
none is (a click on the tree's background, from anywhere): the pack
takes `harness/node` out of the frame's page key `frame.folded`, or puts
it back (`foldForNode`).

Injects `slot.fill`, `here.*`, `agent.tree`, `exchange.read`,
`exchange.watch`, `verdict.read`, `action.list`, `action.invoke`,
`graph.read`, `graph.watch`, `profile.read`. Unloading it removes the three
fills, its page keys and its styles. The pure parts are tested in
`test/harness.test.ts`.
