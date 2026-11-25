/**
 * Runs the adapter: graph, action, exchange, agent and claude-code in one Node process,
 * hot-reloaded, with a live tail of the exchange on the console.
 *
 *   node plugins/claude-code/host.ts [--port 5281] [--demo] [--journal file]
 *
 * Point Claude Code at it with the hooks and MCP server in settings.json
 * (see README.md).
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { NodeHost } from "../../runtime/node.ts";
import type { Entry } from "../../runtime/loader.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const { values } = parseArgs({
  options: {
    port: { type: "string", default: "5281" },
    demo: { type: "boolean", default: false },
    journal: { type: "string", default: join(here, ".data", "exchange.jsonl") },
  },
});
mkdirSync(dirname(values.journal), { recursive: true });

const tree: Entry[] = [
  { id: "graph", plugin: "plugins/graph/index.ts", config: { db: join(dirname(values.journal), "graph.sqlite") } },
  { id: "action", plugin: "plugins/action/index.ts" },
  { id: "exchange", plugin: "plugins/exchange/index.ts", config: { journal: values.journal } },
  { id: "agent", plugin: "plugins/agent/index.ts" },
  ...(values.demo ? [{ id: "demo-nodes", plugin: "plugins/claude-code/dev/demo.ts" }] : []),
  {
    id: "claude-code",
    plugin: "plugins/claude-code/index.ts",
    config: { port: Number(values.port), onListen: (p: number) => console.log(`claude-code adapter on http://127.0.0.1:${p}`) },
  },
  { id: "exchange-tail", plugin: "plugins/claude-code/dev/tail.ts" },
];

const host = new NodeHost({
  tree,
  base: pathToFileURL(root + "/").href,
  watch: join(root, "plugins"),
  onReload: (r) => r.reloaded.length && console.log(`reloaded ${r.reloaded.join(", ")}`),
});
host.runtime.onError = (fiber, error) => console.error(`[${fiber.plugin.id}]`, error);
await host.start();
for (const s of host.loader.status()) if (s.state !== "active") console.log(`${s.id}: ${s.state}${s.missing ? ` (waiting for ${s.missing.join(", ")})` : ""}${s.error ? ` ${s.error}` : ""}`);

const stop = async () => {
  await host.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
