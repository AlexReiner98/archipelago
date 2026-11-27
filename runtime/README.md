# The runtime

The kernel: a small Cordis runtime ([arXiv 2608.25512](https://arxiv.org/abs/2608.25512))
and its loader. No dependencies. The same TypeScript runs on Node 22.18+ (type
stripping) and in the browser (the dev server strips types).

| File | What it is | Paper |
|---|---|---|
| [core.ts](core.ts) | Effects, coeffects, fibers, the Caller | §3.1–3.3, §5.1 |
| [loader.ts](loader.ts) | The config tree: load, unload, disable, order | §5.2.1 |
| [hmr.ts](hmr.ts) | The module graph HMR walks | §5.2.2 |
| [node.ts](node.ts) | Node host: resolve hook, watcher, HMR | |
| [serve.ts](serve.ts) | Dev server for the browser: types stripped, HMR pushed; with `files`, that folder's raster images at `/files/`; with `mounts`, plugin folders at `/ext/<name>/` | |
| [folders.ts](folders.ts) | Plugin folders kept outside this repository: their `<folder>/archipelago.json`, read into server and page entries | |
| [guard.ts](guard.ts) | What every local server checks first: its own Host, and no foreign Origin | |
| [browser.ts](browser.ts) | Browser host | |

## A plugin

```ts
export default {
  id: "verdict",
  about: "Judges whether each node worked.",        // one plain sentence: what a person reads about it
  inject: ["exchange.watch", "action.register"],   // stays inactive until each is provided
  apply(ctx, config) {
    const watch = ctx.get("exchange.watch");       // only keys it injected
    watch.on(/* … */);                              // returns a Dispose: this plugin's effect
    ctx.effect(() => { /* change */ return () => { /* undo */ }; });
  },
};
```

Everything a plugin registers goes when it unloads. A key nothing provides
leaves the plugin waiting; when the provider comes back, so does the plugin.
A provider can be removed at any time: its consumers tear down first, then
it does. A teardown that hangs past `runtime.teardownLimit` (5 s) is
reported and skipped, never waited on forever.

## A provider

```ts
ctx.provide("action.register", (caller, from) => ({
  register: (def) => from.effect(() => { add(def, caller); return () => remove(def); }),
}));
```

`serve(caller, from)` runs once per calling context. `caller` is who calls
(`Caller` in spec/common.ts): the plugin, the actor and run that interception
set (`from.intercept({ actor, run })`), and the plugin's position in the config
tree, all read live. Making a registration `from.effect(...)` makes it the
caller's, so it goes when the caller unloads. Brokers order contributions with
`byPosition(a.caller, b.caller)`. When several active plugins provide a key, the
first in the config tree is bound.

## The config tree

```ts
await loader.apply([
  { id: "graph", plugin: "./plugins/graph/index.ts" },
  { id: "page", intercept: { actor }, children: [
    { id: "panel", plugin: "./plugins/panel/index.ts", config: { … } },
  ] },
]);
```

A new url rebuilds an entry, a new config reloads it, `disabled` unloads it,
`intercept` changes in place, and a move only changes order.
`loader.status()` gives each entry's state: `off` (disabled), `waiting`
(with the capabilities it is `missing`), `active`, `failed` and so on.

## Plugin folders

Plugins can be kept outside this repository, in a folder of their own
(another repository), and loaded beside the ones here:
`npm run map -- plugins add <dir>` once, and the map loads it on every
start from then on. The list is kept with the map's data, in
`<map>/plugins.json` (`{ "folders": [<dir>, …] }`), so `npm run map --
serve`, `live:start`, `archipelago` and `promote` bring the folders back
with no variable set; a copy of a map (`--from`, a branch map copied from
live) loads the same ones. `plugins ls` lists them, `plugins rm <dir|name>`
takes one out; each takes effect at the next start. `--map live` for live.

For one start only, `node app/server.ts --plugins <dir>` (once for each
folder), or `ARCHIPELAGO_PLUGINS` with the folders split by the path
delimiter, which `npm run map -- serve` and live pass on: either wins over
the map's list. A folder named but not loadable (gone, no manifest, a
second of one name) is left out in one line, naming it and where the list
came from; the rest start. Which folders loaded, and from where, are in
`live:status`, `npm run map -- ls` and the page's Plugins view ("Plugin
folders", [plugins/serving](../plugins/serving/README.md)). The folder's `<folder>/archipelago.json`
names it and lists its entries, paths relative to it:

```json
{ "name": "design",
  "server": [{ "id": "solver", "plugin": "solver/map.ts" }],
  "page": [{ "id": "solver", "plugin": "solver/index.ts" }] }
```

- The server's entries come after this repository's; the page's are
  served at `/ext/<name>/`, listed at `/app/plugins.json`, and added after
  the page's own ([app/boot.ts](../app/boot.ts)).
- Its code imports this repository by package name:
  `from "archipelago/spec/graph.ts"`. The Node host resolves it to the
  checkout that serves ([node.ts](node.ts)), and the page server rewrites
  it to `/spec/graph.ts`: either way the same module this repository's
  plugins import, never a second copy. The folder's own `node_modules`
  (`npm install <this checkout>`, which links it) is only for its type
  check and its tests.
- A server entry that says `"writes": true` (it writes files outside the
  map's data, such as skills or settings) is off on a server that doesn't
  write (`--no-write`, `npm run dev`). Each server entry whose config is an
  object, or absent, is given the map's data folder as `config.data`.
- A folder's page files are not watched: a change to one needs a reload.
- No sandbox: a folder's plugins are trusted as this repository's are.

## Running it

- `npm test` runs the tests, `npm run check` typechecks.
- `npm run dev` serves the repository on port 5280 (dev); open
  `/test/browser/` for the fixture page, and edit `test/browser/plugins/word.ts`
  to see a hot reload.
- A change to `runtime/` itself is declined by HMR: restart.
