---
name: archipelago
description: Keep this session on the Archipelago map. Use at the start of every session, before the first reply, and again when you take on a piece of work and when you finish.
---

# A session on the Archipelago map

The map's tools are the `map` server's (`mcp__plugin_archipelago_map__*`). Its own
instructions say how to work there; this says when.

- **At the start,** before your first reply: `capture` with action
  `session_start`, params `cwd`, the repository's `remote` (`git remote get-url
  origin`, if it has one) and `title` (a few words on what the chat is for).
  Keep the `run` it gives, and follow the instructions it hands back: they are
  the working rules for this map.
- **When you take something on:** `report` with action `session_update`, your
  `run`, and the item's id as `task`.
- **When you conclude something:** `report` with action `tell`, in a sentence.
- **At the end:** `report` with action `session_end`, your `run` and a
  `summary`.

If the tools say the server needs a sign-in, ask the person to run `/mcp`,
choose `plugin:archipelago:map` and sign in.
