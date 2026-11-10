# {title}

{summary}

With this plugin, Claude Code works the map over MCP: each session starts on the open
work the sessions before it left, keeps the map true as it goes, and leaves for you
what needs your word. You read the map, and correct it, in your browser at
[app.archipelago.tools]({app}).

{not}

It is early. I build it and use it every day, and it has rough edges.

## Install

```
claude plugin install archipelago --marketplace AlexReiner98/archipelago
```

The first session opens your browser once, to sign in to your workspace. The
sign-in is kept in `~/.pelago` on your machine, readable only by you, and
never written into a project.

## What it adds

- The map's tools (`pelago`) at {mcp}, or at the
  server `PELAGO_URL` names.
- Hooks on a session's start, each prompt, the end of each turn and of the
  session, and each tool call.
- The working rules the agent reads at the start (`pelago.md`), and a skill,
  `pelago-bump`, for recording where Archipelago itself got in the way.

## What it sends

Everything goes to your workspace's server and nowhere else:

- what Claude Code hands each hook: the session's id, its folder, and the
  text of each prompt you send;
- the folder's git remote and its last 40 commits (id and message);
- read from the session's transcript on your machine: its title, the tokens
  used, how many tool calls of each kind were made, and the map items the
  session named;
- the paths of the files the session read or edited, never their contents;
- when the session stops to wait for you, what Claude Code says it waits for.

The scripts that do this are in `scripts/`, unminified. The server is open
source and MIT licensed: {repository}.

Privacy: {privacy}

