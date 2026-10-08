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
Only one server may use a data folder at a time: it writes `data.lock` beside
the folder, and a second one refuses to start.

### Dev mode

```bash
npm run dev
```

For working on Lattice itself, one person on one machine. It differs from
`npm start` in two ways:

- **Agent changes are not reviewed.** Every op applies at once unless
  `policy` in `lattice.config.json` says otherwise. Undo in the Activity screen
  still reverses a change set.
- **Agents can restart the server** with the `restart` tool, to run code they
  have just changed. The server is kept running by [src/dev.ts](src/dev.ts):
  if new code fails to start, it tries again when a file under `src/` or
  `packs/` changes. Its output is kept in `runs/dev-server.log`.

Approving, launching and tokens stay with you. Dev mode refuses to start with
`auth` set to `tokens`.

## Three surfaces, one set of tools

| Surface | Who | How |
|---|---|---|
| MCP at `/mcp` | Agents | `.mcp.json` in this repo connects Claude Code. Copy the `lattice` entry into any other project's `.mcp.json` to use the map from there. |
| Web UI | You | Open `http://127.0.0.1:3100` while the server is running |
| CLI | You | `npm run lattice -- <command>` (run with no command for the list) |

All three call the tools in [src/tools.ts](src/tools.ts). The web UI and CLI
have human authority; the MCP endpoint does not, and two tools (`decide`,
`init`) are not offered to agents at all.

The web UI has three places. **Home** is what needs you, project by project.
Proposals to approve or reject come first. Then each project is a card: its
progress, what is being worked on, and under it what there is for you to
read, to decide and to do in that project, each dealt with where it stands
and each list showing its first two until asked for more. A project's
**Roadmap** and **Questions** open from its card. What belongs to no project
has a card of its own, and what is blocked, at risk, waiting on others, in
session or held is a row of counts, opened one at a time.
**Search** finds anything in the map by words or type (it lists nothing
until you ask), creates new things, and opens each entity with its fields,
relations and history; **Activity** (the event log, one line per change set)
is beside it. **Workspace** holds the owner, tokens, members, importing a backup and
automations. A proposal's changes can be excluded or corrected one by one in
**Review**, reached from the proposal on Home. The **Graph** opens from an
entity's page.

The roadmap is one project's features in the order they are to be built. Each
shows its own status and how much of the work that is part of it is closed, and
whatever is being built or has a session open on it is marked. Reorder features
with the arrows; tasks that belong to the project but to no feature are listed
underneath, to be moved under one. **Graph** at the top lays the features
out by dependency: each sits one column to the right of everything it waits
on, with an arrow from what is needed (red while that is unfinished). It is the `tree` view, which agents can call
too. The tree itself is declared in the software pack (`trees` in
[packs/software/pack.json](packs/software/pack.json)): which types are roots,
branches and work, which field orders them, and which statuses mean "now". A
pack can declare another tree the same way, with no code.

**Questions** is one project's undecided things, to be worked through from the
top: open decisions and unsettled hypotheses, the ones holding up the most
first, each with what waits on it and what is testing it. A decision is made
where it stands: pick one of its options or type the outcome, add why, and it
is recorded as decided. To have something looked into first, type it in
"Ask an agent" on the card: that makes a task about the question, leaves the
question open, and reaches any agent that is listening. A question belongs to a project when it is part of it,
is about something in it, or something in it depends on or assumes it. Agents
get the same list from the `questions` view.

**Following agents.** With "Follow agents" ticked (bottom of the menu), an
agent can bring your page to what it is working on: every change it makes
opens what it touched (or Review, when the change waits there), and the `show`
tool opens any entity or screen with a one-line note. Anything you are in the
middle of is kept; the note offers the jump instead.

**Agents hear you.** What you do in the UI reaches the agents working with
you. An agent waiting in the `watch` tool is answered the moment you decide,
edit, approve or reject something, and the menu shows "An agent is listening"
while one waits. A Claude Code session in this repository is also told, with
your next message, what you did since it last heard (the `UserPromptSubmit`
hook in `.claude/settings.json`).

The graph draws the map as nodes and arrows: what blocks what, what belongs to
what, or every relation. Open it on one entity (the **Graph** button on its
page) to see only its neighbourhood, one to four steps out. Colour shows the
kind of thing, a dashed red ring marks what is blocked, and finished work is
hollow. Drag to move, scroll to zoom, click a node to open it. It is plain files in `ui/` with no build step.

## How a change happens

Every change to the map goes through one tool, `change`: a list of ops
(`create`, `update`, `link`, `unlink`, `archive`, `restore`, `merge`,
`define_type`) with a
reason and a source.

1. The whole change is validated against the schema and the current map.
2. Policy decides: applied at once, or held as a proposal. Closing a decision
   or a hypothesis is always held when an agent does it, whatever the policy:
   the agent proposes the answer and you confirm it on Home, under the
   project it belongs to. By default agents
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

**Undo.** Any change set can be reversed, from its line in Activity or with
the `undo` tool. The opposite is applied as a new change, so the log keeps
both: created entities are archived, edits put back, links removed or
restored, archived entities restored. An edit that has been changed again
since is left alone and reported. A merge cannot be undone automatically.

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

Home lists open sessions (under Sessions), flags one that has not reported for 30
minutes, and can end it, which releases what it holds. An entity page has
**Copy session brief**: the task's context, blockers, needed resources and the
rules that govern them, as text to start a session with.

## Notifications and automations

- **Notifications:** an agent (`notify`), an automation or the system can leave
  you a message. Unread ones sit at the top of Home. A session that stops
  reporting raises one, saying what it still holds.
- **Automations:** a trigger and an action, stored as an entity.
  - Triggers: `every` N minutes, `daily` at a local time, or an `event` in the
    activity log (`proposal.create`, or a prefix such as `resource.*`).
  - Actions: `notify`, call `check_connections` or `import_audit`, or `launch`
    a headless session on a task.
  - An automation an agent proposes does nothing until you approve it. Every
    firing is logged with its result. Events caused by automations cannot
    trigger automations, and a launching automation waits for its last session
    to end before starting another.
  - Create and pause them on the Automations screen.

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
- Semantic search. Search matches words in any form in titles and notes, puts
  the best match first, and falls back to near-misses in titles when nothing
  matches; it does not match by meaning.
- Hosting is part built (see Hosting below): backups and the first deployment
  are not done, and a Postgres server instead of the embedded database is the
  later step.
- Single sign-on.

## Hosting

The first hosted version is one server running everything, with the embedded
database on a persistent disk, on Render ([render.yaml](render.yaml)). TLS ends
at the platform.

- `LATTICE_HOST=0.0.0.0` makes the server listen beyond this machine. It
  refuses to start that way without `LATTICE_AUTH=tokens`, and never in dev
  mode.
- `LATTICE_PUBLIC_HOST=lattice.example.com` names what it is reached by.
  Requests for any other host name are refused.
- `PORT` is honoured when `LATTICE_PORT` is not set.
- Each workspace is its own database and costs about 200 MB of memory while
  open, on top of about 350 MB for the server. A workspace nobody has used for
  30 minutes (`LATTICE_IDLE_MINUTES`; 0 for never) is closed and opens again
  on the next request, in under half a second. So 2 GB holds roughly eight
  customers working at the same moment, and more than that in all. A workspace
  with an enabled automation or an open session stays open.
- A hosted server does not launch sessions: launching starts Claude Code in a
  repository on the server's own machine.
- Not done yet: the first deployment, and a copy of the backups off the
  server has not been tried against a real bucket (see Backups).

## GitHub: pushes keep the map current

A push is the moment reality moved, whoever did the work. Two things act on
it.

**The server hears the push.** On the Workspace screen, **GitHub** makes a
secret and shows the address to give GitHub (`/github/<workspace>`): in each
repository, Settings, Webhooks, Add webhook, content type `application/json`,
that secret, push events only. A repository is matched to the one in the map
whose `remote` is its GitHub address. From then on:

- every push, on any branch, is recorded against the repository in the
  activity log, and `repo_work` and the GitHub card say when it was last
  pushed to;
- on the default branch, a commit message that says what it finished
  (`closes e_abc12345`, `fixes e_...`, `done: e_...`) closes that item the
  way an agent would: held for you to confirm unless policy lets it through.
  Decisions and hypotheses are left alone; a commit cannot say what was
  decided.

**An agent reads the push.** [examples/github/lattice.yml](examples/github/lattice.yml)
is a GitHub Actions workflow: on every push it runs Claude in the repository,
connected to the workspace with an agent token, to read the new commits
against the repository's open items and propose what they change. Copy it to
`.github/workflows/` and set, in the repository's settings:

- variable `LATTICE_URL`: the server's address, e.g. `https://lattice.example.com`;
- secret `LATTICE_AGENT_TOKEN`: an agent token ("Token only" on the Workspace
  screen);
- secret `ANTHROPIC_API_KEY`, or `CLAUDE_CODE_OAUTH_TOKEN` for a Claude
  subscription.

It does nothing until `LATTICE_URL` is set. Each push is billed as a Claude
run. What it proposes waits for you on Home like any agent's change.

## Backups

Every 6 hours the server writes each workspace out as one file of plain rows,
`backups/<workspace>/<time>.json.gz`, and keeps the newest 28 (a week). It goes
by the newest file, so restarting neither skips a backup nor piles them up.
`"backup": false` in `lattice.config.json` turns it off, `"backup": { "dir",
"everyHours", "keep" }` changes it, and `LATTICE_BACKUP_DIR` moves it.

A backup holds everything in the workspace, private things and token hashes
included, so treat the files like the data. A copy of the `data/` folder is not
a backup: taken while the server runs, it may not open again.

To restore, with the server stopped, into a folder that does not exist yet:

```bash
node src/backup.ts restore backups/default/<file>.json.gz data-restored
```

Then put that folder in place of `data/`.

To bring a backup into a map that already exists, an admin of that workspace
uses **Import a backup** on the Workspace screen (or the `import_backup`
tool). It merges, matching by id, and can be repeated as often as wanted, in
either direction:

- What the file has and the map lacks is added. Nothing is deleted.
- An entity on both sides keeps whichever was edited later, as a whole. Two
  edits to different fields of the same entity do not combine: the later one
  wins.
- A relation ended on either side is ended; a proposal decided on either side
  is decided; the file's history is added to the activity log.
- Tokens and settings are not touched. Sessions still open where the file
  came from, and what they hold, are left out.
- A map from elsewhere has its own person for its owner. When that differs
  from this workspace's owner you are asked whether they are one person; on
  yes, the owner here becomes the person in the file, with their tokens and
  everything private to them, so later imports line up.
- You are shown what would change before anything does, and the server takes
  a backup first, which is the way back: an import cannot be undone from the
  activity log.

The backups sit on the same disk as the data. To send a copy of each one off
the server, set `LATTICE_BACKUP_UPLOAD_URL` and `LATTICE_BACKUP_UPLOAD_KEY`:
any address that takes a file by POST with a bearer key. For Supabase Storage
that is `https://<project>.supabase.co/storage/v1/object/<private bucket>` and
a key allowed to write to it. A copy that fails is reported in the server's
output and the backup itself still stands. Copies sent away are not pruned.

## Identity and workspaces

By default the server is for one person on one machine: there is one workspace,
and which endpoint you call decides whether you are the human or an agent.

Set `"auth": "tokens"` in `lattice.config.json` (or `LATTICE_AUTH=tokens`) to
change that:

- **Every request carries a token** (`Authorization: Bearer lat_...`). The
  token says which workspace it belongs to and whether it is a human's or an
  agent's. A human token can approve, launch and manage tokens; an agent token
  cannot, on any endpoint.
- **First start prints two secrets, once:** your human token for the default
  workspace, and the operator secret.
- **Tokens** are made with `token_create`, listed with `token_list` and
  revoked with `token_revoke` (human only). Only a hash is stored. A launched
  session gets its own agent token, valid for a day and revoked when it ends.
- **Several workspaces in one browser:** the UI remembers each workspace you
  sign in to and switches between them from the menu's bottom corner; the
  workspace's name is shown under "Lattice" and on the tab. Signing out
  forgets that one.
- **Connecting Claude Code:** done once per machine. On the Workspace
  screen, press **Connect an agent**. It makes an agent token and shows two
  commands that put the server's address and the token into the environment
  variables `LATTICE_URL` and `LATTICE_AGENT_TOKEN` (on Windows, `setx`).
  Run them, then quit Claude Code completely and open it again. Every project
  whose `.mcp.json` reads those variables is then connected as you; this
  repository's does, and the same file works in any other:

  ```json
  {
    "mcpServers": {
      "lattice": {
        "type": "http",
        "url": "${LATTICE_URL:-http://127.0.0.1:3100}/mcp",
        "headers": { "Authorization": "Bearer ${LATTICE_AGENT_TOKEN:-none}" }
      }
    }
  }
  ```

  With the variables unset it falls back to a server on this machine.
  Printing `LATTICE_URL` (`echo $LATTICE_URL`; in PowerShell,
  `$env:LATTICE_URL`) says which server a session will use. `claude mcp get
  lattice` says it too, but prints the token in full with it: keep that out
  of an agent's session and off a shared screen. The connection is kept in the machine's environment
  on purpose: an entry added with `claude mcp add --scope local` lives in
  Claude Code's own settings file, and was lost once when a running session
  wrote that file back. The hooks in `.claude/settings.json` are separate
  and still point at this machine.
- **Using a token:** paste it into the web UI's sign-in screen; set
  `LATTICE_TOKEN` for the CLI; for Claude Code by hand, add
  `"headers": { "Authorization": "Bearer ${LATTICE_AGENT_TOKEN}" }` to the
  `lattice` entry in `.mcp.json`, and the same header to each hook.
- **Workspaces: one database per customer.** Each workspace has its own
  database, its own locally defined types and its own automation runner.
  Nothing is shared, so there is no filter to get wrong. The operator creates
  one and receives its first human token, in the web UI (Workspace screen,
  **Installation**, with the operator secret) or with a request:

  ```bash
  curl -X POST http://127.0.0.1:3100/operator/workspaces -H "content-type: application/json" -H "Authorization: Bearer <operator secret>" -d '{"id":"acme","name":"Acme Architects"}'
  ```

  The operator secret can create and list workspaces, and issue a workspace a
  new owner token when its owner has lost theirs ("New owner token" on the
  same card); it cannot read any workspace's map.

  **A workspace from a backup file.** Choose a backup file on the same card
  before pressing Create (or send its bytes in base64 as `"backup"` in the
  request above) and the new workspace starts as the map in that file:
  everything in it, the types it defined for itself, and its owner, whose
  token is the one handed back. This is how a map moves from one server to
  another. Tokens from where it came from do not work in the new workspace
  and arrive revoked. If the file cannot be put in, no workspace is made.

  **If the operator secret is lost**, run this on the machine the server runs
  on (on Render, in the service's Shell), with the server running:

  ```bash
  node src/cli.ts operator-reset
  ```

  It prints a new secret once and the old one stops working. What it proves
  is that you can write on the server's disk, so it needs the same
  `LATTICE_DATA` and port settings as the server.

- **Several people in one workspace.** An admin adds people with
  `member_add`, which creates their person entity and their token. From then
  on:
  - New things are **private to their author** unless created or edited as
    shared. An admin can flip that default with `workspace_set`.
  - Private means hidden from other members everywhere: search, by id,
    relations, the graph, the activity log and every view. The database
    enforces it (row level security), so no query has to remember to filter.
  - Each person's views are their own: "needs me" is what needs *them*.
  - Anyone can make an **agent token that acts for themselves**. That agent
    sees what they see, its proposals go to them alone, and its notifications
    reach only them.
  - Only an admin can add members, make human tokens or tokens for others, and
    change workspace settings. The first token of a workspace is an admin's;
    running `init` with it ties it to a person.

  - **Nothing can depend on a private item from outside it.** A shared item
    cannot `depends_on` or `needs` a private one; a private item cannot be
    shared while it waits on private items, unless they are shared in the same
    change; and an item cannot be made private while other work depends on it
    (a dependent hidden from you is counted, not named). So a blocker is
    always visible to everyone it blocks.
  - **A held resource is held for everyone.** If someone's private session
    holds the live lane, others are refused it and told it is held by
    "someone's private session".

- **Notifications between workspaces.** A human can send another workspace a
  notification with `notify_workspace`. It arrives only if that workspace's
  admin has added the sender to the workspaces it accepts, and accepting is
  one-way.
- **The Workspace screen** manages all of this: your agent tokens, members,
  the default visibility and which workspaces to accept notifications from.

Limits, stated plainly: the server
still listens on this machine only, with no
TLS. And on a single machine an agent running as your OS user can read any
token you keep in a file or environment variable, so tokens are a real
boundary between machines and between customers, not between you and an agent
on your own laptop.

## Tests

```bash
npm test
npm run typecheck
```
