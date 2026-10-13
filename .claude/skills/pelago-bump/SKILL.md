---
name: pelago-bump
description: Record friction with Archipelago on the Archipelago map, the moment it happens. Use this whenever Archipelago itself gets in the way while you work, in any repository: a pelago tool errors or refuses something reasonable, you need a second call or a workaround to do one thing, a view lacks what you needed or answers with something stale or wrong, a tool description misled you, the web UI shows something badly, a hook or the GitHub workflow misbehaves, or the owner complains about how Archipelago behaves or looks. Also use it when the owner says "bump", "note that", "that was annoying" or "record that" about Archipelago. Do not wait to be asked: a bump nobody wrote down is hit again by the next session.
---

# Archipelago bump

Archipelago is built by using it. Every time it slows you or the owner down, that
is a finding about the product, and it is only worth something if it is on the
map, where the next session will see it in the repository's work list. A bump
left in the chat is lost when the chat ends.

Recording one takes a minute. Do it when it happens, then go back to what you
were doing. Do not stop to fix it unless the owner asks or the fix is a line.

## What counts

Anything where Archipelago, not the task, cost you something:

- a tool call that failed, or needed a retry in a different shape;
- something that took several calls and should take one;
- a workaround (going around the tools with curl, resending a whole body to
  change a line, guessing an id);
- an answer that was stale, wrong, far too large, or missing the one field you
  needed;
- a description, hook text or CLAUDE.md line that sent you the wrong way;
- anything in the web UI the owner had to squint at, or said was bad;
- the hosted server, a hook or the Actions workflow not doing what it says.

What does not count: a bug in the code you are working on, or a mistake of
your own that Archipelago could not have prevented. If Archipelago could have
prevented it cheaply, it counts.

## How to record one

1. **Find the home.** Bumps live as issues under the Archipelago project's feature
   for friction. `search` with type `software.feature` and q `friction`. On the
   owner's hosted map its id is in `references/home.md`. If there is none in
   this workspace, create the issue as part of the Archipelago project instead.

2. **Look for it first.** `search` with type `issue`, open only, and two or
   three words of what happened. The same bump is usually already there.

3. **If it is there, add to it.** `get` it, then `update` its body with one
   more dated line under "Seen": what you were doing and what happened. A bump
   seen five times matters more than one seen once, and the lines are how
   anyone can tell. If it was marked resolved and you have just hit it again,
   reopen it and say so.

4. **If it is new, create an issue**, part of the friction feature:
   - **Title**: what is wrong, named in a few plain words a person would nod
     at, 60 characters at most (the server refuses longer from an agent).
     "A long note is re-sent whole to change a line", not "body update UX"
     and not a full sentence with its consequence: that is the note's first
     line.
   - **Body**, short, in this shape:

     ```
     Seen
     - 8 Oct 2026, in pelago: updating a handoff six times in a session, each
       time resending about 4,000 characters to change a sentence.

     What I did instead
     Resent the whole body.

     What would make it smooth
     An update that appends to, or replaces part of, a body.
     ```

   - **props**: `kind: "problem"`, and `severity`: `high` if it stopped the
     work or lost something, `medium` if it cost real time or would mislead,
     `low` if it is only awkward.
   - **authority**: `{"of": "agent", "basis": "<what you saw, in which session>"}`.
     If the owner said it, it is theirs: `of: "human"` with their words.
   - Put exact error text in the body when there was one. It is what the
     person fixing it will search for.

5. **Say so in one line** in your next message to the owner ("Recorded a
   Archipelago bump: ..."), and carry on.

## When one is fixed

When a change removes a bump, resolve its issue in the same breath, with the
commit. Naming the id in the commit message ("fixes e_...") on the default
branch closes it by itself.

## Keeping this smooth

Recording a bump must itself stay cheap. If doing this took more than a couple
of calls, or the search did not find a bump you later saw was there, that is a
bump: record it.
