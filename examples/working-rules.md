# Working with Archipelago in this project

This project's work is kept in Archipelago: a map of people, work and what waits
on what, used by the owner and by agents through the same tools (the
`pelago` MCP tools). The map is the record of where the work stands. Keep it
true as you go; do not keep a second record in files or in the chat.

## At the start

1. `view` with name `handoff` and `repo` (the id the session hook gave). One
   answer holds the last push, the handoff note, what has happened since it
   was written, and the open work. Where the note and the lists disagree, the
   lists are right. If it has `for_owner` with questions settled on an
   agent's own judgment, show the owner those in your first reply and ask
   them to confirm or correct; record their answer with `confirmed`.
   If the session opened with no word from Archipelago, the
   hooks did not run here (the setup was run in another folder): call
   `session_start` with `cwd` and the repository's `remote` yourself, and
   tell the owner to run the setup in this repository's own folder.
2. Say what you take on: `session_update` with the item's id as `task`. If it
   has no estimate, give it one (`tokens_estimated` in its props: input and
   output, not counting cached re-reads). What is used is measured for you.

## While you work

- **Tell the story as you go.** Each time you conclude something (a cause,
  a finding, a choice and why), `tell` it: one sentence, the items it is
  about, and the ties between them you want seen. The owner reads the beats
  on your session's page beside a drawing of those items. Tell what matters,
  not every step; take a beat back with `replaces` when you change your mind.
- **Change the map when the work changes it.** A task done, a decision made
  in practice, a problem found: change its status with what happened and the
  evidence. Do not leave it open with a note.
- **Say on whose authority.** Every `change` takes `authority`: `of: "human"`
  with what the owner said and where, or `of: "agent"` for your own reading.
- **A name is a few words.** A title is 60 characters at most; the rest goes
  in the first line of the note. Lead a note with the point, and give each
  further part a short title on a line of its own.
- **Search before you create.** `search` first, so nothing is made twice.
- **Say who is waited on with a relation.** Other work is `depends_on`; a
  person who has to answer or act is `waits_on` (what for in `props.for`),
  removed once they have; a resource is `needs`, and an exclusive one is
  taken with `claim` and given back with `release`.
- **Name what a change makes by its ref.** `{ref}` in a title or note becomes
  the id of the item the same change makes.
- **Give a hub its views.** An item that holds a lot is the hub of its
  problem, and the owner reads it through its views: each a `lens` item
  linked `about` it, named for the question it answers (`place` for its
  order; `kinds`, `far`, `over` for what is in it; `controls` for what the
  owner may change on the page). A lens whose `from` is another item is a
  shortcut to there. Give a project its views when you make it, if the owner
  says what they want to see; the session start and `view` `hubs` name the
  hubs that have none. While a project is still being shaped, set its
  `hub_at` to 1: nearly everything in it is then a hub.
- **Correct a refused change, do not resend it.** The refusal gives a name:
  send `change` with `retry` and `fixes` for the ops that were wrong.
- **If a pelago tool answers with a web page or "502",** the server is
  restarting. Do not send the call again through MCP: each such answer is a
  whole page in your context. Wait until `GET /health` on the server answers,
  then send it as plain JSON (`POST /agent/<tool>` with the agent token from
  the environment, never printed).
- **When Archipelago gets in your way,** record it with the `pelago-bump` skill
  when it happens. That is how it gets fixed.

## Before you finish

1. Bring the handoff note up to date: only what the map cannot know (what
   nobody has seen working, what bites when working here, what you would do
   next and why), one of each part. Replace what is there, do not add a
   second "next" beside the first: the note is 3,000 characters at most.
2. `session_end` with a summary. It lists what is still open here that nobody
   changed: change each, name it in `still_true` if you checked it, or in
   `cannot_tell` if you had nothing to do with it (`cannot_tell_rest: true`
   for all the rest).

You are an agent, not the owner: what needs the owner's decision stays open
for them, and you never approve, reject or manage tokens yourself.
