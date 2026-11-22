# connect

The first moments of a new map: what to do until the first run lands. On a
map with no run, Field's empty state shows the next step, connect Claude
Code, with what to copy for this server. When the first run begins, a line
says so, live, and opens it in the harness view.

```
no run ─▶ Field: ○ Nothing on the map yet
            Connect Claude Code   MCP · Hooks (copy) · ○ waiting
first run begins ─▶ ◐ First run · <its name>  open ─▶ Harness, on that run
```

| File | Runs | What it is |
|---|---|---|
| [setup.ts](setup.ts) | both | The MCP line and the hooks, from where the server is. Plain data |
| [index.ts](index.ts) | server | `connect.setup`, and `connect.token` when a token action is named. Injects `action.register` |
| [view.ts](view.ts) | page | Fills Field's `field.empty`, `over`, and `top` on a guest map. Injects `action.invoke`, `exchange.read`, `exchange.watch`, `here.set`, `slot.fill` |

## What is copied

- **MCP**: one line for a terminal, `claude mcp add --scope user --transport
  http archipelago <mcp>`, with an `Authorization` header where the server
  takes a token.
- **Hooks**: a settings file, to merge into `~/.claude/settings.json`:
  every event Claude Code sends ([claude-code](../claude-code/README.md))
  as a command hook, `command`. Where the server takes a token, its `env`
  sets `ARCHIPELAGO_TOKEN`, which the hook script sends.

Where a hook script is served (`script`), the hooks row is instead one
command, the same in bash, PowerShell and cmd: `node -e "…"` fetches the
script to `~/.archipelago/hook.ts` and merges a hook per event into
`~/.claude/settings.json`, replacing an earlier one of its own and keeping
everything else, with the token in its `env`. Run again, it changes
nothing. An address that isn't safe inside the command is refused.

Each row is one line on the page, cut to fit; the copy is the whole text.

## Tokens

A server that takes a token names, in config, the action that makes one
(`token`). The page then shows "Make a token": `connect.token` calls that
action for the person asking and hands the token back once. Only a person
may: an agent or a pack is refused, so a token is shown only to whoever it
is for. Nothing here keeps it; the page puts it into what is copied and
shows it as dots. With no token action, nothing asks for one.

## Config (server)

| Key | Default | |
|---|---|---|
| `hook` | `http://127.0.0.1:5181/hook` | The adapter's `/hook`, as Claude Code reaches it |
| `mcp` | `http://127.0.0.1:5181/mcp` | The adapter's `/mcp` |
| `command` | this checkout's `packs/claude-code/hook.ts`, with `hook` | How each hook runs |
| `token` | none | The action that makes a token, or a path on the page's origin: the page posts `{name}` there with its cookie and gets `{name, token}` (a host's gateway that keeps tokens) |
| `script` | none | Where a hook script is served (`<origin>/hook.ts`): the hooks row is then one command |
| `name` | `archipelago` | The MCP server's name |
| `save` | none | On a guest map: where the guest goes to keep it. The page then shows a quiet "save" in `top` |

[app/tree.ts](../../app/tree.ts) sets `hook` and `mcp` from the page's port.
A host in front sets its own address, command and token action.

## The first run

The page reads whether the map has a run (`exchange.runs`, one). While it
has none, the connect step shows. The first `begin` it sees then is the
first run: it is named by its title, else its folder, and the line in
`over` stays until it is opened or closed.
