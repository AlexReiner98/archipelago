# First run

Everything runs on your own machine, in one process, with no build step.
You need Node 22.18 or later and Claude Code.

## Start it

```
npm install
npm run serve
```

Open http://127.0.0.1:5280/app/. The server's packs, the page's dev server
and the bridge between them run on 5280, 5281 and 5282. The map is kept in
`app/.data/`, which git ignores.

## Look around

- The view picker at the top switches views: **Landscape** (the map, home),
  **Sensory interface** (what is said to agents), **Packs** and this **Guide**.
- Ctrl+K (⌘K) opens the find line from any view: type a view's name or an
  item's, and Enter goes to it.
- Nothing is locked. Every change is an action, and `history.undo` takes
  any one back.

## Connect Claude Code

A map with no run opens on Field with what to copy: the MCP line and the
hooks for `~/.claude/settings.json`, for this server. Copy both, start
Claude Code in any repository, and the first run shows as it begins.

Or start one session against it, without touching your settings:

```
claude --settings packs/claude-code/settings.json --mcp-config packs/claude-code/mcp.json
```

The session's hooks report each prompt, tool call and answer to the
adapter, and its MCP server gives the agent the map's tools. Open
**Sensory interface**: the run appears live, with what the map said and where.
[packs/claude-code/README.md](../packs/claude-code/README.md) has the
details, and how to report every session.

## Next

Read [Concepts](concepts.md), then [Writing a pack](writing-a-pack.md).
