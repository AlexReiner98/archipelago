# Profiles and the harness

The map speaks to agents through nodes: words said at a place, such as a
session's start or a tool call. The harness shows what was said and
whether it worked; profiles say which runs each node is for.

## Nodes and places

A node is an item on the map with its words and the places it listens at.
The agent service says it there, and the exchange records each say
([agent](../spec/agent.md)). The [words](../plugins/words/README.md) plugin
keeps nodes whose wording lives on the map.

## A run and its verdict

Each Claude Code session is a run. Its facts (its repository, its hub)
come from plugins such as [git](../plugins/git/README.md) and
[hub](../plugins/hub/README.md). When it ends, the
[verdict](../plugins/verdict/README.md) plugin judges whether each node said
in it worked.

## The Context interface

One view of every run, live or replayed: the tree of places and nodes,
lit by the run looked at, its events beside it, and the node picked on the
other side. See [plugins/harness/README.md](../plugins/harness/README.md).

## Profiles

Not every node fits every run. A profile holds nodes, and a run is in a
profile when its facts say so; a node is heard only by the runs it fits.
A node in no profile is heard by every run. A new profile starts in
`shadow`: it records what it would hold back, and holds nothing yet.
See [plugins/profile/README.md](../plugins/profile/README.md) and
[spec/profile.md](../spec/profile.md).
