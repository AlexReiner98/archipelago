# Archipelago (archipelago.tools)

Agent memory for human brains: your agent's plans and decisions as a map you read, correct, share.

With this plugin, Claude Code works the map over MCP: each session starts on the open
work the sessions before it left, keeps the map true as it goes, and leaves for you
what needs your word. You read the map, and correct it, in your browser at
[app.archipelago.tools](https://app.archipelago.tools).

Not the multiworld randomizer of the same name, at archipelago.gg.

It is early. I build it and use it every day, and it has rough edges.

## Sign in

After installing, run `/mcp`, choose `plugin:archipelago:map` and sign in to
your workspace in the browser. Claude Code keeps the sign-in; the plugin reads
nothing from your machine.

## What it adds

- The map's tools (`map`) at https://app.archipelago.tools/mcp.
- A skill, `archipelago`, that has the agent start each session on the map
  (handed the working rules and where your work stands), say what it takes on,
  and end the session with a summary.

It has no hooks, so it reports less than the full plugin: nothing is noted at
each prompt or turn's end, the agent is not told what you changed on the map
since it last looked, and a session the agent forgets to start is not on the
map. For all of that, install the full plugin with the one command on the
[install page](https://app.archipelago.tools/connect/install).

## What it sends

Everything goes to https://app.archipelago.tools/mcp and nowhere else, and only what the agent sends
through the tools: the session's folder and its git remote when it starts, and
what it reads and writes on the map. The plugin runs no script and reads no
file. The server is open source and MIT licensed: https://github.com/AlexReiner98/archipelago.

Privacy: https://app.archipelago.tools/x/legal/privacy
