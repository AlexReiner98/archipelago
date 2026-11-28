# hub

The items a run's task is part of, at any depth (at most 8 steps), as the
run's `hub` fact ([spec/agent.md](../../spec/agent.md#facts)). A link from a
hub (a profile's `uses`) then says something about every run that works
under it, wherever it runs.

At `compact` its node `hub/task` ("This run's task") names the task, by
title, id and status, and the nearest three items it is part of, so the
summary written at a compaction keeps what the run took on (`taskWords`).
A run with no task hears nothing there.

Injects `agent.facts`, `agent.node` and `graph.read`.
