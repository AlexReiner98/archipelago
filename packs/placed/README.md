# placed

A profile's skills load only where they fit. A skill node the written pack
writes (`<…>/skills/<name>/SKILL.md`) that some run doesn't hear is written
into the folders of the runs whose holding profiles hold it, as
`<cwd>/.claude/skills/<name>/SKILL.md`, and its own file (in the home
folder, where every session loads it) is taken away. It answers through the
written pack's `written.place`; the written pack writes, and undoes it when
this pack unloads.

- Folders are the `cwd`s of runs seen. A folder that is gone is skipped.
- Nothing moves while no run is denied the skill: a profile in shadow
  denies nothing.
- A run in no profile hears every node, but a file can't follow a run: its
  folder gets no copy.
- Each copy is kept out of git through the repository's `info/exclude`,
  never a tracked file. This repository also ignores `.claude/skills/`.

Injects `written.place`, `profile.read`, `exchange.read`, `exchange.watch`,
`agent.tree`. Server only.
