/**
 * The app, page side: the browser runtime and its config tree. The bridge
 * provides the server's capabilities here; the renderer, here, shell,
 * harness, reflex, find, map and item packs make the page. The bridge is two ports above the page
 * (5180 serves the page and 5182 the bridge, 5280 and 5282 for dev). `host` is on window, so a pack can be turned
 * off from the console: `host.loader.edit(t => (t.find(e => e.id === "harness").disabled = true, t))`.
 */
import { startBrowser } from "../runtime/browser.ts";

const host = await startBrowser({
  base: new URL("../", location.href).href,
  tree: [
    { id: "bridge", pack: "packs/bridge/client.ts", config: { url: `http://${location.hostname}:${Number(location.port) + 2}/` } },
    { id: "here", pack: "packs/here/index.ts" },
    { id: "renderer", pack: "packs/renderer/index.ts", config: { mount: "#app" } },
    { id: "shell", pack: "packs/shell/index.ts" },
    { id: "harness", pack: "packs/harness/index.ts" },
    { id: "find", pack: "packs/find/index.ts" },
    { id: "reflex", pack: "packs/reflex/index.ts" },
    { id: "map", pack: "packs/map/index.ts" },
    { id: "item", pack: "packs/item/index.ts" },
  ],
});
host.runtime.onError = (fiber, error) => console.error(`[${fiber.pack.id}]`, error);
(globalThis as { host?: unknown }).host = host;
