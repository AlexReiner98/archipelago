# Working with Archipelago in this project

This project's work is kept in Archipelago: a map of people, work and what waits
on what, used by the owner and by agents through the same tools (the
`pelago` MCP tools). The map is the record of where the work stands. Keep it
true as you go; do not keep a second record in files or in the chat.

The tools are few. `query` reads, `change` writes, `undo` takes a change set
back, and every other action is called under its verb (`capture`, `assign`,
`report`, `ask`, `settle`, `revise`) by its name, with its inputs as
`params`: `report` with action `tell`. Each verb's description lists its
actions; `query` with name `actions` gives their inputs whole.

## At the start

1. Handed a task, `query` with name `brief` and params `task`: it holds what that
   task needs. Otherwise the session start says where things stand: `query`
   with name `frontier` reads it again (the open items the sessions before you
   here worked on, each with why it needs attention now); `query` with no name
   lists the views this map has, and `search` with `open: true` finds the open work. If the session start puts
   questions settled on an agent's own judgment to the owner, show them in your
   first reply and ask the owner to confirm or correct; record their answer
   with `settle`, action `confirmed`.
   If the session opened with no word from Archipelago, the
   hooks did not run here (the setup was run in another folder): call
   `capture` with action `session_start`, params `cwd` and the repository's `remote` yourself, and
   tell the owner to run the setup in this repository's own folder.
2. Say what you take on: `report` with action `session_update` and the
   item's id as `task`. If it
   has no estimate, give it one (`tokens_estimated` in its props: one number,
   input and output together, not counting cached re-reads). What is used is measured for you.

## While you work

- **Tell the story as you go.** Each time you conclude something (a cause,
  a finding, a choice and why), tell it (`report`, action `tell`): one sentence, the items it is
  about, and the ties between them you want seen. The owner reads the beats
  on your session's page beside a drawing of those items. Tell what matters,
  not every step; take a beat back with `replaces` when you change your mind.
- **Name an item to a person as [its name](link),** never a bare id; ids stay
  in tool calls. `link` is the pattern the session start answers with.
<!-- working_rules: the setup puts the instruction presets said here, one bullet each -->
- **Give a hub its views.** An item that holds a lot is the hub of its
  problem, and the owner reads it through its views: each a `lens` item
  linked `about` it, named for the question it answers, holding its query
  (`filter`, `walk`, `limit`) and how it is drawn (`style`). Give a hub
  its views when you make it, if the owner says what they want to see; the
  session start and `query` `hubs` name the hubs that have none.
- **If a pelago tool answers with a web page or "502",** the server is
  restarting. Do not send the call again through MCP: each such answer is a
  whole page in your context. Wait until `GET /health` on the server answers,
  then send it as plain JSON (`POST /agent/<tool>`, the same ten tools, with
  the agent token from the environment, never printed).
- **When Archipelago gets in your way,** record it with the `pelago-bump` skill
  when it happens. That is how it gets fixed.

## Before you finish

1. What you built and nobody has seen working: say so on the item
   (`seen_working` false, and in `to_see` what would show it). Nothing else is
   written down for the next session: what is left unpushed is read off the
   checkout.
2. `report` with action `session_end` and a summary. It lists what is still open here that nobody
   changed: change each, name it in `still_true` if you checked it, or in
   `cannot_tell` if you had nothing to do with it (`cannot_tell_rest: true`
   for all the rest).

You are an agent, not the owner: what needs the owner's decision stays open
for them, and you never approve, reject or manage tokens yourself. A held
change of your own that a newer one covers you withdraw (`revise`, action
`withdraw`): that decides nothing.
