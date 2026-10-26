# Agents held to the map: principles and structure

An agent works through the same nine tools as a person, and what it is asked
to do is held the same way the page's looks are: as items the map keeps,
read each time, checked by rules kept as data. Five principles decide it;
from them a developer can predict how an agent is told, checked and
reconciled, and each names the check in `npm test` that holds it. The words
are `docs/glossary.md`; the project is "Agents held to the map" on the map.

Parts marked **(not merged yet)** describe a branch that is built but not on
`claude/agents-held-together`; **(being built)** is a branch still under way.
Each mark goes once its branch lands.

## The principles

### 1. What an agent is told is items on the map
Every sentence an agent is asked to keep is an `instruction` item: a pack
ships it as a preset, and the owner changes it by keeping their own version
on the map (its `preset` field names the one it replaces; retired, it is not
said). Its `for` says where it is said: `session_start`, `working_rules` (the
rules file a project is handed), `tool:<name>`. Each working rule is worded
once, in its preset, and said in one place only. Nothing an agent is told is
written in kernel code or hand-written in a file beside it.
- `test/instructions.test.ts`: "what is said: presets in order, the owner's
  version in its place, retired not said, a repository's over the
  workspace's"; "the session-start text is read from the instructions on the
  map"; "each working rule is said once: in the rules file a project is
  handed, from its preset, and nowhere else".
- `test/surface.test.ts`: "an agent's instructions name only the surface:
  every other action by its verb".

### 2. A check is a rule on a reply ending, asking once
What an agent should have done before it stops is a rule in a pack's
`rules` with `on: "reply_ended"`: a `when.reply` over the facts the session's
hook counted since the owner's last message, a one-line `say`, and the
setting that lifts it (`lifted`, `reply_<name>`). When it holds the agent is
asked once that turn, never while it is already going on because a hook
asked, and the asking is kept as a beat of the run's story. Such a rule has
no say over a change: `judge` skips it, and what applies or waits stays the
other rules' (`decide` in `src/rules.ts`).
- `test/replies.test.ts`: "a rule on a reply ending is checked as data"; "a
  rule on a reply ending has no say over a change"; "a reply that did what a
  rule names is asked once a turn, the asking kept in its story, until the
  owner turns it off"; "the hook counts what the reply did since the owner's
  last message".
- `test/structure.test.ts`: "every approval is decided by a rule".

### 3. Answers are drawn when they have a shape
An answer about several items, or how they relate, order or stand, is a
lens opened with `report` action `show`, with one line in chat; a yes, a
number or one item is a line in chat. It is said at session start
(`core.draw_answers`) and checked by core's reply rule `draw_answers`: a
reply that surveyed the map and changed, edited, committed and showed
nothing is asked once to draw it. **(not merged yet:
`claude/answers-drawn-f706d1`)**
- `test/replies.test.ts` (on that branch): "core asks a reply that answered
  from the map and drew nothing to draw it, and the owner can turn that
  off"; "the session-start text tells an agent to answer the owner with a
  drawing".

### 4. Every commit is accounted for before main
A commit is accounted for once the map holds a `software.commit` item for
its full sha, with a `software.settles` link to each item it settles (none
when it settles nothing). Each commit a session makes names its run in an
`Archipelago-Run` trailer. The check "Every commit accounted for" on a push
to main or a pull request into it is red until every commit is, and turns
green by itself. Commits nobody accounted for are put to the next session
that starts in the checkout **(not merged yet)**, and a reply that committed
is asked to account for its commits **(being built)**.
- `test/commit-run.test.ts`: "a commit a session makes names its run, and
  one made by anybody else does not; the setup puts the hook in and takes it
  out".
- `packs/github/account.test.ts`: "a push to main is checked: red while a
  commit has no commit item on the map, and says which, with its run"; "a
  pull request into main is checked by its commits; one elsewhere, or
  closed, is not"; "the run a commit names is read from its trailer only".
- `packs/github_app/github_app.test.ts`: "the check on main: posted as the
  installation, kept while red, asked again each minute until green, and on
  Re-run".
- `test/unaccounted.test.ts` (on `claude/next-session-commits-11dd73`): "a
  session starting in a repository is asked to account for the commits the
  map holds no item for".

### 5. What a session touched is kept with its run
The items a session read, showed or changed are a set kept with its run, so
two sessions on one token are told apart. When it ends (`report` action
`session_end`), it is asked first about what it touched and nobody has
changed since it began: change each, vouch that it is still true, or say it
cannot tell.
- `test/touched.test.ts`: "what a session touched is kept with its run,
  apart from another session of the same agent"; "in a repository, what the
  session touched is asked about first"; "the hook reads from the transcript
  the items the session's calls to the map named".

## The modules

### On the agent's machine
| Module | What it is |
| --- | --- |
| `scripts/pelago-hook.mjs` | Claude Code's hooks (session-start, prompt, stop, session-end) sent to the server, with what the transcript says: tokens, the items touched, the turn and what the reply did |
| `scripts/pelago-setup.mjs` | installs the hooks, the commit-msg hook that adds the trailer, and the `.worktreeinclude` lines that carry them into worktrees |
| `<git common dir>/pelago-runs/<session id>` | the run a session is registered as, read by the commit-msg hook |

### On the server
| Module | What it is |
| --- | --- |
| `src/instructions.ts` | what is said where: presets under the workspace's under a repository's (core view `instructions`) |
| `src/working-rules.ts` | the rules file a project is handed: `examples/working-rules.md` with the `working_rules` presets at its marker |
| `src/hook-answers.ts` | what each hook is answered; keeps what was touched, asks the reply rules at stop |
| `src/sessions.ts` | session start and end; the session-start text |
| `src/reply-rules.ts`, `src/replies.ts` | a reply rule checked as data and when it holds; asking once a turn, kept in the story |
| `src/touched.ts`, `src/reconcile.ts` | the set a run touched; what a session has left unsaid when it ends |
| `src/unaccounted.ts` | the checkout's commits the map holds no record for **(not merged yet)** |
| `src/commits.ts` | the commits a run made and which are unaccounted for **(being built)** |

### In `packs/`
| Pack | What it adds |
| --- | --- |
| `core` | the `instruction` type and its presets; the reply rule `draw_answers` **(not merged yet)** |
| `software` | `software.commit` (with the `accounts` capability, **not merged yet**) and `software.settles`; the reply rule `account_commits` **(being built)** |
| `github` | `account.js`: the check on main, answered from the map |
| `github_app` | `checks.js`: posts the check, keeps it while red, asks again each minute |

## How a session is told
1. The SessionStart hook sends the session id, folder and remote (and the
   checkout's 40 newest commits, **not merged yet**); the server registers a
   run and says its id in the `x-pelago-run` header, which the hook keeps in
   `pelago-runs/`.
2. `hookSessionStart` builds the text from the map: the repository, what
   waits, answers to confirm, then `instructionsFor('session_start')` with
   `{run}` filled in. With unaccounted commits, the `unaccounted_commits`
   presets follow, naming five and counting the rest **(not merged yet)**.
3. The rules file (`.claude/pelago.md`) is the frame in
   `examples/working-rules.md` with each `working_rules` preset as one
   bullet, handed out by `src/connect.ts`.

## How a reply is checked
1. At each turn's end the stop hook reads the transcript since the owner's
   last message: `read`, `showed`, `changed`, `committed`, `pushed` (and
   `surveyed`, `edited`, **not merged yet**), with the turn's id and the
   items touched.
2. `askOnReply` takes the reply rules not lifted whose `when.reply` holds and
   that have not asked this run and turn, and answers `{decision: "block",
   reason}` with their `say`; each asking is a beat with `asked`.
3. The agent goes on with `stop_hook_active` set, so nothing asks again
   until the owner's next message.

## How a session is reconciled
1. Each commit carries `Archipelago-Run: <run>`, added by the commit-msg
   hook from the session's run file.
2. A commit is accounted for with one change: a `software.commit` with its
   sha and `software.settles` links. The reply that committed is asked to
   make it **(being built: `account_commits`, reading the commits the turn
   made)**, and the next session in the checkout is told of any left over
   **(not merged yet)**.
3. `session_end` lists what the session touched, then the repository's open
   work nobody changed since it began, to change, vouch for or say it cannot
   tell; the set is kept a week after.
4. A push to main, or a pull request into it, is checked by
   `packs/github/account.js` and posted by the GitHub App; while red the app
   asks the workspace again each minute (a question, logged nowhere) until
   it is green.

## What is not yet so
- `tool:<name>` instructions are declared but no tool description reads them
  yet.
- The rules file is filled from the packs' presets in the checkout, not the
  owner's versions on the map.
- Files written through Bash are not counted as `edited`, so a reply that
  read a view and wrote code that way can be asked to draw once.
- A reply rule is turned off with `workspace_set` (`lifted`); there is no
  switch on the Workspace page yet (task "A switch to turn a reply rule
  off").
- A session in a worktree has hooks only once the setup was run in the
  checkout, so that `.worktreeinclude` carries them.
