# written

The map writes the skills and memory files the harness loads (20 Nov
2026: adopting the map means putting your skills into it). Adopting a file
makes it a node on the map, said at the place the harness loads it; from
then on the file is written from the node's words, so a change through
`words.set` is what the next session loads. Injects `graph.read`,
`graph.watch` and `action.register`. Server only.

| File | Place |
|---|---|
| `<…>/skills/<name>/SKILL.md` | `skill:<name>`, `skill:<plugin>:<name>` inside a plugin |
| `~/.claude/CLAUDE.md` | `memory:user/~/.claude/CLAUDE.md` |
| `<…>/CLAUDE.md`, `<…>/.claude/CLAUDE.md` | `memory:project/<path>` |
| `<…>/CLAUDE.local.md` | `memory:local/<path>` |
| `~/.claude/projects/<p>/memory/MEMORY.md` | `memory:auto/<path>` |

Nothing else is written: settings, hooks and permissions decide what an agent
may run unasked. Of a skill, only its SKILL.md is the map's; the folder's
other files stay as they are.

## Nodes

A node is a graph item of type `node` (the [words](../words/README.md)
plugin's, which says it), with `file` (what it writes) and `was` (the file's
text when it was adopted).

| Action | Does |
|---|---|
| `written.adopt` `{ paths?, scan?, refine?, why? }` | Makes a node for each file (or skill folder) named, or found by `scan` (`user`, `plugins`, `project`). Held as written unless `refine` is `open`. A file adopted again gives the map its text. |
| `written.rule` `{ node, refine, why? }` | Opens a node to refinement inside the map, or holds it as written |

The `loaded` item at the same place is marked `adopted`, so the map's node
is the one said there ([loaded](../loaded/README.md)).

## Rules: refined or held

Per node, `held` (a reason) says it is held as written: `words.set` and
`words.retire` refuse, and the refusal says why. Without `held`, it may be
refined inside the map, by the learning loop or an agent. Adopting holds a
file unless asked otherwise. Changing the rule is itself an action,
recorded with who did it and on whose authority, like any change.

## Who writes a file

One writer per file:

- The old map (the archipelago repository's hook) writes only files that
  carry its mark (`<!-- Written from the map`), in checkouts of its own
  repository, and never over a file without the mark. This plugin never
  adopts a file with that mark, so it stays the old map's.
- This plugin writes a file only over what it last wrote or found there, or
  over `was`. A file changed outside the map (by hand, or by another
  writer) is left as it is and reported, until it is adopted again.

## Writing is an effect

As each change commits, the file is written with the node's words; undoing
the change writes the words it restores. When the plugin unloads, every file
it wrote goes back to `was`, unless it changed since. Loading again writes
the map's words.

## Placing

`written.place` (a plugin-own key, [place.ts](place.ts)) lets another plugin
say where a node's file goes instead: `placer({ name, files(node) })`,
asked in config-tree order, the first answer deciding; `changed()` places
every node again. A copy is written only where nothing is or over what this
plugin wrote; the node's own file is taken away only while it holds the map's
words, and put back when no placer says otherwise or the plugin unloads. The
[placed](../placed/README.md) plugin is one placer.
