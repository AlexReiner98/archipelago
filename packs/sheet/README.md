# Sheet

The sheet over the canvas, an item's one page. A root pack: its parts change
only through a root re-pin, never by the refiner, because what keeps a person
in control here stays protected (decisions e_gyzm7rj3, e_bn76z5fu).

## Its parts, walled

| Part | Slot | Code |
|---|---|---|
| `sheet.page` | `sheet` | `parts/page/`: the title, head, note, fields, choices, source, links picked, Save and history |
| `sheet.follow` | `sheet` | `parts/follow/`: the page shown follows the reading |

`sheet.page` reads items whole and writes the starter types as the person
(`reads: "*"`, `writes`, a root pack's part alone). Frame, fields, links and
draft are one part because the note and every field share one Save. It
opens two slots: `sheet.bands`, under the title, and `sheet.sections`,
below the source and above history, where other packs' sections stand
(e_axz9au5f).

## What stays the host's

`page/item.js` is the frame. It holds the frame's menu with the kernel's
acts (publish, share, launch, end a session, a pack's actions) beside the
part's own menu (e_dd7gdy8z), and the public mark. It reads the item once
and tells the parts as data (`page`: the item, its links, source, owner,
history, and the names of the items its fields name). It fills the two slots
with what the host draws: the changes held on it and a pack's action form,
and the screens' sections.

`page/screens.js` draws the screens' pieces. `page/draft.js` and
`page/note-count.js` are kept for a new item, which no part makes yet.
