# harness

The Context interface: how each agent senses the landscape around it, and how it
reaches back into it. (The pack's id, its page keys and its fills keep the
name `harness`; the view was called Harness until 21 Nov 2026, and Sensory interface until 23 Nov 2026.) It is the
hub to watch every agent at once, and every run, live or replayed, and
every profile. What the map says to an agent is a
tree of places and nodes. It lands on every live run: each agent has a tree
of its own, holding the nodes its profile lets it hear, under its name in
its colour and its profile, and what it is told colours that tree. Nothing
moves. Two fills, linked through `here`; the run pane shows beside the
view while it does (`when: { "here.view": "harness/view" }`), folded to
its rail at the start (the frame's `folded` in app/boot.ts), so the tree
has the room; a click on the rail opens it. Inside the view, one bar on the left holds the previews, or,
while a node is picked, the node in their place; a click on the
background, picking none, brings the previews back.

| Fill | Region | Shows |
|---|---|---|
| Context interface (`harness/view`) | `center` | The bar; live, a tree per agent; one run or all, the tree and the timeline. Its left bar: the previews, or the node picked (its words, standing, places, pack, kind, record, and its verdict per run) |
| Run (`harness/run`, "Run") | `right` | The run's profiles, then one line per event, → to the agent, ← from it; the wider side, as an opened line needs the room. Live: the events of the agent in focus, opening in place as one run's do. All runs: the runs, or a profile's |

## The bar ([bar.ts](bar.ts))

Kept quiet: the run picker, the live dot and the ✓ ✕ ○ tally. The profile
looked at, how the tree hangs (place, channel, pack, profile), nodes never said,
the harness's given nodes and the view's dials ([dials.ts](dials.ts), ↺ to put one back)
are in one ⋯ menu.

## Picking

Every live run at once (where it lands), one run, or every run. The counts
and the ✓ ✕ ○ tally follow the choice. Runs come last active first (`exchange.read.runs`),
so a long run acting now is at the top, and the list reads again as events
come.

- **A run:** `here.run`, or the last active ("last active" sets
  `harness.live` to false). ● live, ○ past. A run is named by its title
  (Claude Code's is its first prompt that says something), else its
  folder (`runName`, spec/agent.ts). The counts
  are what that run said, up to the playhead; the tally, its verdicts; its
  holds, its own `gated` events. Picking a run anywhere (the node's runs,
  Activity) looks at it alone.
- **Live:** `harness.live` (this pack's own page key), "live" in the run
  picker, and what the view shows while some run is live and nothing else
  is picked (with none live, it lands on the last active). Every run not
  ended and heard from within `quiet_min` minutes (15, as Activity counts
  live), of the last 50 active, each in its own colour: a session archived
  or killed without ending its run drops to the past runs
  ([live.ts](live.ts)): the style's hues but the warm `hue-2` and `hue-4`, too near Claude Code's orange (an agent's lights would read as Claude Code's; a spark also has a white-hot core), then round again mixed toward
  the text colour, then toward the page, so there is no limit and every
  colour is made of tokens. A run keeps its colour while it stays live. Each is an agent with a tree of its own (below). The right pane shows the
  events of the agent in focus (`harness.focus`, this pack's own page
  key), the whole run, each line opening in place as in one run.
- **All runs, or a profile:** `harness.all` (this pack's own page key). The
  counts and the tally are all time; the right pane lists the runs. A
  profile picked (`harness.profile`) is looked at this way, lists only the
  runs it has in it (`profile.read.of`, of the last 50), and shows over the
  tree what a run in only that profile would not hear
  (`profile.read.hears`).
- **Playhead:** `here.event`, in one run. Unset, the view follows the run's
  end live.

## From a context filter ([open.ts](open.ts))

A context filter's item page (the Landscape or the Map, a click on the
item) has a button into its view here, in the item pack's `item.actions`
slot: with a session live in the filter, "Watch its live session", which
opens the live view focused on it; with none, "Its context", which opens
the filter's own tree (`openFilter`).

## The agents ([trees.ts](trees.ts), [agents.ts](agents.ts))

Live mode and the agents are one idea: each live run is an agent, in the
colour live mode gives it, with a tree of its own. An agent's tree is drawn
once both where it is placed and what it hears are known (`heardYet`), and
"No agent is live" only once the runs are read: the view never shows every
node, or none, before its filter's tree. One is in focus, big,
with every name; the others are small previews in a column to its left, in
the order of their colours so each keeps its place, and a click on one
brings it into focus. The switch is smooth: the one clicked grows into
the big place while the old one shrinks into the column (a view
transition of the tree drawings, or a line's dot, only, each named by
its colour slot; headers and text change in place; `switch_s` seconds, at once under
reduced motion). Focus starts on the last active agent and stays
where it is put while that agent is live: it is pinned in
`harness.focus`, so another agent acting never moves it. Trees go to the agent in focus
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

What an agent is told runs a light from the root along its tree to that
node, in the agent's colour (red for a refusal), and the name lights when
the light gets there; an act sparks on the bough of its place. The light
and spark are the tree's own (see the tree, below). When a node comes or
goes, the tree glides into its new shape over `layout_ms` (600; each node's
angle and ring eased, a new one growing out of its parent: `glide` in
[glide.ts](glide.ts)), and a light already running
reads its route from the tree as drawn each frame, so it follows its branch.

The dials, in the bar's ⋯ menu: how long a switch of focus takes
(`switch_s`), how long the pointer rests on a node or a bough before its
words show beside it (`tip_ms`, 0 for never), how many sizes names
take per doubling while the tree zooms (`name_steps`, 0 for every size),
the size on screen below which a node's name shows only if the run said
it, refused with it, or it is picked (`quiet_px`, 0 for every name, as it starts),
the most characters a name shows (`name_most`, 28; 0 for whole),
whether wire names give way where they overlap (`give_way`, 0: they always show),
how long and how big an act's spark is (`spark_s`, 1.6; `spark_x`, 2.2 times the style's), how long a new line of the run is lit as it lands (`row_ms`, 600: a background that fades, painted rather than composited, as an opacity fade on each new row made Chrome show half-drawn frames; the list glides to its foot rather than jumping, and an MCP tool's place reads `tool:archipelago.query`, `placeLabel`), how tall each agent preview is (`peek_px`, 200, its column a third wider, opening from nothing over `open_s` as a second agent arrives), so
a tree seen whole reads by its shape and what it was told, and how long a run may be
quiet and still be live (`quiet_min`). Its value is `harness.dials` (page scope), so an agent can
set it; the browser remembers it. Colours are style tokens only.

Over each agent's tree, its profile from `profile.read.of`: ● the one it
matches, ○ the workspace's fallback (nothing else placed it), – none. A
click on it lists the profiles, and picking one moves the agent there
through the profile pack's `profile.place`, and its tree changes to match;
the page never writes itself.

## The tree ([layout.ts](layout.ts), [canvas.ts](canvas.ts), [scene.ts](scene.ts), [paint.ts](paint.ts))

The view is titled with the context filter the run is in (or "no context
filter"), over the top of its tree with the filter's mark beside it. When
the Landscape has said how it draws that item's type (the page key
`field.marks`), the tree's root is drawn as that mark, its shape in its
colour, so the filter looks the same in both views.

Every node in `agent.tree` hangs under one root at its first place: tool,
then the MCP server, then the tool; file, then its glob's top folders;
memory, then its scope; skill, then each part of its name. "channel" hangs
it from how it reaches the agent, then who it is from (the map's pack, or
who in the harness said it); "pack" from its pack and kind, "profile" from
the profile it is in. Nodes said
nowhere show on "never said". Nodes kept or retired by the keep pack hang
from one "decided" bough as well, retired ones struck.

| Mark | Means |
|---|---|
| name blue | the run said it, by the playhead |
| name red | the run refused with it |
| faint, struck | a profile held it back (a `gated` event; or the profile picked) |
| dashed dot | only a shadow profile would have |
| ring | its verdict in the run (blue held, red failed, dashed quiet), once looked at to the end |
| dot hue | its pack: the map's words purple, what grow learned gold; never `hue-2`, too near Claude Code's orange |
| hollow dot | its item is a trial |
| orange dot, name and branch | given by the harness (Claude Code), not the map: read only (below) |
| hollow orange dot | a given tool or MCP server no run counted used ([used](../used/README.md)) |
| dot shape | drawn bigger than a plain dot, and never under 4 px on screen however far out the zoom (`shapeRadius`): its channel ([channels.ts](channels.ts)): ● hook, said at a moment by a hook; ◆ rule, a check that can refuse (a rule, the schema's refusal); ■ file, a skill or memory file the harness loads; ▲ context, there from the start (system prompt, tool definitions, MCP instructions, listings); ⬢ talk, the conversation since (prompts, replies, thinking, tool calls and results, notes) |
| dot size, number | how often it was said: in the run, or all time |
| ↑ ↓ ⊝ | the keep pack's standing: promote, retire, held back by a check |
| soft halo | in the agent's window at the playhead: said since the last compaction, or there from the start (the window, below) |
| dotted ring | only named in a listing (skills, agents, deferred tools): the thing itself loads when it is used |
| slash | dropped by a compaction: said before it, not since |

A step of the playhead runs a light from the root to its node (red for a
refusal), or sparks on the bough of an act's place (amber, red when it
failed). Under reduced motion only the names light. Drag to move, wheel to
zoom, double-click to fit; a press picks a node by its name, or anywhere
within 22 px of its dot (`HIT_PX`). The key ([key.ts](key.ts)) is always
there, bottom left of one run's tree or the agent in focus: collapsed by
its head ("key ▸") to one line of the marks that filter until it is
opened, or open, every mark with its words; the browser remembers which, and what its marks have turned off ([keyoff.ts](keyoff.ts)), so a view switch keeps both. It lists only the marks
the tree in sight shows (`marksIn`): a new user's key is who and how, and
held-back, shadow, verdict and trial marks join it as they appear. Its
rows stand in titled sections, each a line apart, with what it means in
its tooltip: "in this run" (said, refused, acted, held back), "in the
window" (in it now, listed only, dropped), "how sure" (a number
measured, fitted to the model's real counts `~`, partly fitted `~≈`, or
estimated `≈`), "judged"
(verdicts, trial nodes), "from" (the map's or Claude Code's), "how it
reaches the agent" (the five channels) and "made by" (each pack's colour,
named plainly: "the map's words", "learned from a miss", "skills & memory
loaded", "what changed since" for the since pack, and so on). The key doubles as a
filter, open or collapsed: a click on a
channel's row, on "the map's", or on Claude Code's orange hides those nodes
from the trees (struck while hidden), and a second click shows them again
(`shows`, [channels.ts](channels.ts)). Claude Code's row is the same switch
as "given" in the ⋯ menu. A node's text that the server doesn't answer for
says so after 15 seconds, with "try again".

Names on the tree are cut to `name_most` characters with an ellipsis (28,
a dial; 0 for whole: a long name otherwise shrinks the whole tree out of
reading, 23 Nov 2026), the whole title in its words, and never show a path: a path is said as
whose it is, after a dot (`nameOf`, `placeName`): its project's folder,
and the file when it isn't the usual CLAUDE.md or MEMORY.md, so
"project memory · archipelago-next", "auto memory · Aperture". The whole
title is in its words, shown beside it when the pointer rests on it. Names run along their rays (a leaf's outward, a bough's inward), but a bough straight off the root is named level over its dot, as the Landscape names it, so the root's boughs' names never meet at the root. The big tree's camera fits its names too (the layout's measured box), so
every name is in sight; a preview fits its dots. Every tree fits when
first laid out, again when it outgrows the view (a profile that hears
more, Claude Code's nodes shown again, a smaller window), and on a
double-click; a fit lands at once while the tree is still finding its size
(the first, and any within `fit_settle_ms`, 800, `snapsFit`), and a later one glides there over `fit_ms` (eased, the
zoom in proportion, `easeView`), so the tree is seen to settle, and the
wheel's zoom eases to where it sends the camera over `wheel_ms`, so its notches glide; once moved by hand it stays where it is put, and the map
changing under it never moves it otherwise (`shouldFit`, `outgrown`).

The names on the wires (a bough's, along its branch) grow and shrink with
the zoom, and always show, in the text's colour over a halo of the page,
so they read over the wires (23 Nov 2026: they must be clear and visible).
With the `give_way` dial at 1 they give way instead ([labels.ts](labels.ts)): one that overlaps a
node's name or dot, a bough's dot, the root or a wire name nearer the
root fades out over a quarter second, and comes back when zoom clears it.
Each is tested by its turned outline, worked out from its measured text,
only against what shares its cells of a 64 px grid.

Every tree, big or a preview, is painted on one 2D canvas, as the
Landscape is ([paint.ts](paint.ts)): no element per node. What it draws is
a scene ([scene.ts](scene.ts)), made again only when what it shows changes:
each branch, then each node in the tree's order (its window mark, verdict
ring, dot and name, so a later dot covers an earlier name), the root, then
the lights ([lights.ts](lights.ts)). Which colour a dot or a name takes
where marks meet is decided there (`dotInk`, `nameInk`), rule for rule as
the style sheet decided it for the SVG this replaced. Colours are the
style's tokens, resolved once and again when the style changes.

Moving and zooming paint each frame from the camera, and only what is in
view. A turned name drawn at a new size has every letter drawn anew, so
while the zoom changes each name is a picture instead, drawn upright once
into one atlas at one of `name_steps` sizes per doubling (4) and turned
into place ([sprites.ts](sprites.ts)); at rest the names are text again; the wire names are placed again once it settles (140 ms after the
last, `SETTLE_MS`). A live event paints the tree again, never a diff of its
nodes. The camera's pure parts are in [camera.ts](camera.ts).

## The window ([windowbar.ts](windowbar.ts))

With the context pack ([context](../context/README.md)), a bar along the
foot of the agent in focus, and of one run's tree, says how full its context window
is at the playhead, or live (`context.window`): the tokens in it of the
window's size and the share that is, "≈" when it is an estimate (no usage
in the transcript yet), and how many compactions. It starts open; its
head ("window ▾") folds it to that one line, and the browser remembers
which (`harness.window-open`). Before the window is read it keeps its
room, open or folded, so the tree above never moves when it comes. Live,
it is read again as events come, at most every 3 s; an event inside that
time reads once the time is up, and a read in flight is kept unless the
run or the moment looked at changed, so a busy session's bar keeps up. Under it two thin rows
on the window's one scale: its share by source (the map's, Claude Code's,
the conversation, and what the model counts beyond those), and by channel
(hook, rule, file, context, talk), each channel in a hue of its own
(`CHANNEL_HUE`). A share's tooltip says its tokens, its
part of the window, and how sure: each number carries its mark (`~`
fitted, `~≈` partly, `≈` estimated, none measured), and a share's bar is
solid for what is fitted and faded for what is estimated. A click on a share filters the tree to
it through the key's filter: only the map's, or only hooks; a second click
shows everything again, and the other row stays as it was. The conversation
filters to the talk nodes; what isn't counted apart has no nodes, so no
filter.

A third row is what the map controls alone, node by node (`mapShares`):
each of its nodes said, or only listed (faded), in the window at the
playhead, in the hue of the channel it came in by (a node beside another of
the same hue a shade darker, so each shows), biggest first, on a scale of round steps just
above the map's whole share (250, 500, 1k, 2.5k…: `stepScale`), so a
session's start is part full and the row grows as the map says more,
headed by that share, its scale and its part of the window. The
biggest four are named under it, named as the tree names them, never a
path, and the rest counted; each a click to pick the node, outlined while
picked. Live, the
window is read again as events come, at most every 3 seconds; at a
playhead, once. Each node's state there is its mark on the big tree (the
table above); the small previews draw none.

## The timeline ([timeline.ts](timeline.ts), [replay.ts](replay.ts))

One tick per event, in order: blue a say, red a refusal or a failed act,
amber an act, grey a hold, white the run's own. The map's ticks sit high,
the agent's low. Click or drag to move the playhead; ⏮ the start, ▶ plays
a step at a time, "● live" (or "■ end") follows the end again.

## The run ([events.ts](events.ts))

Three or more held-back lines in a row at one place (what other context
filters keep from this run) fold into one line, "63 held back from this
run ▸", which a click opens (`foldHeld`): a run in a map of
many filters reads from its start.

The line at the playhead is picked; those after it are faint. New lines
keep the list at its foot only while it is at its foot (`atFoot`):
scrolled up to read, it stays where it is. A click
picks its node for the node pane: its own, or for an act the node it
failed, else the node told just before it (`nodeOf`, replay.ts); and it
opens the line in place ([expand.ts](expand.ts)): for the map to the agent,
the node, place, pack and what was said, whole, then, for a Claude Code
run, "agent got": the whole block the hook handed the agent at that moment,
each node's words under its tag and in the adapter's order, rebuilt with
the adapter's own formatting ([got.ts](got.ts), packs/claude-code/context.ts);
for the agent to the map,
the act's input and output field by field, each label over its value.
Each part folds past a dozen lines. A red edge: the event failed the node picked.
A say is led by "re-said ·" when it came again after a compaction, and by
"reworded ·" when its node said other words earlier in the context (the
agent pack's `reworded`); what a run heard and was told changed is the
node "Changed since heard" (`words/changed`).

## What the harness gave ([given.ts](given.ts))

With the transcript pack ([transcript](../transcript/README.md)), each
agent's tree, and one run's, also holds what Claude Code gave it: the
system prompt, each tool's definition, each MCP server's instructions, the
skill, agent and deferred tool listings, the model, and other hooks'
context, each at its place (`transcript.given`). They are the run's own
(id `transcript/<run>#<name>`), plain, named with who said
them (a tool's definition by its bough), and counted apart over the tree
("72 / 72 + 65"). They are orange (the style token `harness`), not a
pack's hue, and so is every bough that holds nothing else (`givenOnly`):
what the map supplies and controls keeps its colour, and what Claude Code
does on its own reads as orange; a bough both speak on (`tool:Bash`) stays
the map's. Their shape is their channel, as for the map's nodes: a hook's
context a circle, everything else a triangle (context). Picked, the left bar shows who gave it, where, how often,
and its text, read only and folded (`transcript.text`). "given · by the
harness" in the ⋯ menu hides them. The run's `transcript` fact is a path,
so it is never shown.

The conversation since the start is nodes too, from the same pack: your
prompts, Claude's replies and thinking, each tool's calls and its results
(hung at that tool's place, beside its definition), Claude Code's notes
and a compaction's summary, each a hexagon (talk). A run from a machine the server can't see (its hook
sent the transcript as numbers) has every node, but its words stay where it
ran: the pane marks it "⌂ on its machine", with why in its tooltip, and
reads no text. Picked, one says how
many pieces and tokens it holds, how many are in the window and how many
a compaction dropped, and its latest 20 pieces' text.

Every node, the map's, the harness's or the conversation's, shows in the
node pane its share of the window over the run (`context.node`,
[trend.ts](trend.ts)): how much is in it at the playhead or now, its peak
and what compactions dropped, a step chart across the run (the fitted or
estimated tokens it held, the peak of each stretch faint behind, each
compaction a dashed line, the playhead a solid one), and its latest
pieces, each with its time and tokens, struck once dropped. Without the
context pack, none shows.

A tool's definition or a server's instructions also shows, from the used
pack, in how many of the newest runs it was given and used ("used in 3 of
40 runs · 36k letters"; an MCP tool's server too), and is a hollow dot on
the tree when none used it. With the lean pack, one a profile the run is in
would leave out is marked as a shadow's hold ("would leave out · Focus"),
and as held once it is written into the run's project settings; "leave
out" records the profile's plan (`lean.set`) and "bring back" clears it
([use.ts](use.ts), [lean](../lean/README.md)). Without those packs neither
shows.

## The node ([node.ts](node.ts), [keep.ts](keep.ts))

Words made from a map item are edited through `words.set`, in a box as
tall as they are (it grows as you type, never a scroll bar), and the next
say uses them; any other node shows what it last said. A trial shows the
miss it came from and can be retired (`words.retire`). With the keep pack:
its record against the thresholds, its checks, Keep and Retire
(`keep.apply`). A node the map writes a file from shows the file and its
rule (`written.rule`). A map node said at session start shows how,
"said": whole, or listed (one line there, its whole words at its other
places or from the words tool); a click flips it (`words.say`).

The node shows in the view's left bar while one is picked, in place of
the previews (or, one run looked at, beside the tree), under a way back:
"‹ Agents" (or "× Close", one run looked at). It gives way to them when
none is picked: that, or a click on the tree's background.

Injects `slot.fill`, `here.*`, `agent.tree`, `exchange.read`,
`exchange.watch`, `verdict.read`, `action.list`, `action.invoke`,
`graph.read`, `graph.watch`, `profile.read`. Unloading it removes the three
fills, its page keys and its styles. The pure parts are tested in
`test/harness.test.ts`.
