# Lattice

A typed, extensible map of people, work and dependencies, built to be used by a
human and by AI agents through the same tools.

## Run it

```bash
npm install
npm start
```

The server listens on `http://127.0.0.1:3100` and keeps its data in `data/`
(embedded Postgres, no install needed). Everything else talks to that server.

## Three surfaces, one set of tools

| Surface | Who | How |
|---|---|---|
| MCP at `/mcp` | Agents | `.mcp.json` in this repo connects Claude Code. Copy the `lattice` entry into any other project's `.mcp.json` to use the map from there. |
| Web UI | You | Open `http://127.0.0.1:3100` while the server is running |
| CLI | You | `npm run lattice -- <command>` (run with no command for the list) |

All three call the tools in [src/tools.ts](src/tools.ts). The web UI and CLI
have human authority; the MCP endpoint does not, and two tools (`decide`,
`init`) are not offered to agents at all.

The web UI has four screens: **Today** (the standing questions), **Review**
(approve, exclude or correct proposed changes), **Map** (search, and each
entity with its relations and history) and **Activity** (the event log, one
line per change set). It is plain files in `ui/` with no build step.

## How a change happens

Every change to the map goes through one tool, `change`: a list of ops
(`create`, `update`, `link`, `unlink`, `archive`, `merge`, `define_type`) with a
reason and a source.

1. The whole change is validated against the schema and the current map.
2. Policy decides: applied at once, or held as a proposal. By default agents
   propose everything. Loosen it per op in `lattice.config.json`:
   `{ "policy": { "create": "auto", "link": "auto" } }`.
3. You review and decide, in the web UI's Review screen or from the CLI:

```bash
npm run lattice -- review
npm run lattice -- approve <id>
npm run lattice -- approve <id> --except some_ref,#12
npm run lattice -- reject <id> "why"
```

4. Every applied op is written to the event log with who proposed it, who
   approved it, why, and the source.

`claim` and `release` (taking an exclusive resource, such as the one live Rhino
session) take effect at once for agents too.

## Sessions and the live lane

An agent session registers itself in the map as a run, says what it is working
on, and is given any exclusive resource that work needs, or told who holds it.
When the session ends, everything it held is released. These writes take effect
at once; they are the session's own state, not facts about the world.

- **From an agent:** the `session_start`, `session_update` and `session_end`
  tools.
- **Automatically, from Claude Code:** merge
  [examples/claude-code-hooks.json](examples/claude-code-hooks.json) into a
  project's `.claude/settings.json`. Each session opened there then registers
  on start and closes on end, and starts with what the map knows about that
  repository: the open work nothing blocks, the blocked work and what it waits
  on, and whether each exclusive resource is free. The repository is matched
  by the `path` on a `software.repo` entity.
- **From a script:** `POST /agent/<tool>` takes the same tools as plain JSON
  with agent authority.

- **Launched from the map:** an entity page's **Launch session** button (or
  the human-only `launch` tool) starts a headless Claude Code session in the
  task's repository with its brief as the prompt. You choose what it may do:
  *investigate only* (plan mode, the default) or *may edit files*. It is
  registered before it starts, so it takes the lane or the launch is refused.
  Its answer, turn count and cost are written to the run when it ends, and
  the full transcript is kept under `runs/`. Ending the run from the UI stops
  the process. This needs the `claude` CLI on the PATH.

The Today screen lists open sessions, flags one that has not reported for 30
minutes, and can end it, which releases what it holds. An entity page has
**Copy session brief**: the task's context, blockers, needed resources and the
rules that govern them, as text to start a session with.

## Views

The questions the map exists to answer. `npm run lattice -- view` lists them.

| View | Question |
|---|---|
| `needs_me` | What needs me now? |
| `blocked_on_me` | What am I holding up? |
| `waiting_on` | What am I waiting on, and from whom? |
| `changed_since` | What changed since I last looked? |
| `at_risk` | What is about to go wrong? |
| `blockers` | What is blocked, and what has to move first? |
| `available_now` | What can run right now, and who holds each resource? |
| `sessions` | Which agent sessions are open, on what, holding what? |
| `brief` | What does a session need to know to start on this task? |
| `repo_work` | What open work belongs to this repository? |

Blockers are never stored. They are derived each time from `depends_on` and
`needs` relations, so they cannot go stale.

## Packs and flavours

Types live in files under `packs/`, one folder per pack:

- `core`: the native types (person, company, agent, goal, area, project, task,
  decision, issue, hypothesis, result, event, resource, procedure, file, idea,
  note) and relations.
- `sys`: the system's own primitives (source, connection, run).
- `software`: application, repo, feature, bug, release, pull request,
  environment, spec, handoff.
- `local`: created when you approve a `define_type` proposal.

A type can extend another. A `software.bug` is a flavour of `issue`: it inherits
the parent's fields and statuses, and anything that searches or views issues
sees bugs too. Types outside `core` are named `<pack>.<name>`.

## Not built yet

- Launching into the desktop app. Launched sessions are headless.
- Unattended automations: nothing launches a session on a schedule or trigger.
- A graph view, and editing fields other than status in the web UI.
- Undo. The event log records what changed, but nothing replays it backwards.
- Semantic search. Search is text matching.
- Teams. The `workspace` and `visibility` columns exist but nothing enforces them.
- Authentication. Agent and human are told apart by which endpoint is called,
  on a server bound to this machine. An agent with shell access can run the
  CLI, so policy is a guard rail, not a security boundary.

## Tests

```bash
npm test
npm run typecheck
```
