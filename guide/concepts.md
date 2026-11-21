# Concepts

A few words carry the whole design. Each has a contract in
[the spec](../spec/README.md).

## Packs

Everything is a pack: the graph, the schema, the history, the UI. A pack
is a module with an `id`, an `about` line, the capabilities it needs
(`inject`) and an `apply` that registers what it adds. When it unloads,
everything it registered goes with it. Packs come, go and reload while
the system runs.

## Capabilities

A pack never names another pack. It asks for keys like `graph.read` or
`slot.fill`, and whichever pack provides each one now satisfies it. Until
every key is provided, the pack waits, inactive. The spec owns the keys
and versions them in editions.

## The config tree

Which packs run is a tree of entries: [app/tree.ts](../app/tree.ts) on the
server and [app/boot.ts](../app/boot.ts) in the page. An entry can be
turned off, and the loader reads it as a capability
([loader](../spec/loader.md)).

## The map

The graph holds items and links, and it is the truth. Kinds of item are
declared by packs ([types](../spec/types.md)). No pack owns a part of the
data: a grouping is a link or a query.

## Actions and history

Every change goes through a declared action, whether a person or an agent
makes it ([action](../spec/action.md)). The history pack writes each
change set in full, and undo applies its inverse. There are no gates:
every change applies, and anything can be undone.

## The agent service and the exchange

What the map says to an agent passes through one service at named places,
and the exchange records every say, refusal and act
([agent](../spec/agent.md), [exchange](../spec/exchange.md)). A verdict
per run says whether each node worked.

## The page

The page is made of slots that packs fill ([slot](../spec/slot.md)), in
regions of a frame ([frame](../spec/frame.md)). What is being looked at is
`here` ([here](../spec/here.md)), and every view shares one look through
style tokens ([style](../spec/style.md)).
