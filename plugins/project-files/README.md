# project-files

Not a plugin: the shared writer that plugins use to put what is on the map
into files that belong to someone else, a project's
`.claude/settings.local.json`, its `.mcp.json`, git's exclude. Two writers
use it: [lean](https://github.com/AlexReiner98/archipelago-loop/blob/main/lean/README.md)'s, for what a context filter leaves out,
and [connect](../connect/README.md)'s, for a connected folder's hooks and
MCP server. Both can write into the same file, and neither touches the
other's entries.

| File | What it is |
|---|---|
| [entries.ts](entries.ts) | The rules, pure: an entry is an item of a list, a key of an object, or a line, and a file is brought to what is wanted of ours. Tested in `test/project-files.test.ts` |
| [write.ts](write.ts) | The I/O: `bringTo` passes over every file wanted or in the ledger, `safeFolder`, and the ledger kept between loads |

## The rules

- **Only its own.** An entry the file had before is never claimed or taken
  out, and one the person took out or changed by hand is theirs from then on.
- **Back as it was.** Taking out what is ours leaves the file as it was: a
  list or object we left empty goes, and a file (and folder) we made goes
  when nothing is left in it.
- **Only a safe folder.** Absolute and there; never the home folder or one
  above it, a drive's root, or anything under `~/.claude`.
- **A ledger.** What was added to each file is kept in the writer's data
  folder, so a later pass, an unload or a crash takes out exactly that.
- **A file that isn't what it should be** (not a JSON object) is left alone
  and reported.
