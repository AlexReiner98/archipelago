/**
 * The app, page side: the browser runtime and its config tree. The bridge
 * provides the server's capabilities here; the style, renderer, here, frame, views (the picker),
 * harness, activity, history (the Then view: what changed between two points in the log), find, command, field (home), connect (a new map's first step), serving (which map, commit and checkout, in the header), sync (what the map syncs with, in the header), item, docs (the Plugins view), guide (the Guide) and switch (its on/off switches) plugins make the page. The bridge is two ports above the page
 * (5180 serves the page and 5182 the bridge, 5280 and 5282 for dev), or at
 * `/bridge/` on the page's own origin when a host in front serves both. `host` is on window, so a plugin can be turned
 * off from the console: `host.loader.edit(t => (t.find(e => e.id === "harness").disabled = true, t))`.
 */
import { startBrowser } from "../runtime/browser.ts";
import type { Entry } from "../runtime/loader.ts";

/**
 * Where the bridge is: at `/bridge/` on the page's origin when a host serves
 * both there (it answers `caps`); where the dev server's `/bridge/caps`
 * says (`{ at }`, runtime/serve.ts); else two ports above the page.
 */
async function bridgeUrl(): Promise<string> {
  const same = new URL("/bridge/", location.href).href;
  try {
    const r = await fetch(same + "caps");
    if (r.ok && (r.headers.get("content-type") ?? "").includes("json")) {
      const at = ((await r.json()) as { at?: unknown }).at;
      return typeof at === "string" ? at : same;
    }
  } catch {
    // Not there: the dev server's own ports.
  }
  return `http://${location.hostname}:${Number(location.port) + 2}/`;
}

/**
 * The page's entries from plugin folders kept outside this repository, as
 * the server lists them at `/app/plugins.json` (runtime/folders.ts): after
 * the ones here, in the folders' order. None when it isn't there.
 */
async function folderEntries(): Promise<Entry[]> {
  try {
    const r = await fetch(new URL("plugins.json", location.href));
    if (r.ok && (r.headers.get("content-type") ?? "").includes("json")) {
      const list = (await r.json()) as unknown;
      if (Array.isArray(list)) return list as Entry[];
    }
  } catch {
    // A host that serves none.
  }
  return [];
}

const host = await startBrowser({
  base: new URL("../", location.href).href,
  tree: [
    { id: "bridge", plugin: "plugins/bridge/client.ts", config: { url: await bridgeUrl() } },
    { id: "here", plugin: "plugins/here/index.ts" },
    { id: "style", plugin: "plugins/style/index.ts" },
    { id: "renderer", plugin: "plugins/renderer/index.ts", config: { mount: "#app" } },
    { id: "frame", plugin: "plugins/frame/index.ts", config: { folded: ["harness/run"], wait: true } },
    { id: "views", plugin: "plugins/views/view.ts", config: { home: "field" } },
    { id: "activity", plugin: "plugins/activity/index.ts" },
    // The view Then: what changed between two points in the log, and an item as it was at each (plugins/history).
    { id: "history", plugin: "plugins/history/view.ts" },
    { id: "find", plugin: "plugins/find/index.ts" },
    { id: "command", plugin: "plugins/command/index.ts" },
    { id: "page", plugin: "plugins/page/view.ts" },
    { id: "field", plugin: "plugins/field/index.ts" },
    // The view Shared plan: each agent's intents on a time line, what each built on, and what is held now (plugins/claim).
    { id: "claim", plugin: "plugins/claim/view.ts" },
    // A run opened into a graph on the Landscape, from the exchange (plugins/trail).
    { id: "trail", plugin: "plugins/trail/index.ts" },
    { id: "connect", plugin: "plugins/connect/view.ts" },
    // In the header: which map, commit and checkout this page talks to.
    { id: "serving", plugin: "plugins/serving/view.ts" },
    { id: "sync", plugin: "plugins/sync/view.ts" },
    // Examples to copy, off until turned on (plugins/examples): a panel, and a frame of your own.
    { id: "today", plugin: "plugins/examples/today.ts", disabled: true },
    { id: "column", plugin: "plugins/examples/column.ts", disabled: true },
    { id: "document", plugin: "plugins/document/index.ts" },
    { id: "item", plugin: "plugins/item/index.ts" },
    { id: "style-view", plugin: "plugins/style/view.ts" },
    { id: "docs", plugin: "plugins/docs/view.ts" },
    { id: "guide", plugin: "plugins/docs/guide.ts" },
    { id: "switch", plugin: "plugins/switch/view.ts" },
    ...(await folderEntries()),
  ],
});
host.runtime.onError = (fiber, error) => console.error(`[${fiber.plugin.id}]`, error);
(globalThis as { host?: unknown }).host = host;
