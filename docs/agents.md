# Agents held to the map: principles and structure

An agent works through the same ten tools as a person, and what it is asked
to do is held the same way the page's looks are: as items the map keeps,
read each time, checked by rules kept as data. Five principles decide it;
from them a developer can predict how an agent is told, checked and
reconciled, and each names the check in `npm test` that holds it. The words
are `docs/glossary.md`; the project is "Agents held to the map" on the map.

## The principles

### 1. What an agent is told is items on the map
Every sentence an agent is asked to keep is an `instruction` item: a pack
ships it as a preset, and the owner changes it by keeping their own version
on the map (its `preset` field names the one it replaces; retired, it is not
said). Its `for` says where it is said: `session_start`,
`working_rules` (the rules file a project is handed),
`tool:<name>`, `guide:<name>` (a guide an agent reads when it asks: core
view `instructions` with that `for`), `file:<glob>`. Each working rule is worded once, in its preset, and said in
one place only. Nothing an agent is told is written in kernel code or
hand-written in a file beside it.
- `test/instructions.test.ts`: "what is said: presets in order, the owner's
  version in its place, retired not said, a repository's over the
  workspace's"; "the session-start text is read from the instructions on the
  map"; "each working rule is said once: in the rules file a project is
  handed, from its preset, and nowhere else".
- `test/surface.test.ts`: "an agent’s instructions name only the surface:
  every other action by its verb".

### 2. A check is a rule on a reply ending, asking once
What an agent should have done before it stops is a rule in a pack's
`rules` with `on: "reply_ended"`: a `when.reply` over the facts the session's
hook counted since the owner’s last message, a one-line `say`, and the
setting that lifts it (`lifted`, `reply_<name>`). When it holds the agent is
asked once that turn, never while it is already going on because a hook
asked, and the asking is kept as a beat of the run's story. The owner sees
each rule on the Workspace page's Checks card, with how often it asked in
the last week and a switch that lifts it. Such a rule has no say over a
change: `judge` skips it, and what applies or waits stays the other rules'
(`decide` in `src/rules.ts`).
- `test/replies.test.ts`: "a rule on a reply ending is checked as data"; "a
  rule on a reply ending has no say over a change"; "a reply that did what a
  rule names is asked once a turn, the asking kept in its story, until the
  owner turns it off" (with the Checks card's row from `workspace_info`);
  "the hook counts what the reply did since the owner’s last message".
- `test/structure.test.ts`: "every approval is decided by a rule".

### 3. Answers are drawn when they have a shape
An answer about several items, or how they relate, order or stand, is a
view opened with `report` action `show`, with one line in chat; a yes, a
number or one item is a line in chat. It is said at session start
(`core.draw_answers`, an instruction) and checked by core's reply rule
`draw_answers`, lifted by `reply_draw_answers`: a reply that surveyed the
map and changed, edited, committed and showed nothing is asked once to draw
it.
- `test/replies.test.ts`: "core asks a reply that answered from the map and
  drew nothing to draw it, and the owner can turn that off"; "the
  session-start text tells an agent to answer the owner with a drawing".

### 3a. What an agent finds is told, unasked
The map, not the chat, is the record of a session's work: each thing an
agent concludes (a cause, a finding, a choice and why) is a beat told with
`report` action `tell`, and each item it settles is changed. The session
start leads with it (`core.report_in`), and core's reply rule
`record_findings`, lifted by `reply_record_findings`, asks a reply that
called other tools at least six times (`worked`) and neither told nor
changed anything (a note updated is as much a record as a new one: the
owner, 2 Nov 2026) to tell what it found before it answers. A `when.reply`
fact may be a number: at least that many times. The owner sets another
number on the check's row (`workspace_set` `asks_at`, kept as the setting
`<lifted>_at`).
- `test/replies.test.ts`: "core asks a reply that worked and put nothing on
  the map to tell what it found, at a number the owner sets, until they turn
  it off"; "the
  session-start text says the map, not the chat, is the record, and that
  telling is checked".

### 4. A commit names its session
Each commit a session makes names its run in an `Archipelago-Run` trailer.
The kernel does not account for commits: nothing asks a session to record
them, and nothing lists the ones nobody recorded (removed 9 Nov 2026,
decision e_xtgbfhdj). A pack may give commits a type of their own.

- `test/commit-run.test.ts`: "a commit a session makes names its run, and
  one made by anybody else does not; the setup puts the hook in and takes it
  out".

### 5. What a session touched is kept with its run
The items a session read, showed or changed, and the commits it made, are
kept with its run, so two sessions on one token are told apart. When it
ends (`report` action `session_end`), it is asked first about what it
touched and nobody has changed since it began: change each, vouch that it
is still true, or say it cannot tell. A run a chat keeps is one session for
as long as the chat lives: its agent's end says where the work stands and
leaves it open, waiting, the chat ending closes it, and a prompt takes up one
that was ended.
- `test/sessions.test.ts`: "one chat is one session: its agent saying it is
  done keeps it open, and only the chat ends it".
- `test/touched.test.ts`: "what a session touched is kept with its run,
  apart from another session of the same agent"; "in a repository, what the
  session touched is asked about first"; "the hook reads from the transcript
  the items the session’s calls to the map named".

### 6. A chat's tab lives as the chat does, whatever the client
The owner's page gives every open chat a tab, named by the chat's title and
closed when the chat ends (the design e_p6fr4uye). Every client says the
same four things, by MCP alone; Claude Code's hooks are one adapter onto
them, not the model:

| Call | Carries |
|---|---|
| `capture` `session_start` | `session_id` (the client's own), `title`, `surface`, `cwd`, `remote`, `source` (`clear` to go on in the tab of the session a clear ended) |
| `report` `session_update` | `title` when the chat is renamed |
| `report` `session_end` | `reason` when the chat itself has ended (closed, archived, exit, clear); without it the chat goes on |
| any call | heard-from: a chat not heard from for 12 hours is ended for it |

Claude Code's hook reads the title from the transcript (the owner's, else
the one Claude Code made) at the start and at every event, and passes
SessionStart's `source` and SessionEnd's `reason`.
- `test/sessions.test.ts`: "a session is called what its chat is called";
  "a chat that ends ends its session, and after a clear the next one in its
  folder takes over its tab"; "Claude Code's hooks name a session by its chat".
- `test/tabs*.test.ts`, `test/show-*.test.ts`: the tabs in a browser, a test
  to a file.

## The modules

### On the agent's machine
| Module | What it is |
| --- | --- |
| `scripts/pelago-hook.mjs` | Claude Code's hooks (session-start, prompt, stop, session-end) sent to the server, with what the transcript says: tokens, the items touched, the commits made, the turn and what the reply did |
| `scripts/pelago-setup.mjs` | installs the hooks, the commit-msg hook that adds the trailer, and the `.worktreeinclude` lines that carry them into worktrees |
| `<git common dir>/pelago-runs/<session id>` | the run a session is registered as, read by the commit-msg hook |

### On the server
| Module | What it is |
| --- | --- |
| `src/instructions.ts` | what is said where: presets under the workspace's under a repository's (core view `instructions`) |
| `src/working-rules.ts` | the rules file a project is handed: `examples/working-rules.md` with the `working_rules` presets at its marker |
| `src/hook-answers.ts` | what each hook is answered; keeps what was touched, asks the reply rules at stop |
| `src/sessions.ts` | session start and end; the session-start text |
| `src/reply-rules.ts`, `src/replies.ts` | a reply rule checked as data and when it holds; asking once a turn, kept in the story; how often each asked |
| `src/touched.ts`, `src/reconcile.ts` | the set a run touched; what a session has left unsaid when it ends |
| `src/workspace-tools.ts`, `ui/workspace-cards.js` | `workspace_info.reply_rules`, and the Checks card that draws it with its switches |

### In `packs/`
| Pack | What it adds |
| --- | --- |
| `core` | the `instruction` type and its presets; the reply rules `draw_answers` and `record_findings` |
| `software` | the instructions `build_first` (lay a build out as items and have the owner agree it before the first edit) and `drawing_on_map` (a drawing is a style on the map), and the guide `guide:style_code` |
| `github` | `account.js`: the check on main, answered from the map |
| `github_app` | `checks.js`: posts the check, keeps it while red, asks again each minute |

## How a session is told
1. The SessionStart hook sends the session id, folder and remote; the server registers a run and says its id
   in the `x-pelago-run` header, which the hook keeps in `pelago-runs/`.
2. `hookSessionStart` builds the text from the map: the repository, what
   waits, answers to confirm, then `instructionsFor('session_start')` with `{run}` filled in.
3. The rules file (`.claude/pelago.md`) is the frame in
   `examples/working-rules.md` with each `working_rules` preset as one
   bullet, handed out by `src/connect.ts`.

## How a reply is checked
1. At each turn's end the stop hook reads the transcript since the owner's
   last message: `read`, `surveyed`, `showed`, `changed`, `told`, `worked`,
   `edited`, `committed`, `pushed`, with the turn's id and the items touched. A call to another workspace's server (one named `pelago-<name>`)
   counts as a read, change or tell too; its items are not this map's.
2. `askOnReply` takes the reply rules not lifted whose `when.reply` holds and that have not
   asked this run and turn, and answers `{decision: "block", reason}` with
   their `say`; each asking is a beat with `asked`.
3. The agent goes on with `stop_hook_active` set, so nothing asks again
   until the owner's next message.

## How a session is reconciled
1. Each commit carries `Archipelago-Run: <run>`, added by the commit-msg
   hook from the session's run file.
2. `session_end` lists what the session touched, then the repository's open work nobody changed since it
   began, to change, vouch for or say it cannot tell. The sets are kept a
   week after.

## What is not yet so
- `tool:<name>` instructions are declared but no tool description reads them
  yet.
- The rules file is filled from the packs' presets in the checkout, not the
  owner's versions on the map.
- Files written through Bash are not counted as `edited`, so a reply that
  read a view and wrote code that way can be asked to draw once.
- A map server connected under a name not starting with `pelago` (a
  claude.ai connector) is counted as work, not as the map.
- A session in a worktree has hooks only once the setup was run in the
  checkout, so that `.worktreeinclude` carries them.
