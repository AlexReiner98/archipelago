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
- **Keep the map true.** When what you do or find settles something still open (a task done, a decision made in practice, a question answered), change its status in the same breath, with the outcome and the evidence, rather than leaving it open with a note. Settle only what the work or the owner has in fact settled: closing a decision waits for the owner unless this workspace applies agents’ changes as made, so propose it with what was chosen (props.outcome) and why (props.rationale). A choice that is still the owner’s stays open.
- **Say on whose authority.** Every change takes authority: of "human" with what the owner said and where, when they told you to or decided it; of "agent" for your own reading of the work. Never claim the owner’s word for your own judgment.
- **A name is a few words.** A title names the thing in 60 characters at most; the rest goes in the first line of its note. Lead a note with the point in two or three sentences, and give each further part a short title on a line of its own, so it folds. Write it in the map's one dialect, which every page reads alike: ## titles, - points, - [ ] and - [x] checklists, > [!NOTE] or > [!WARNING] callouts, | tables |, `code`, **strong**, and an item named by its id (e_...) or as [its name](e_...).
- **Search before you create.** Query with name search first, so nothing is made twice.
- **A result is items and a view.** Anything with parts goes on the map as items first, never as one long note: a plan, research, an evaluation, a comparison. A plan: each step a task, part_of its hub, its order as depends_on, who must act as waits_on. Research: each finding and each option an item that bears_on the question it answers (anything else it informs, it is about), what it rests on as depends_on, its facts as fields or a short note. Then a view about the hub (a lens linked about it: shape flow for steps, a drawing of how the parts connect for an explanation), and show it. A plan's flow walks works_on< too, so each session at work on a step is drawn on it; once the owner approves the plan, show that view with watch: true, so every session started for its steps shows its work there rather than in a tab of its own. The hub's note holds only the point: why, what done is, what was found or chosen. This holds whatever a brief says about notes.
- **A finding is what an island stands by, in one line.** Its title is the claim as a sentence, value the fact (a number takes its unit), with its confidence and as_of; its note says how it was found, three lines at most. Mark it published (props.published: true) only when the island stands by it, a few per island: only those are read from other islands. An option is an alternative, a bug is a bug, and working research stays research.
- **Say who is waited on with a link.** A person who has to answer or act is waits_on (what for in props.for), removed once they have; other work is depends_on; a resource is needs, and an exclusive one is taken with assign, action claim, and given back with revise, action release.
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
