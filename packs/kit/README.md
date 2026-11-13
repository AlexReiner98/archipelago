# kit

The page kit: what every page of the host is drawn with. The first root with a page, so every root after it imports
it in order (`packs/roots.json`, `test/structure-page.test.ts`).

- `base.js`: making nodes, calling the server, the session's state, asking and telling, the hooks a root names
  what it offers by, and the slot asks (`drawSlot`, `drawSlots`, `askSlot`), which reach the part runtime by name
  (`hooks.partsRuntime`, set by the page's entry).
- `theme.js`, `words.js`, `dom.js`, `body.js`, `text.js`, `menu-place.js`, `plates.js`: the theme, the schema's
  words, an element, a note and its dialect, where a menu opens, a plate.

It names no later root's file. What it needs of one it asks for by name.
