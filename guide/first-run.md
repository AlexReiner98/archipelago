# First run

Everything runs on your own machine, in one process, with no build step.
You need Node 22.18 or later and Claude Code.

## Start it

```
npm install
npm run serve
```

Open http://127.0.0.1:5280/app/. The server's plugins, the page's dev server
and the bridge between them run on 5280, 5281 and 5282. The map is kept in
`app/.data/`, which git ignores. It writes the skill and memory files you
adopt onto the map, so a change made there is what the next session loads;
`npm run dev` is the same server without writing them.

The map lasts as long as that folder. To try it, anywhere will do; for a
map you mean to keep, clone into a folder you choose and keep, and run the
live copy from there (the README, "Set it up to keep"). The server says so
when it starts in a folder that goes away: the system's temp folder, one an
app made for one session, or a session's own worktree.

## Look around

- The view picker at the top switches views: **Landscape** (the map, home),
  **Context interface** (what is said to agents), **Plugins** and this **Guide**.
- Ctrl+K (⌘K) opens the find line from any view: type a view's name or an
  item's, and Enter goes to it.
- Nothing is locked. Every change is an action, and `history.undo` takes
  any one back.

## Connect Claude Code

A map with no run opens on an empty canvas, with one line: **Connect Claude
Code in <folder>**. Click it, start a new Claude Code session in the folder
(a terminal or the desktop app), and the first run shows as it begins. It
puts the map's hooks and MCP server into the folder's
`.claude/settings.local.json` and `.mcp.json`, kept out of git, as a
`connection` item on the map: undo, **disconnect**, or shutting the server
down (Ctrl+C) takes them out; after a crash, they stay until it next starts. Under `npm run dev`, which writes no files, the line is
instead the one session that writes nothing:

```
claude --settings plugins/claude-code/settings.json --mcp-config plugins/claude-code/mcp.json
```

A session that connected without the hooks (only the MCP server) is told so
by the map, and asks you to restart it with them.

The session's hooks report each prompt, tool call and answer to the
adapter, and its MCP server gives the agent the map's tools. Open
**Context interface**: the run appears live, with what the map said and where.
[plugins/claude-code/README.md](../plugins/claude-code/README.md) has the
details, and how to report every session.

## Next

Read [Concepts](concepts.md), then [Writing a plugin](writing-a-plugin.md).
