# mcp

The tools every harness gives an agent to work with the map. They are
added to the adapter's MCP server through `mcp.host` ([host.ts](host.ts)),
which the adapter provides, so they know no harness. They know bases and
field kinds, never a type's name: a flavour needs no tool and no words.

Injects `mcp.host`, `graph.read`, `graph.watch`, `types.read`,
`action.register`, `action.list`, `action.invoke` and `exchange.read`.

| Tool | Takes | Does |
|---|---|---|
| `hear` | `place` | What the nodes say at a place (`file:spec/agent.ts`, `tool:Bash`); a refusal is an error result |
| `act` | `action`, `input`, `reason`, `authority?` | Any declared action, as the agent in its run: `items.create`, `items.set`, `items.link`, `items.unlink`, `history.undo`, ... One call is one change set; its id comes back for undo. Without `input`, what the action takes |
| `get` | `ids` (≤ 50), `links?`, `map?` | Items whole, with their base and their links, each with the item at its other end (≤ 50 an item) |
| `query` | `find`, `walk?`, `limit?`, `map?` | The find line of the map ([query.ts](../find/query.ts)): words in titles, `is:open`, `is:closed`, `type:` (a type or a base), `status:`, `in:<id>`, `near:<id>`, `id:<id>`. `walk` (`over`, `dir`, `steps` ≤ 5) follows links from what is found. Items as id, type, title and status, the links among them, and how many more (`limit` 30, at most 200) |
| `tell` | `said`, `about?`, `replaces?` | What the agent concluded: the action `mcp.tell`, a record (kind `said`) with `about` links, in one change set; `replaces` supersedes an earlier one |
| `run` | `title?`, `task?`, `parent?`, `end?` | What the run is, on the exchange: `agent.run`'s `begin` again, which keeps when it began; `end` ends it. A harness without hooks begins its run this way |

`map` names another map to read instead of the living one: an old map kept
read only ([archive](../archive/README.md)). A pack adds such a map through
`mcp.maps` ([maps.ts](maps.ts)), a pack-own key this pack provides; a name
not known is answered with the names there are. Nothing writes to them.

Writes go only through actions, in the run's context: the journal's header
names the agent and the run.

## The descriptions are nodes

What a tool's description says is said to the agent, so it is a node like
any other: a `node` item of kind `tool_text` at the tool's place
(`tool:mcp__archipelago__get`), made through `words.add` the first time the
pack loads with the words pack there, and found again after that. The tool
list says its words now, so `words.set` refines a description and the
harness view shows and judges it; the words pack also says it where the
agent is about to call the tool. Retired, or with no words pack, the
defaults in [index.ts](index.ts) are said. `act`'s description adds the
actions declared now.

The descriptions are short on purpose. The old map's tools grew long
passages steering agents between types; with bases and flavours, a
refusal says what would pass (the statuses of a type, its fields, the kinds
of link), and that is said only when it is needed.

## The query's copy

`query` reads a copy of the map: every item and link of a type defined
now, read in bounded pages through `graph.read` and kept live by
`graph.watch`, as the page's find pack does.
