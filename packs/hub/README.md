# hub

The items a run's task is part of, at any depth (at most 8 steps), as the
run's `hub` fact ([spec/agent.md](../../spec/agent.md#facts)). A link from a
hub (a profile's `uses`) then says something about every run that works
under it, wherever it runs. Injects `agent.facts` and `graph.read`.
