# Working with Lattice in this project

This project's work is kept in Lattice: a map of people, work and what waits
on what, used by the owner and by agents through the same tools (the
`lattice` MCP tools). The map is the record of where the work stands. Keep it
true as you go; do not keep a second record in files or in the chat.

## At the start

1. `view` with name `handoff` and `repo` (the id the session hook gave). One
   answer holds the last push, the handoff note, what has happened since it
   was written, and the open work. Where the note and the lists disagree, the
   lists are right.
2. Say what you take on: `session_update` with the item's id as `task`. If it
   has no estimate, give it one (`tokens_estimated` in its props: input and
   output, not counting cached re-reads). What is used is measured for you.

## While you work

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
- **When Lattice gets in your way,** record it with the `lattice-bump` skill
  when it happens. That is how it gets fixed.

## Before you finish

1. Bring the handoff note up to date with `append` or `replace`: only what the
   map cannot know (what nobody has seen working, what bites when working
   here, what you would do next and why).
2. `session_end` with a summary. It lists what is still open here that nobody
   changed: change each, name it in `still_true` if you checked it, or in
   `cannot_tell` if you had nothing to do with it.

You are an agent, not the owner: what needs the owner's decision stays open
for them, and you never approve, reject or manage tokens yourself.
