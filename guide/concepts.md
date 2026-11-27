# Concepts

A few words carry the whole design. Each has a contract in
[the spec](../spec/README.md).

## Plugins

Everything is a plugin: the graph, the schema, the history, the UI. A plugin
is a module with an `id`, an `about` line, the capabilities it needs
(`inject`) and an `apply` that registers what it adds. When it unloads,
everything it registered goes with it. Plugins come, go and reload while
the system runs.

## Capabilities

A plugin never names another plugin. It asks for keys like `graph.read` or
`slot.fill`, and whichever plugin provides each one now satisfies it. Until
every key is provided, the plugin waits, inactive. The spec owns the keys
and versions them in editions.

## The config tree

Which plugins run is a tree of entries: [app/tree.ts](../app/tree.ts) on the
server and [app/boot.ts](../app/boot.ts) in the page. An entry can be
turned off, and the loader reads it as a capability
([loader](../spec/loader.md)).

## The map

The graph holds items and links, as the log of change sets makes them:
the log is the truth, and the graph's tables are its projection. Kinds of item are
declared by plugins ([types](../spec/types.md)). No plugin owns a part of the
data: a grouping is a link or a query.

## Actions and history

Every change goes through a declared action, whether a person or an agent
makes it ([action](../spec/action.md)). The history plugin writes each
change set in full, and undo applies its inverse. There are no gates:
every change applies, and anything can be undone.

## The agent service and the exchange

What the map says to an agent passes through one service at named places,
and the exchange records every say, refusal and act
([agent](../spec/agent.md), [exchange](../spec/exchange.md)). A verdict
per run says whether each node worked.

## The page

The page is made of slots that plugins fill ([slot](../spec/slot.md)), in
regions of a frame ([frame](../spec/frame.md)). What is being looked at is
`here` ([here](../spec/here.md)), and every view shares one look through
style tokens ([style](../spec/style.md)).
