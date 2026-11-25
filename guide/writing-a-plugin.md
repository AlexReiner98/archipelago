# Writing a plugin

A plugin is one module whose default export is a `Plugin`
([runtime/core.ts](../runtime/core.ts)). The same source runs on Node and
in the browser, with no build.

## The smallest one

```ts
import type { Context, Plugin } from "../../runtime/core.ts";

const hello: Plugin = {
  id: "hello",
  about: "Says hello: an example.",
  inject: ["slot.fill"],
  apply(ctx: Context) {
    ctx.get("slot.fill").fill({ slot: "left", name: "hello", title: "Hello", view: () => "Hello" });
  },
};

export default hello;
```

`about` is one plain sentence for a person; the Plugins view shows it, and a
test holds every plugin to having one.

## Load it

Add an entry to the config tree: [app/boot.ts](../app/boot.ts) for the
page, [app/tree.ts](../app/tree.ts) for the server. On dev the runtime
reloads it as you edit. [plugins/examples/](../plugins/examples/README.md) has
two to copy, off until turned on.

## What it may do

- Ask for what it uses in `inject`, and nothing else. A key nothing
  provides keeps it inactive, never broken.
- Change the map only through an action it registers
  ([action](../spec/action.md)), so every change is recorded and can be
  undone. A UI never writes directly.
- Read the graph or the exchange in bounded pages: ids given, or a limit
  and a cursor.
- Style with the shared tokens only ([style](../spec/style.md)).

## Ship it

- Its tests, in `test/<plugin>.test.ts`: input in, what it records or
  answers out.
- A README in its folder: what it is for, what it adds, its rules. The
  Guide shows it beside the plugin's page.
- `npm run check` and `npm test` pass.
