# Contributing to Archipelago

Archipelago is published as it is, with no promise of answers or fixes. It is
built by one person and their agents. You may open an issue or propose a
change, and either may go unanswered.

## Reporting a problem

Open an issue. Say what you were doing, what happened, and what you expected.
For a problem with security, do not open an issue: see [SECURITY.md](SECURITY.md).

## Proposing a change

For anything larger than a fix, open an issue first and say what you want to
change and why. It saves you writing something that does not fit.

A change is ready to be looked at when:

- `npm test` and `npm run typecheck` pass. Both run on every pull request, on
  Linux and Windows.
- What it changes in behaviour has a test that would fail without it.
- What it changes in the web UI you have looked at in a browser, at 1280 and
  at 560 pixels wide.
- The README says what a user now needs to know.

Code written with an agent is as welcome as any other. You answer for it:
read it before you send it.

## What holds the design together

These are refused in review, so they are said here first.

- **The log is the truth.** Every change to items and links goes through
  `Archipelago.change` and is appended to the workspace's log; the tables
  pages read are projections of it, written only by the projector
  (`src/replay.ts`). What skips approval (sessions, claims, notifications,
  settings) goes to the operational streams, each store named in
  `src/operational.ts`.
- **No read of the whole map.** Every query of items, links or the log is
  bounded by an id, a subtree, a person, a cursor or a limit, or goes by an
  index the schema makes.
- **The database enforces who sees what** (row level security in
  `src/db.ts`). No visibility filters in application code. If something must
  cross the privacy line, it is a narrow `security definer` function.
- **Types live in pack files** under `packs/`, not in code.
- **The UI has no build step and no framework.** Plain files in `ui/`. It
  asks its questions in the page: no `confirm`, `prompt` or `alert`.
- **Four dependencies.** A change that adds a fifth needs a reason that
  stands on its own.
- **An agent is not the owner.** Nothing may let an agent approve, launch or
  manage tokens.

`CLAUDE.md` holds the fuller working rules, written for agent sessions and
true for people too.

## Licence

Archipelago is licensed under the [MIT License](LICENSE). What you contribute is
licensed under the same terms.
