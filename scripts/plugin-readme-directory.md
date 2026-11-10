# {title}

{summary}

With this plugin, Claude Code works the map over MCP: each session starts on the open
work the sessions before it left, keeps the map true as it goes, and leaves for you
what needs your word. You read the map, and correct it, in your browser at
[app.archipelago.tools]({app}).

{not}

It is early. I build it and use it every day, and it has rough edges.

## Sign in

After installing, run `/mcp`, choose `plugin:archipelago:map` and sign in to
your workspace in the browser. Claude Code keeps the sign-in; the plugin reads
nothing from your machine.

## What it adds

- The map's tools (`map`) at {mcp}.
- Three hooks, each a call to those same tools, with no script: at your first
  prompt the session is started and handed the working rules and where your work
  stands; each later prompt is told what you changed on the map since; at the
  end of each turn the map is told the turn ended. After `/clear` the new
  session starts the same way.

## What it sends

Everything goes to {mcp} and nowhere else:

- what Claude Code hands each hook: the session's id, its folder, and the text
  of each prompt you send;
- what the agent itself reads and writes on the map through the tools.

It reads no transcript, no git and no file. The server is open source and MIT
licensed: {repository}.

Privacy: {privacy}
