---
name: pelago-bump
description: >-
  Record friction with Archipelago on the Archipelago map, the moment it happens. Use this whenever Archipelago itself gets in the way while you work, in any repository: a pelago tool errors or refuses something reasonable, you need a second call or a workaround to do one thing, a view lacks what you needed or answers with something stale or wrong, a tool description misled you, the web UI shows something badly, a hook or the GitHub workflow misbehaves, or the owner complains about how Archipelago behaves or looks. Also use it when the owner says "bump", "note that", "that was annoying" or "record that" about Archipelago. Do not wait to be asked: a bump nobody wrote down is hit again by the next session.
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
- the hosted server, a hook or the Actions workflow not doing what it says;
- the map saying something the code no longer bears out: an item still "not
  merged" after the merge, a "Left" list another commit has done, a title
  stating a problem that is fixed, "doing" on merged work, a handoff that
  names the wrong head.

What does not count: a bug in the code you are working on, or a mistake of
your own that Archipelago could not have prevented. If Archipelago could have
prevented it cheaply, it counts.

## How to record one

1. **Find the home.** Bumps live as issues under the Archipelago project's feature
   for friction. `query` with name `search`, params type `feature` and q
   `friction`; `references/home.md` says the same for this workspace. If there
   is none, create the issue as part of the Archipelago project instead.

2. **Look for it first.** `query` `search` with type `issue`, `open: true`, and
   one distinctive word of what happened in q (a search of several words can
   miss what one finds). The same bump is usually already there.

3. **If it is there, add to it.** `query` `get` it, then `change` it with an `update` op that appends one
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

5. **A map found out of date** is corrected before it is counted. Fix the item
   itself first (its status, or a "Stands at" line rewritten, not appended),
   then add one dated line under "Seen" on the open issue about the map going
   stale (search q `stale`; create it if there is none), naming which cause it
   was, so the causes are counted:
   1. a body keeps "not merged" or "not pushed" after the merge;
   2. the title or first line states a problem the fix below it removed;
   3. another commit did part of the item's "Left" list;
   4. "doing" lingers on merged work that waits only on a look;
   5. the map heard nothing of commits that were not pushed;
   6. the item read as confirmed because any edit counts as a check.

6. **Say so in one line** in your next message to the owner ("Recorded a
   Archipelago bump: ..."), and carry on.

## When one is fixed

When a change removes a bump, resolve its issue in the same breath, in the
change that records the commit (a commit item with its sha, linked settles to
the issue).

## Keeping this smooth

Recording a bump must itself stay cheap. If doing this took more than a couple
of calls, or the search did not find a bump you later saw was there, that is a
bump: record it.
