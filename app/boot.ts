/**
 * The app, page side: the browser runtime and its config tree. The bridge
 * provides the server's capabilities here; the style, renderer, here, frame, views (the picker),
 * harness, activity, find, command, field (home), connect (a new map's first step), gate (a host's sign-in, drawn over the map), item, docs (the Plugins view), guide (the Guide) and switch (its on/off switches) plugins make the page. The bridge is two ports above the page
 * (5180 serves the page and 5182 the bridge, 5280 and 5282 for dev), or at
 * `/bridge/` on the page's own origin when a host in front serves both. `host` is on window, so a plugin can be turned
 * off from the console: `host.loader.edit(t => (t.find(e => e.id === "harness").disabled = true, t))`.
 */
import { startBrowser } from "../runtime/browser.ts";

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

const host = await startBrowser({
  base: new URL("../", location.href).href,
  tree: [
    { id: "bridge", plugin: "plugins/bridge/client.ts", config: { url: await bridgeUrl() } },
    { id: "here", plugin: "plugins/here/index.ts" },
    { id: "style", plugin: "plugins/style/index.ts" },
    { id: "renderer", plugin: "plugins/renderer/index.ts", config: { mount: "#app" } },
    { id: "frame", plugin: "plugins/frame/index.ts", config: { folded: ["harness/run"], wait: true } },
    { id: "views", plugin: "plugins/views/view.ts", config: { home: "field" } },
    { id: "harness", plugin: "plugins/harness/index.ts" },
    { id: "activity", plugin: "plugins/activity/index.ts" },
    // On the run pane: whether the run was exported as OpenTelemetry spans, and where (nothing while the server's otel is off).
    { id: "otel", plugin: "plugins/otel/view.ts" },
    { id: "find", plugin: "plugins/find/index.ts" },
    { id: "command", plugin: "plugins/command/index.ts" },
    { id: "page", plugin: "plugins/page/view.ts" },
    { id: "field", plugin: "plugins/field/index.ts" },
    { id: "arrange", plugin: "plugins/arrange/index.ts" },
    { id: "sessions", plugin: "plugins/sessions/index.ts" },
    { id: "connect", plugin: "plugins/connect/view.ts" },
    { id: "gate", plugin: "plugins/gate/view.ts" },
    // Map (plugins/map) and its legend (plugins/legend) are kept but not loaded, so no one sees them
    // (21 Nov 2026: Field, now Landscape, is home). To use them, add:
    //   { id: "map", plugin: "plugins/map/index.ts" }, { id: "legend", plugin: "plugins/legend/index.ts" },
    // Examples to copy, off until turned on (plugins/examples): a panel, and a frame of your own.
    { id: "today", plugin: "plugins/examples/today.ts", disabled: true },
    { id: "column", plugin: "plugins/examples/column.ts", disabled: true },
    // The Checks view (plugins/checks/view.ts), off until a server runs the checks plugin: page.set { plugin: "checks", on: true }.
    { id: "checks", plugin: "plugins/checks/view.ts", disabled: true },
    { id: "document", plugin: "plugins/document/index.ts" },
    { id: "item", plugin: "plugins/item/index.ts" },
    { id: "style-view", plugin: "plugins/style/view.ts" },
    { id: "docs", plugin: "plugins/docs/view.ts" },
    { id: "guide", plugin: "plugins/docs/guide.ts" },
    { id: "switch", plugin: "plugins/switch/view.ts" },
  ],
});
host.runtime.onError = (fiber, error) => console.error(`[${fiber.plugin.id}]`, error);
(globalThis as { host?: unknown }).host = host;
