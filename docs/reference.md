# Archipelago reference

The details behind the [README](../README.md): how the server runs, how a change happens, sessions, views, packs, hosting, GitHub, secrets, backups, and identity.

## Running the server

`npm start` listens on `http://127.0.0.1:3100` and keeps its data in `data/`
(embedded Postgres, no install needed). Everything else talks to that server.
Only one server may use a data folder at a time: it writes `data.lock` beside
the folder, and a second one refuses to start.

### Dev mode

```bash
npm run dev
```

For working on Archipelago itself, one person on one machine. It differs from
`npm start` in two ways:

- **Agent changes are not reviewed.** Every op applies at once unless
  `policy` in `pelago.config.json` says otherwise. Undo on the Changes screen
  still reverses a change set.
- **Agents can restart the server** with the `restart` tool, to run code they
  have just changed. The server is kept running by [scripts/dev.ts](../scripts/dev.ts):
  if new code fails to start, it tries again when a file under `src/` or
  `packs/` changes. Its output is kept in `runs/dev-server.log`.

Approving, launching and tokens stay with you. Dev mode refuses to start with
`auth` set to `tokens`.

## Three surfaces, one set of tools

| Surface | Who | How |
|---|---|---|
| MCP at `/mcp` | Agents | A project's `.mcp.json` connects Claude Code: the setup command writes it (see "Connect Claude Code" in the README). |
| Web UI | You | Open `http://127.0.0.1:3100` while the server is running |
| CLI | You | `npm run pelago -- <command>` (run with no command for the list) |

All three call the tools in [packs/surface/kernel/tools.ts](../src/tools.ts). The web UI and CLI
have human authority and call each tool by its name; the MCP endpoint does not,
and offers agents ten tools ([packs/surface/kernel/surface.ts](../src/surface.ts)): `query`
reads (a view, a query, or a read such as `get`, `search`, `schema`, `events`),
`change` writes, `undo` takes a change set back, and every other action is
called under one of the six verbs the core pack declares (`capture`, `assign`,
`report`, `ask`, `settle`, `revise`) by its name, with its inputs as `params`:
`report` with action `tell`. A pack's actions join its verb. `draw` draws a
view in a chat, in a client that draws MCP Apps. The human's own
tools (`decide`, `init`, tokens, members) are not offered to agents at all.

The web UI has five places, and one page for each thing.

- **Home** is where it opens: each active project with its open questions
  (most-blocking first) and its next release, with how much of it is done.
- **Search** finds anything in the map by words or type, and **New** makes a
  thing by hand. **Map** draws the whole map as a view.
- **Time** is a week as a calendar: the hours you logged or planned, beside
  the lanes of agent sessions at work. Planned time counts once a person
  confirms it; a routine repeats a block. What is owed per client, and
  invoices drafted from it, are here too.
- **Changes** holds what agents sent that waits for you: each part can be
  left out or corrected before you apply it. Below that it lists what agents
  changed without waiting since you last looked, each with Undo; "Mark all
  seen" records that you looked.
- **Workspace** sets the workspace up, in five sections shown one at a time
  (`#/workspace?at=<section>`): **People** (the owner, members, the plan),
  **Agents** (agent tokens and what agents may do), **Map** (the theme as swatches, tried on your screen and then kept;
  whether new things start private; the backup), **Packs** (each pack a card with
  its on/off switch and what it touches, its manifest's keys grouped as types,
  links, views, styles, instructions, rules, actions, runs and reach, each
  counted; a click opens a group in the card, each thing in it one line by name
  and what it is, with its controls where it is changed here: styles, screens,
  checks; above them, Connections: the server packs it may connect). Each setting is one row; what is done rarely is in its ⋯ menu.

Every item has a single page, and every way to it leads there: its head,
its note folded to the first paragraph, each field drawn by its kind, where
it came from, and its history; what it is tied to is drawn on the canvas. A project's page also draws its **roadmap** (its features in
the order they are to be built, with progress, and marked where a session is
open) and lists its open **questions**: decisions not made and hypotheses not
settled, the ones holding up the most first. A decision is made where it
stands: pick one of its options and say why. The whole log of
changes is at `#/activity`.

The roadmap is the `tree` view (work_views, a hosted pack, declares the read), which agents can call too. The tree is
declared by a pack (the software pack's, a hosted pack, as a view of
`form: "tree"`): which types are roots,
branches and work, which field orders them, and which statuses mean "now". A
pack can declare another tree the same way, with no code.

**Following agents.** An agent's `show` opens what it names in a pane of its
session's own beside yours, its strip saying whose it is and its tooltip the
agent's note, or in a tab of its own out of sight, its mark ringing; it never
takes the pane you are in or touched last. Ask an agent to take you there and
its show (`focus`) brings that tab into sight. Whom each tab follows (everyone,
nobody or one session) is in the tab's ⋯ menu.
A change redraws a page, in place, only when it touches an item on it.

**Agents hear you.** What you do in the UI reaches the agents working with
you. An agent waiting in the `watch` tool is answered the moment you decide,
edit, approve or reject something, and the menu shows "An agent is listening"
while one waits. A Claude Code session in this repository is also told, with
your next message, what you did since it last heard (the `UserPromptSubmit`
hook the setup writes into `.claude/settings.json`).

**Views.** An item's page draws it among what it is tied to. What a
view holds is a query (a filter, a walk along links and a limit, kept as an
item of type `lens`) and how it looks is a `style`; both are items on the map, so a project can keep views
of its own, each named for the question it answers. A style may carry its own
drawing code, which runs in a sandboxed worker with no page and no network
(`ui/draw.html`).

**Documents.** A `document` is made of the map: its sections can be notes or
live views. It can be printed or saved as a PDF, and shared by a link that
needs no login.

**A session's story.** As an agent works it tells what it concluded (the
`tell` tool), and the session's page opens on its latest finding, drawn with
the items it is about.

The UI is plain files in `ui/` with no build step.

## How a change happens

Every change to the map goes through one tool, `change`: a list of ops
(`create`, `update`, `link`, `unlink`, `archive`, `restore`, `merge`,
`define_type`, `forget`) with a
reason and a source.

1. The whole change is validated against the schema and the current map.
2. Policy decides: applied at once, or held as a proposal. Closing a decision
   or a hypothesis is held when an agent does it, whatever the server's policy
   (unless the workspace itself has chosen otherwise, below):
   the agent proposes the answer and you confirm it on the Changes
   screen. Without a choice of its own, a workspace follows the server's
   policy, where agents propose everything; loosen it per op in
   `pelago.config.json`: `{ "policy": { "create": "auto", "link": "auto" } }`.
   A workspace can make the choice for itself, on its Workspace screen under
   Agents ("Their changes"): held until you have looked, or taking
   effect as agents make it, merges and archives included. A new workspace
   begins taking effect, from the moment it is first opened, whether a
   signup, the operator or a pack made it or it is a new server's default
   (since 1 Nov 2026; from 21 Oct its first owner being set chose that). One
   that exists and never chose, or comes from a backup, keeps what it has.
   Then an agent can
   settle a decision or a hypothesis too: a decision must say what was chosen
   and why, and you are notified on the Changes screen. The log and Undo are the record,
   not a gate. Its admin sets it; an agent cannot.
3. You look at what is held and apply or decline it, in the web UI's Changes
   screen or from the CLI (where the words are still approve and reject):

```bash
npm run pelago -- review
npm run pelago -- approve <id>
npm run pelago -- approve <id> --except some_ref,#12
npm run pelago -- reject <id> "why"
```

   A held change that asks only for what a later change has already made
   so (the task it would close is closed) leaves the queue as superseded,
   and the log says by which change.
4. Every applied change is appended to the workspace's log as one entry
   (below), with who proposed it, who approved it, why, the source, the rule
   that decided it, and on whose authority it was made:
   the human's own (their change, or a held one they applied), a human's
   word as an agent reports it (the agent must say what was said and where,
   and the log keeps that it is the agent's report), or the agent's own
   judgment (the default when it says nothing). An agent settling a decision
   or a hypothesis has to say which.

**Undo.** Any change set can be reversed, from its line in Activity or with
the `undo` tool. The opposite is applied as a new change, so the log keeps
both: created items are archived, edits put back, links removed or
restored, archived items restored. An edit that has been changed again
since is left alone and reported. A merge cannot be undone automatically.

**Forget.** `forget` takes an item out of the map for good: its key is
destroyed, so its title, note and fields, and the fields of every link
touching it, are gone from the log, the tables, the search index and any
backup that needs that key; what stays is that something of its type
existed. Change set reasons that mention it are offered, and go with it only
if chosen. An agent's forget waits for the owner, whatever the workspace
lets agents do, and no forget can be undone.

## The log

Each workspace keeps one log, and everything else is read from it
([docs/log.md](log.md) is the full account). It is appended to and never
rewritten:

- **The fact stream** holds every applied change set as one entry: a header
  and its facts, each one value of one field of one item or link asserted or
  retracted. Each entry carries the hash of the one before, so the chain
  shows any change to what was written. Held changes are entries of the
  pending stream until they are decided.
- **The operational streams** (sessions, claims, notifications,
  automations, settings, access, observations, and a pack's own) hold what
  skips approval. Each day of each is sealed by an entry in the fact stream,
  and compacted by the retention rules its packs declare (`keep` in
  `packs/core/pack.json`); the fact stream is kept forever.
- **Sealed words.** Every title, note, field value and reason is sealed
  with its item's own key, kept in the workspace's key vault, so a forget
  destroys one key and the chain still verifies. A member reads an entry of
  the log only when they may see what it is about.
- **Projections.** The tables pages read (items, links, the review queue,
  the part_of closure, mentions, the search index) are written from the
  log's facts in the same transaction as the append. A snapshot of them is
  kept daily; a rebuild starts from the newest one and swaps in what
  differs, and any position can be read as it was (`packs/log/kernel/snapshot.ts`).
- **Partitions.** The log's tables are partitioned by year, made ahead as
  time goes on, and every partition refuses an update or a delete.
- **Activity and history** (an item's history, `changed_since`, `watch`,
  undo) are read from the log, not from a table of their own.

`claim` and `release` (taking an exclusive resource, such as the one live session
of a desktop program) take effect at once for agents too.

## Sessions and the live lane

An agent session registers itself in the map as a run, says what it is working
on, and is given any exclusive resource that work needs, or told who holds it.
When the session ends, everything it held is released. These writes take effect
at once; they are the session's own state, not facts about the world.

- **From an agent:** `capture` with action `session_start`, and `report` with
  action `session_update` or `session_end`. An agent that finishes a session in a repository is first shown that
  repository's open work nobody has changed since the session began, and has
  to change each item, say it is still true, or say it cannot tell from where
  it is (the item is then left as it was, and the run says it was not
  checked); what waits on a person's answer is not asked about. A session
  closed without that (by the hook, or a crash) is recorded as not reconciled.
- **Automatically, from Claude Code:** the setup command (below) writes the
  hooks into a project's `.claude/settings.json`; by hand, merge
  [examples/claude-code-hooks.json](../examples/claude-code-hooks.json), which
  calls a server on the same machine. Each session opened there then registers
  on start and closes on end, and starts with what the map knows about that
  repository: the open work nothing blocks, the blocked work and what it waits
  on, and whether each exclusive resource is free. The repository is matched
  by the address the checkout was cloned from (the `remote` on a
  `repo` item), which is the same on every machine, and failing
  that by its `path`.
- **A project with nothing of Archipelago's in it** is connected by one command,
  given under "Connect an agent" on the Workspace screen and run in the
  project's folder. It fetches `GET /connect/setup.mjs` from the server and
  runs it: that writes `.mcp.json`, the hook script and the four hooks that
  call it, the friction skill, and the working rules
  ([examples/working-rules.md](../examples/working-rules.md)), which it reads
  into the project's `CLAUDE.md`. In a git checkout it also installs a
  `commit-msg` hook (not over one of the project's own, nor where
  `core.hooksPath` gives the hooks to another tool). It adds to what is
  there, holds no secret, and can be run again.
- **Each commit a session makes names its run,** as a trailer
  (`Archipelago-Run: e_...`). At the start of a session the server says the
  run beside its answer (the `x-pelago-run` header), and the hook script
  keeps it in the checkout's git folder, one file per session
  (`.git/pelago-runs/<session id>`, shared by its worktrees), taking it out
  when the session ends. The `commit-msg` hook, plain sh and git, reads it by
  the session id Claude Code gives every command it runs
  (`CLAUDE_CODE_SESSION_ID`). So several sessions in one checkout each name
  their own, and a commit made by a person, or by a session with no run
  kept, carries no trailer.
- **What the setup changes is shown first.** At a terminal it lists each
  file it will write or change and asks before it does. A file of yours
  that it changes (`.mcp.json`, `.claude/settings.json`, `CLAUDE.md`, the
  shell's start-up file where it keeps the token) is copied beside itself
  first, once, as `<name>.pelago-backup`: keep those out of git. Options go
  after `--` at the end of the command: `-- --dry-run` shows the plan and
  writes nothing, `-- --yes` writes without asking, `-- --remove` takes out
  what the setup wrote and nothing else (with `--machine`, also the address
  and token kept for the machine). To read the script before running it,
  open `/connect/setup.mjs` on the server. With no terminal to ask at and no
  `--yes` (an agent running it), it brings up to date only what Archipelago
  wrote there before and refuses a first setup.
- **From a script:** `POST /agent/<tool>` takes the same ten tools as plain
  JSON with agent authority. A tool's name from before the surface was made
  small still answers there for one release, with `moved_to` beside `result`
  naming the call that replaces it. `POST /agent/report` with no action is what
  a running system measured (action `health`), as Uptime Kuma posts it.

- **Launched from the map:** an item page's **Launch session** button (or
  the human-only `launch` tool) starts a headless Claude Code session in the
  task's repository with its brief as the prompt. You choose what it may do:
  *investigate only* (plan mode, the default) or *may edit files*. It is
  registered before it starts, so it takes the lane or the launch is refused.
  Its answer, turn count and cost are written to the run when it ends, and
  the full transcript is kept under `runs/`. Ending the run from the UI stops
  the process. This needs the `claude` CLI on the PATH.

A session's page has **End session**, which releases what it holds; one that
has not reported for 30 minutes raises a notification. An item page has
**Copy session brief**: the task's context, blockers, needed resources and the
rules that govern them, as text to start a session with.

## Notifications and automations

- **Notifications:** an agent (`notify`), an automation or the system can leave
  you a message. Unread ones are on the Changes screen. A session that stops
  reporting raises one, saying what it still holds.
- **Automations:** when something comes due, what to do, about the item it
  serves. It lives with that item: its island and who may see it.
  - When: `daily` or `weekly` at a time in the workspace's zone, or `on` a
    query starting to match (the first match, each new one, the first for each
    value of a field, or a value crossing a number).
  - What: `notify` (about the item it is about), or `launch` a headless
    session on a task.
  - The kernel's clock says when one is due; the automations pack does it.
    An automation an agent proposes does nothing until you approve it. Every
    firing is kept, with what it answered, as which version, and what it made;
    a failed one warns you. A launching automation waits for its last session
    to end before starting another.
  - Each shows as a row (whether it runs, next, last, what it does) on the page
    of what it is about, and on the Automations page.

## Views

The questions the map exists to answer. `npm run pelago -- view` lists them.

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
| `handoff` | Where does this repository's work stand for whoever picks it up? (software pack) |
| `home` | Each project's open questions and next release |
| `questions` | What is still to be decided in a project? |
| `gate` | What does a release wait for, and what can follow it? (software pack) |
| `tree` | A project's roadmap (work_views) |
| `flat` | What is in a view: the flat query |
| `to_confirm` | What did agents settle that I have not confirmed? |
| `oldest` | What has gone longest without being checked? |
| `costs` | What does the work cost? |

There are more (`hubs`, `proof`, `changelog`, `recheck`, `agent_usage`,
`notifications`, `graph`).

The query is the flat query (`flat`): a filter, a walk and a limit, answered as
items and the links among them (`packs/query/kernel/query-flat.ts`). Its filter's text is
the `search` read's own search, ranked the same, and the find bar on the page
sets it. A pack declares its views
in its pack file (`views`): one with `lens` is answered by a read of the
kernel's that its `answer` names (`packs/query/kernel/query-presets.ts`), in the form that view
has always had; any other is answered by the pack's own code. The core pack's
are `flat`, `attention`, `brief`, `graph` (`packs/views/kernel/view-graph.ts`) and `hubs`, each read on its
own; `tree` (`packs/views/kernel/view-tree.ts`) is declared by a practice pack (work_views). A view kept on the map
(an item of type `lens`, a view on Home) is a flat query and a
style (`packs/lenses/kernel/query-saved.ts`): a document draws it where a line names it, and
publishing freezes its picture. `gate` is the software pack's, and reads around its event (the pack
read `around`). No view reads the whole map: a read around an item reads only
what is around it (`packs/surface/kernel/region.ts`), so what it costs follows what it answers;
the flat query refuses a filter that includes nothing. `attention` reads what is a person's
(`person`) or inside an item (`within`); for everyone, only `to_confirm`,
from the log. `hubs` read within an item (`within`). A `graph` with no
focus is drawn from the newest links of each kind. What is inside what, all
the way down, is the part_of closure, a projection the log keeps
(`packs/log/kernel/closure.ts`); `npm test` refuses a query of the items, links or log
with nothing to bound it. An agent is told what changed as counts and the
newest five (`changed_since`, `watch`, the prompt hook), not the list. What the kernel still answers
itself reads what keeps the map running, not the work (`sessions`,
`notifications`, `spent`, `story`, `changed_since`, `style`, `saved_views`),
and `packs/log/kernel/operational.ts` names each; `npm test` refuses any other. Every view
is asked by its short name, wherever it lives.

Blockers are never stored. They are derived each time from `depends_on`,
`waits_on` and `needs` links, so they cannot go stale. `depends_on` is
other work that has to be closed first; `waits_on` is a person, company or
agent who has to answer or act (say what for in the link's `props.for`,
and remove the link once they have); `needs` is a resource.

In a change, a title or note can name an item the same change makes: `{ref}`
becomes that item's id when the change is applied. An agent can ask for its
own change to wait for a human with `hold: true`, even where agents' changes
are applied as made.

A handoff is read off the map, so it does not go stale between sessions and
nobody writes it: the last push, what is open, and what has happened in the
last week (pushes, what was settled or opened, the sessions that ended and
what each said). Beside those: what ended sessions left on no remote or not
committed, from where each said its checkout stood (`left`); what nobody
has seen working, said on the item with `seen_working` false (`unseen`);
and what bites in the repository's files, kept as instructions `for`
`file:<glob>` and said in a brief and when a session opens such a file
(`traps`). What comes next is the open work's, by attention.

## Packs and flavours

Types live in packs, one folder each. The open core ships `core` under
`packs/`; the others are the hosted service's, read from `PELAGO_PACKS`
(docs/packs.md):

- `core`: the starter types (the kinds of the work and the system kind), the
  three every island speaks (task, decision, finding), actors (person and
  agent), the system's own (lens, style, screen, type, link type, and
  the primitives source, connection, run, notification and automation) and the
  root links, which name kinds or capabilities at their ends (`owned_by` goes
  from `has:owned`, whatever declares owned). A place that says `exclusive` is
  a resource. It is the one pack always on.
- `people` and `calendar`: vocabulary that left core on 11 Nov 2026, ids kept
  (`company` and `works_at`; `event`). Calendar also holds `meeting` and
  `routine`, from time. A pack that uses them requires `type:company` or
  `type:event`.

The hosted service's:

- `work`: project, issue, goal, idea, note, file and document, with
  addresses.
- `science`: investigation, hypothesis, experiment and result, with tests,
  supports, refutes and assumes.
- `code`: what software is made of: product, feature, bug, release, repo,
  commit, component, environment and pull request, with settles, fixes,
  calls, ships and defers. Taken on an island map.
- `software`: what runs code over it: the handoff, the release gate, proof
  on each build, rechecks, the changelog, and diagrams.
- `proof`: proof questions, tests and their results, and the rules and
  actions a principle rests on.
- `design`: studies, concepts, tenets, research, elements and write-ups.
- `outreach`: posts, channels, conversations and each channel's month;
  `social` counts visits and trials onto them.
- `time`: time entries, invoices and what is paid regularly (`cost`),
  with bills; `time_views` logs, sums and bills them (the Time screen).
- `funding`: funding programs, tied to the work they could pay for.
- `local`: a workspace's own types, `local.<name>`.

A new workspace starts with `core` alone; the owner adds the rest.

Each pack is described by its `pack.json`, a manifest of nineteen keys
([docs/packs.md](packs.md)): what it declares, which packs it requires or
uses, and what it may reach beyond the map. Adding or taking out a pack is a
fact in the workspace's log, and everything it registers (its types, tools,
screens, rules and handlers) follows from the packs present, so taking one
out unwinds it while its items stay. A change a pack's action or handler
makes names the pack, and core's rule `pack_reach` refuses one that writes
outside what the pack declares, requires or uses.

A type can extend another. A `bug` is a flavour of `issue`: it
inherits the parent's fields and statuses, and anything that searches or views
issues sees bugs too. A type or link type is named by what it is (`task`,
`commit`, `calls`), whichever pack ships it; which pack that is, the schema
says. A workspace's own is `local.<name>`. When a type takes another's name
over (`moved_from`), its items move once, and the old name still reads as the
new one: in a change, a search and a query (`work.task` is `task`).

## Not built yet

- Launching into the desktop app. Launched sessions are headless.
- Semantic search. Search matches words in any form in titles and notes, puts
  the best match first, and falls back to near-misses in titles when nothing
  matches; it does not match by meaning.
- Several servers on one Postgres database: timers and automations would
  run in each (see Hosting below).
- Editing the same item from two imports at once: the later edit wins as a
  whole (see Backups).
- Single sign-on.

## Hosting

You host Archipelago yourself: one server running everything, with the
embedded database on a persistent disk. Any host that runs Node 24 and keeps
a disk will do: install with `npm ci --omit=dev`, start with `npm start`, and
keep `PELAGO_DATA` on the disk. The server does not speak TLS: that ends at the platform or proxy in front of
it.

- `PELAGO_HOST=0.0.0.0` makes the server listen beyond this machine. It
  refuses to start that way without `PELAGO_AUTH=tokens`, and never in dev
  mode.
- `PELAGO_PUBLIC_HOST=pelago.example.com` names what it is reached by.
  Requests for any other host name are refused.
- `PELAGO_TRUSTED_PROXIES` names the proxies in front of the server whose
  word is taken for where a request came from: networks as CIDR, comma
  separated, or `cloudflare` (as in the Render example, since Render is
  reached through Cloudflare). Private networks are always trusted. The caller is
  the last address in `x-forwarded-for` that is not a trusted proxy; what
  stands before it he could have written himself (`packs/walls/kernel/address.ts`).
- `PORT` is honoured when `PELAGO_PORT` is not set.
- `PELAGO_DATABASE_URL=postgres://…` keeps the databases on a Postgres
  server instead of the disk: the default workspace in that database, each
  other one in a database of its own beside it. The schema is applied in
  numbered steps (`packs/database/kernel/migrate.ts`), recorded in `schema_version`; run
  `npm run migrate` as the deploy step, before the new server starts, so no
  server that is answering requests changes the schema under another. A
  server also applies the steps a database lacks as it opens it, so a
  database on the disk needs no deploy step. Log in as a role that is not a
  superuser, with CREATEDB and CREATEROLE: a superuser can turn off the
  triggers that keep the log append-only. Every server on the database must
  have the same `PELAGO_SECRETS_KEY`.
- `node src/cli.ts move <from> <to>` carries a map between a data folder and
  a Postgres database, either way, or between two Postgres servers, with no
  server running on either. It verifies the source's log, replays it into the
  empty target with the same positions and hashes, and keeps the result only
  if the target's chains and tables match the source's row for row. The
  target needs the sealing key the source was sealed with.
- Each workspace is its own database and costs about 200 MB of memory while
  open, on top of about 350 MB for the server. A workspace nobody has used for
  30 minutes (`PELAGO_IDLE_MINUTES`; 0 for never) is closed and opens again
  on the next request, in under half a second. So 2 GB holds roughly eight
  customers working at the same moment, and more than that in all. A workspace
  with an enabled automation or an open session stays open.
- A hosted server does not launch sessions: launching starts Claude Code in a
  repository on the server's own machine.
- What answers without a token is asked only so often (`packs/surface/kernel/limit.ts`): a
  product's public page and the setup script, 120 requests a minute from one
  address and 1,200 from all together; a pack's webhook deliveries, 300 a
  minute from one address. Beyond that the answer is 429 with `Retry-After`. The count
  for all together is what holds if the proxies are not named
  (`PELAGO_TRUSTED_PROXIES`) and a caller's address cannot be told.

## GitHub: an agent reads each push

The server hears nothing from GitHub: the GitHub pack, the GitHub App and the
server's push reader went in Nov 2026. An agent in the repository reads
the pushes it did not make.

A call the server makes to an address someone gave it (a connection checked,
a client's sign-in) follows no redirect, and `PELAGO_PRIVATE_URLS=off` (or
`PELAGO_MODEL_PRIVATE_URLS=off`, its first name) refuses one on the server's
own network (loopback, private and link-local addresses), held to on every
call by the address it connects to (`packs/walls/kernel/outbound.ts`).

**An agent reads the push.** [examples/github/pelago.yml](../examples/github/pelago.yml)
is a GitHub Actions workflow: on every push it runs Claude in the repository,
connected to the workspace with an agent token, to read the new commits
against the repository's open items and propose what they change. Copy it to
`.github/workflows/` and set, in the repository's settings:

- variable `PELAGO_URL`: the server's address, e.g. `https://pelago.example.com`;
- secret `PELAGO_AGENT_TOKEN`: an agent token ("Token only" on the Workspace
  screen);
- secret `ANTHROPIC_API_KEY`, or `CLAUDE_CODE_OAUTH_TOKEN` for a Claude
  subscription.

It does nothing until `PELAGO_URL` is set. Each push is billed as a Claude
run, stopped at 2 dollars. It installs the Claude Code CLI and runs that (the
`claude-code-action` wrapper does not take push events). What it sends is held
for you or takes effect at once, as the workspace is set, like any agent's
change, and says it rests on the agent's reading of the commits.

**An agent re-checks what has gone longest unconfirmed.** The same workflow
asks the server once a day whether a re-check is due. Each project living in
the repository says how often, in its `recheck days` field (weekly when not
set, 0 for never). When a project has waited that long and has open items
nobody has changed or confirmed in that time, Claude is given the oldest of
them and checks those the code can settle: it changes what is done or wrong, marks what it has seen to
be still true (an update that changes nothing), notifies you of what the
repository cannot tell it, and calls `rechecked`, which starts the wait again.
A day when nothing is due ends before Claude is installed and costs no run.
Run the workflow by hand from the Actions tab to have a re-check now,
whatever the interval.
The `oldest` view shows the same thing to anyone who asks: what has gone
longest without a change or a confirmation.

## Secrets

What the server knows and must not give up is of two kinds.

- **What it only has to recognise is kept as a hash:** every token, and the
  operator secret. Each is shown once, when it is made, and cannot be read
  back out of the server or a backup.
- **What the map says is sealed per item** (`packs/seal/kernel/seal.ts`): each item, link
  with fields and change set has its own key, kept in the workspace's key
  vault (`packs/seal/kernel/vault.ts`) wrapped with the sealing key below. A forget deletes
  the key; vault backups are kept apart from the data and for 30 days only,
  so a forgotten item cannot be read back after that.
- **What it has to use is sealed** (AES-256-GCM, `packs/seal/kernel/secrets.ts`): the
  secrets a pack's webhooks sign with, and a server pack's keys. The sealing
  key is
  `PELAGO_SECRETS_KEY` (32 bytes, base64) when that is set, and otherwise a
  file the server makes beside the workspaces (`secrets.key`). A server on
  Postgres makes no such file: every server sharing the database must seal
  with one key, so there it comes only from `PELAGO_SECRETS_KEY`. It is never in
  a database or a backup, so a backup file, or the copy of it sent off the
  server, gives up none of these. A backup restored on another server reads
  them as not set, and they are set again there.

**An agent's token is the secret that lives on other machines,** in the
environment of whoever runs the agent, where any program running as that
person can read it. Three things limit what a copied one is worth:

- **It ends.** "Connect an agent" makes a token that expires in 90 days
  unless told otherwise; the token's row says when.
- **It can be within an item.** Made with "Make a token for this" on an
  item's page (a repository, an environment, a project), such a token reads
  the map as its person does and writes only what is that item's: what lives
  in it and all that is part of that or about it. What a change writes is
  checked on the write path itself (`packs/write/kernel/within.ts`, from
  `Archipelago.change`), whichever tool sends it. What it makes has to be
  tied into that work in the same change. It cannot archive, merge or re-link
  anything else, define a type, or speak for another repository. What else
  it may call is a list (`packs/surface/kernel/scope.ts`): beyond the tools that only read,
  it reports results for that work's tests, takes a resource that work needs
  or that no work is said to need, and notifies about that work. Everything
  else (a backup, the owner's word on settled questions, a tool added later)
  is refused until it is named in the list. The agent that reads pushes on
  the server is held to the repository it is reading in the same way.
- **It can be held to reporting or proposing.** A token that may only
  report is for a running system (a monitor, a deploy): it can call the
  `report` tool and nothing else, not even a read. A report names parts by
  the address they are watched at, never by an id, and is applied at once
  as a measurement. A token that may propose has every change it sends wait
  for a person, whatever the workspace lets agents do.
- **A system can ask for its own.** Nobody need copy a reporting token onto
  a machine. The system posts its name and the watched addresses of the
  parts it reports on to `POST /connect/request` (no token; counted like
  the other open routes) and is given a short code and a poll. A person
  approves or refuses the request on Home or the page of an item watched at
  one of those addresses, after checking the code is the one the system
  shows. Approved, the system's next poll (`POST /connect/poll/...`, the
  poll's secret as a bearer) is handed a token once: an agent's, acting for
  whoever approved it, within those items, that may only report. A request
  waits ten minutes and is operational state, not an item
  (`packs/connect/kernel/token-ask.ts`). A deploy script can ask this way for a token to
  report which of its servers is live.
- **Its owner hears of a new place.** Each token keeps the networks it has
  been used from. Used from one it has not been, a warning goes to the
  owner; the first place a token is used is not news. This notices, it does
  not prevent.

No tool gives a sealed secret back, to a person or an agent: the Workspace
screen says only whether one is set. A key is typed into a field that does
not show it. The agent that reads pushes never has the key in what it reads,
and can only read repositories and change the map; what it reads in a
repository is someone else's text, though, so its changes are an agent's like
any other, and are held for review where the workspace holds agents' changes.

## Backups

Once a day the server writes each workspace out as one file,
`backups/<workspace>/<time>.json.gz`, and keeps the newest 7 (a week). The
file holds the log as it is stored, a snapshot of the projections at its
head, and the tables beside the log; restored, the tables are that snapshot
with the rest of the log projected on. Its words are sealed, so it is read
with the workspace's key vault, which is backed up beside it in
`backups/<workspace>/vault/`, kept 30 days and never sent off the server. It goes
by the newest file, so restarting neither skips a backup nor piles them up.
`"backup": false` in `pelago.config.json` turns it off, `"backup": { "dir",
"everyHours", "keep" }` changes it, and `PELAGO_BACKUP_DIR` moves it.

A backup holds everything in the workspace, private things and token hashes
included, so treat the files like the data. A copy of the `data/` folder is not
a backup: taken while the server runs, it may not open again.

To restore, with the server stopped, into a folder that does not exist yet:

```bash
node src/backup.ts restore backups/default/<file>.json.gz data-restored backups/default/vault/<file>
```

The last argument is the vault backup taken with it; the target may also be
a `postgres://` address. A row whose key is gone (forgotten since) stays
out. A download of a backup (`npm run pull`) carries the vault beside it,
its keys wrapped under a one-time key.

Then put that folder in place of `data/`.

To bring a backup into a map that already exists, an admin of that workspace
uses **Import a backup** on the Workspace screen (Map, the Backup row's
menu; or the `import_backup`
tool). It merges, matching by id, and can be repeated as often as wanted, in
either direction:

- What the file has and the map lacks is added. Nothing is deleted.
- An item on both sides keeps whichever was edited later, as a whole. Two
  edits to different fields of the same item do not combine: the later one
  wins.
- A link ended on either side is ended; a proposal decided on either side
  is decided; the file's history is added to the activity log as events. Two
  logs are never joined: the map keeps its own chain.
- A file from another server is read with the vault backup taken with it
  (`vault` on `import_backup`), on a server with the same sealing key.
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
the server, set `PELAGO_BACKUP_UPLOAD_URL` and `PELAGO_BACKUP_UPLOAD_KEY`:
any address that takes a file by POST with a bearer key, such as an S3-style
bucket behind a signed upload endpoint or Supabase Storage
(`https://<project>.supabase.co/storage/v1/object/<private bucket>`, with a
key allowed to write to it). A copy that fails is reported in the server's
output and the backup itself still stands. Copies sent away are not pruned.

## Identity and workspaces

By default the server is for one person on one machine: there is one workspace,
and which endpoint you call decides whether you are the human or an agent.

Set `"auth": "tokens"` in `pelago.config.json` (or `PELAGO_AUTH=tokens`) to
change that:

- **Every request carries a token** (`Authorization: Bearer pel_...`). The
  token says which workspace it belongs to and whether it is a human's or an
  agent's. A human token can approve, launch and manage tokens; an agent token
  cannot, on any endpoint.
- **A client can sign in through the browser** (OAuth for MCP,
  `packs/identity/kernel/oauth.ts`). Point any client at `<server>/mcp`: it reads where to sign
  in from the 401, a person signs in and says Allow, and it is given an agent
  token acting for them. Tokens last an hour and rotate by a refresh token in
  the same row, so a connection is one row under Workspace → Agents with one
  Revoke; a connection left unused ends after 90 days. A client registers
  itself (`/oauth/register`, which keeps nothing) or by a published metadata
  document; neither proves who it is, so every connection is asked for, and
  the page shows where the client returns. Redirects are https, this machine,
  or an application's own scheme. It needs `PELAGO_PUBLIC_HOST` for an https
  address, and a server with `auth` off offers none of it. A token pasted by
  hand works as ever, for a client that cannot sign in.
- **First start needs the owner's address and mail:** set
  `PELAGO_OWNER_EMAIL` and `PELAGO_MAIL_FROM`; without them a server with
  tokens on does not start. The owner becomes the default workspace's first
  admin and is mailed a code to sign in: people sign in by email, never by
  pasting a token. The operator secret is given once: printed at a terminal,
  or with nobody at one (a container, a service) written to
  `first-start-secrets.txt` beside the data folder, readable only by the
  server's user, and the log says only where. Read it, then delete it.
- **Tokens** are made with `token_create`, listed with `token_list` and
  revoked with `token_revoke` (human only); an agent's can be within some
  items (`within`) and may report, propose or change (`may`). Only a hash is stored. A launched
  session gets its own agent token, valid for a day and revoked when it ends.
- **Several workspaces in one browser:** the UI remembers each workspace you
  sign in to and switches between them from the menu's bottom corner; the
  workspace's name is shown under "Archipelago" and on the tab. Signing out
  forgets that one.
- **Connecting Claude Code:** done once per machine. On the Workspace
  screen, press **Connect an agent**. It makes an agent token and shows two
  commands that put the server's address and the token into the environment
  variables `PELAGO_URL` and `PELAGO_AGENT_TOKEN` (on Windows, `setx`).
  Run them, then quit Claude Code completely and open it again. Every project
  whose `.mcp.json` reads those variables is then connected as you; the one
  the setup writes does, and the same file works in any project:

  ```json
  {
    "mcpServers": {
      "pelago": {
        "type": "http",
        "url": "${PELAGO_URL:-http://127.0.0.1:3100}/mcp",
        "headers": { "Authorization": "Bearer ${PELAGO_AGENT_TOKEN:-none}" }
      }
    }
  }
  ```

  With the variables unset it falls back to a server on this machine.
  Printing `PELAGO_URL` (`echo $PELAGO_URL`; in PowerShell,
  `$env:PELAGO_URL`) says which server a session will use. `claude mcp get
  pelago` says it too, but prints the token in full with it: keep that out
  of an agent's session and off a shared screen. The connection is kept in the machine's environment
  on purpose: an entry added with `claude mcp add --scope local` lives in
  Claude Code's own settings file, and was lost once when a running session
  wrote that file back. The hooks in `.claude/settings.json` follow the
  same two variables: each runs `.claude/pelago-hook.mjs`, which passes the
  hook on to that server with the token, or to the server on this machine
  when the variables are not set. So a session registers, hears what the
  owner did and closes on the same map its tools write to.
- **Using a token:** a person signs in by email, not with a token; set
  `PELAGO_TOKEN` for the CLI; for Claude Code by hand, add
  `"headers": { "Authorization": "Bearer ${PELAGO_AGENT_TOKEN}" }` to the
  `pelago` entry in `.mcp.json`, and the same header to each hook.
- **Workspaces: one database per customer.** Each workspace has its own
  database, its own locally defined types and its own automation runner.
  Nothing is shared, so there is no filter to get wrong. The operator creates
  one and receives its first human token, in the web UI or with a request.
  In the web UI: signed in to the default workspace as its admin, open the
  Workspace screen, **Packs**, and the **Workspaces** card. Type the operator
  secret there (the page keeps it in its memory alone, never stored, so a
  reload asks again), give an id, a name and the owner's email address, and
  press **Make workspace**: the owner is its first admin and signs in by
  email, and an owner token is shown once. A workspace is made only on a
  server that sends mail (`PELAGO_MAIL_FROM`), and always with its owner's
  address; one made from a backup brings its members. The list shows each
  workspace's admins, and **no email** on one nobody can sign in to by email. The request does the same from the
  server's own machine, or from anywhere the page's address is:

  ```bash
  curl -X POST http://127.0.0.1:3100/operator/workspaces -H "content-type: application/json" -H "Authorization: Bearer <operator secret>" -d '{"id":"acme","name":"Acme Architects","email":"owner@acme.example"}'
  ```

  The operator secret can create and list workspaces, and issue a workspace a
  new owner token when its owner has lost theirs ("New owner token" in a
  workspace's menu on the same card); it cannot read any workspace's map.

  **Islands** are set by the new workspace's owner, signed in with that
  token, before anything is put on it: the Workspace screen, **Map**, the
  **Islands** switch in Settings (`workspace_set` with `islands: true`). The
  switch is offered only while the map is empty.

  **Which workspace a token is for.** The token maker names the workspace it
  makes a token for, on its button and in the box that shows the token once,
  and an agent's `capture` `session_start` answers with `workspace` (its id
  and name): check it before writing.

  **A workspace from a backup file.** Choose a backup file on the same card
  (its menu, **From a backup file**) before pressing Make workspace (or send its bytes in base64 as `"backup"` in the
  request above) and the new workspace starts as the map in that file:
  everything in it, the types it defined for itself, and its owner, whose
  token is the one handed back. This is how a map moves from one server to
  another. Tokens from where it came from do not work in the new workspace
  and arrive revoked. If the file cannot be put in, no workspace is made.

  **If the operator secret is lost**, run this on the machine the server runs
  on (on Render, for example, in the service's Shell), with the server running:

  ```bash
  node src/cli.ts operator-reset
  ```

  It prints a new secret once and the old one stops working. What it proves
  is that you can write on the server's disk, so it needs the same
  `PELAGO_DATA` and port settings as the server.

- **Several people in one workspace.** An admin adds people by their email
  address with `member_add` (the Members card on the Workspace screen). They
  are sent an invitation; from then on they sign in on the sign-in page by
  asking for a link at that address. The link works once, for 30 minutes, and
  keeps that browser signed in for 30 days. An address that is a member of
  several workspaces gets one mail with a link to each. Whether a member is an
  admin is kept on the member (`member_set`), and removing one ends their
  sign-ins at once. The page says the same whether or not an address is a
  member anywhere. From then on:
  - In a new workspace, new things are **shared** with its members unless
    created or edited as private; a workspace made before 9 Nov 2026 keeps
    private as its default. An admin can flip it with `workspace_set`.
  - Private means hidden from other members everywhere: search, by id,
    links, the graph, the activity log and every view. The database
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

- **The mail it sends** goes out from the server itself, straight to the
  recipient's mail servers, so it passes through no mail service elsewhere.
  `PELAGO_MAIL_FROM` names the sender (`Archipelago <signin@example.com>`);
  without it nothing is sent, and the server's log says only each message's
  subject: never its text, which holds sign-in codes. No mail carries a
  sign-in link: from a young domain, one reads to spam filters as phishing,
  so a sign-in mail holds a code, and an invitation says to sign in with the
  address. An address with no workspace is sent nothing when it asks to sign
  in. An address that bounced for good is sent nothing for 90 days: the relay
  hands each failure notice to `POST /connect/bounce` with
  `PELAGO_BOUNCE_SECRET` as its bearer token (without that setting none is
  taken).
  For it to arrive, and not as spam, the sending domain needs: an SPF record
  naming the server's address (`v=spf1 ip4:<address> -all`), a DKIM key
  (`openssl genrsa -out dkim.pem 2048`; the private key in `PELAGO_DKIM_KEY`,
  as PEM or a file path, with `PELAGO_DKIM_SELECTOR`, and the public half as
  a TXT record at `<selector>._domainkey.<domain>`), a DMARC record, and the
  server's reverse DNS set to its name. The host must let it out on port 25.
  `PELAGO_SMTP_URL` hands mail to a relay instead (`smtp://user:pass@host:587`
  or `smtps://…:465`); a password is never sent without TLS. A host that may not
  send on mail ports can hand mail to a relay it reaches over a private
  network.
- **Nothing passes between workspaces.** A document reaches someone outside
  by a link; guests, notifications and shares by workspace were dropped
  (10 Nov 2026). A known person is added as a member, read-only where wanted.
- **The Workspace screen** manages all of this: your agent tokens, members
  and the default visibility.

Limits, stated plainly: unless told otherwise the server listens on this
machine only, and it never speaks TLS itself: hosted, that ends at the
platform in front of it. And on a single machine an agent running as your OS user can read any
token you keep in a file or environment variable, so tokens are a real
boundary between machines and between customers, not between you and an agent
on your own laptop.

## Tests

```bash
npm test            # the fast set: all but the slow files test/sets.ts names
npm run test:full   # every file, as CI runs them (CI is the gate: not needed before a push)
npm run test:changed  # what this branch's changes can reach
npm test -- test/a.test.ts  # just those files: what to run while working
npm run typecheck
```

One run uses the machine at a time: a second, from any worktree, waits for it
(`test/lock.ts`). A run of a set skips the files that passed on the same code
before (`test/passes.ts`); `--no-cache` runs them all.
