# serving

Which code and which map a server is, so two servers never look the same in
the browser. The page's header shows one quiet line, **map · commit ·
checkout**: the map's name (a server without one shows its port), the commit
(`+` when the checkout has changes not committed) and the checkout's folder
name. The whole path and the port are in its title. A map served here by
name also says whether it is the current one (the switch, `npm run map --
use`): **current** after its name when it is; when it isn't, the line turns
the failed colour and its title names the map sessions report to instead.
It is asked again whenever the page comes back into view.

| File | Runs | What it is |
|---|---|---|
| [index.ts](index.ts) | server | `serving.about`: `{ map, commit, checkout, port, folders, switch }`, `switch.current` the map the switch names, read at each call. Read only. Config `map`, `commit`, `checkout`, `port`, `folders`, `sayCurrent`, set by [app/tree.ts](../../app/tree.ts); behind a host there is no `checkout`, no `folders` and no `switch` |
| [view.ts](view.ts) | page | Fills `top` with the line (`lineOf`), and `docs.list` with "Plugin folders" (`foldersOf`): each plugin folder loaded and its path, where the list came from (`--plugins`, `ARCHIPELAGO_PLUGINS`, or remembered by the map), and each named folder that didn't load, with why. Injects `action.invoke`, `slot.fill` |

A map is served by name with `app/server.ts --map` (`npm run map`,
[guide/live-and-dev.md](../../guide/live-and-dev.md), "Maps by name").
