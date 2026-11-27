# serving

Which code and which map a server is, so two servers never look the same in
the browser. The page's header shows one quiet line, **map · commit ·
checkout**: the map's name (a server without one shows its port), the commit
(`+` when the checkout has changes not committed) and the checkout's folder
name. The whole path and the port are in its title.

| File | Runs | What it is |
|---|---|---|
| [index.ts](index.ts) | server | `serving.about`: `{ map, commit, checkout, port, folders }`. Read only. Config `map`, `commit`, `checkout`, `port`, `folders`, set by [app/tree.ts](../../app/tree.ts); behind a host there is no `checkout` and no `folders` |
| [view.ts](view.ts) | page | Fills `top` with the line (`lineOf`), and `docs.list` with "Plugin folders" (`foldersOf`): each plugin folder loaded and its path, where the list came from (`--plugins`, `ARCHIPELAGO_PLUGINS`, or remembered by the map), and each named folder that didn't load, with why. Injects `action.invoke`, `slot.fill` |

A map is served by name with `app/server.ts --map` (`npm run map`,
[guide/live-and-dev.md](../../guide/live-and-dev.md), "Maps by name").
