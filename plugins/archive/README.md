# archive

Old maps kept read only. Each archive is a graph store of its own,
`<dir>/<name>.sqlite` in the server's data folder (`archives/`), opened
read-only: the store refuses to apply anything, and the plugin declares no
action. The agent's `get` and `query` tools read one when given its name as
`map` (through `mcp.maps`, [mcp/maps.ts](../mcp/maps.ts)); without `map`
they read the living map.

An archive is made offline, from its source, by `scripts/from-pelago.ts
archive`, and made again the same way: it is never changed in place. Its
items are mapped onto the bases like the living map's (`kind` names the old
type), so `type:`, `is:open` and `status:` mean the same in both, but every
field the old map had is kept.

Injects `mcp.maps`. Node only.
