# git

A run's repository as facts ([spec/agent.md](../../spec/agent.md#facts)).
A fact source reads the run's `cwd` with git:

| Fact | |
|---|---|
| `remote` | origin as `host/owner/name`: steadier than the folder, which worktrees and machines change |
| `branch` | the branch checked out |
| `repo` | the map's item for the remote (the flavour `repo` of record), made through `git.repo` the first time a run is seen there |

A `remote` the run's start already gave is used as it is, and git doesn't
read the folder for it: the Claude Code command hook reads origin where the
session runs and sends it (`git_remote`), so a server on another machine
still finds the repo item.

A link from the repo item says something about every run in it (a profile's
`uses`). Injects `agent.facts`, `graph.read`, `graph.watch`,
`types.define`, `action.register`, `action.invoke`. Server only.
