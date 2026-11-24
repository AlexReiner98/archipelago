/**
 * The app, server side: `npm run serve`. One process runs
 * - the dev server for the page (runtime/serve.ts, port 5180), and
 * - a Node runtime with the server's packs, hot-reloaded: graph, action,
 *   types and the bases (work, question, record, actor, links, items) with
 *   the trial flavour branch, interchange (a moved map's change sets),
 *   exchange, agent, git and hub (a run's repository and hub as facts),
 *   verdict, words, loaded, profile (which runs a node is for), written,
 *   placed (a profile's skills written where its runs are), used (which given
 *   tools runs use), lean (what a profile leaves out of Claude Code's
 *   context; its writer only with writing on), grow, since ("since
 *   you last heard", at each prompt), the Claude Code adapter (5181), the
 *   map's agent tools on its MCP server (mcp), the reference read from the
 *   running packs (docs, and its `packs` tool, docs-tool), the old maps kept read only
 *   (archive, from <data>/archives), and
 *   the bridge (5182) the page reaches them through.
 *
 * --port moves all three (page, page + 1, page + 2); --no-watch turns hot
 * reload off, for the page and the packs. ARCHIPELAGO_PORT and
 * ARCHIPELAGO_WATCH=0 set the same, so scripts/live.ts can start any commit:
 * an older one ignores them and runs on the default ports.
 *
 * --no-write (ARCHIPELAGO_WRITE=0) leaves the written pack off, so the
 * server writes no skill or memory file, and the lean writer, so it writes
 * no project settings. The dev server runs so: those files
 * are what real sessions load, and only live writes them.
 *
 * Point Claude Code at the adapter (packs/claude-code/README.md) and open
 * http://127.0.0.1:5180/app/.
 *
 *   node app/server.ts [--data dir] [--port 5180] [--no-watch] [--no-write]
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { NodeHost } from "../runtime/node.ts";
import { serve } from "../runtime/serve.ts";
import { otelFromEnv, pageAccess, serverTree } from "./tree.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({
  allowNegative: true,
  options: {
    data: { type: "string", default: join(root, "app", ".data") },
    port: { type: "string", default: process.env.ARCHIPELAGO_PORT ?? "5180" },
    watch: { type: "boolean", default: process.env.ARCHIPELAGO_WATCH !== "0" },
    write: { type: "boolean", default: process.env.ARCHIPELAGO_WRITE !== "0" },
  },
});
const PAGE = Number(values.port);

const tree = serverTree({ data: values.data, port: PAGE, write: values.write, otel: otelFromEnv(process.env) });

const host = new NodeHost({
  tree,
  base: pathToFileURL(root + "/").href,
  watch: values.watch ? join(root, "packs") : undefined,
  onReload: (r) => r.reloaded.length && console.log(`reloaded ${r.reloaded.join(", ")}`),
});
host.runtime.onError = (fiber, error) => console.error(`[${fiber.pack.id}]`, error);
await host.start();
await host.runtime.settle();
for (const s of host.loader.status()) {
  if (s.state !== "active") console.log(`${s.id}: ${s.state}${s.missing ? ` (waiting for ${s.missing.join(", ")})` : ""}${s.error ? ` ${s.error}` : ""}`);
}
const page = await serve({ port: PAGE, root, watch: values.watch, ...pageAccess({ port: PAGE }) });
console.log(`context interface on ${page.url}app/${values.watch ? "" : " (hot reload off)"}`);

const stop = async () => {
  await page.close();
  await host.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
