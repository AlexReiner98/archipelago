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
| [serve.ts](serve.ts) | Dev server for the browser: types stripped, HMR pushed | |
| [guard.ts](guard.ts) | What every local server checks first: its own Host, and no foreign Origin | |
| [browser.ts](browser.ts) | Browser host | |

## A pack

```ts
export default {
  id: "verdict",
  about: "Judges whether each node worked.",        // one plain sentence: what a person reads about it
  inject: ["exchange.watch", "action.register"],   // stays inactive until each is provided
  apply(ctx, config) {
    const watch = ctx.get("exchange.watch");       // only keys it injected
    watch.on(/* … */);                              // returns a Dispose: this pack's effect
    ctx.effect(() => { /* change */ return () => { /* undo */ }; });
  },
};
```

Everything a pack registers goes when it unloads. A key nothing provides
leaves the pack waiting; when the provider comes back, so does the pack.
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
(`Caller` in spec/common.ts): the pack, the actor and run that interception
set (`from.intercept({ actor, run })`), and the pack's position in the config
tree, all read live. Making a registration `from.effect(...)` makes it the
caller's, so it goes when the caller unloads. Brokers order contributions with
`byPosition(a.caller, b.caller)`. When several active packs provide a key, the
first in the config tree is bound.

## The config tree

```ts
await loader.apply([
  { id: "graph", pack: "./packs/graph/index.ts" },
  { id: "page", intercept: { actor }, children: [
    { id: "panel", pack: "./packs/panel/index.ts", config: { … } },
  ] },
]);
```

A new url rebuilds an entry, a new config reloads it, `disabled` unloads it,
`intercept` changes in place, and a move only changes order.
`loader.status()` gives each entry's state: `off` (disabled), `waiting`
(with the capabilities it is `missing`), `active`, `failed` and so on.

## Running it

- `npm test` runs the tests, `npm run check` typechecks.
- `npm run serve` serves the repository on port 5280 (dev); open
  `/test/browser/` for the fixture page, and edit `test/browser/packs/word.ts`
  to see a hot reload.
- A change to `runtime/` itself is declined by HMR: restart.
