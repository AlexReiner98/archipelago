/**
 * The app, server side: `npm run serve` (or `npm run dev`, which writes no
 * file outside its data). One process runs
 * - the dev server for the page (runtime/serve.ts, port 5180), and
 * - a Node runtime with the server's plugins, hot-reloaded: graph, action,
 *   types and the bases (work, question, record, actor, links, items) with
 *   the trial flavour branch, interchange (a moved map's change sets),
 *   exchange, agent, git and hub (a run's repository and hub as facts),
 *   verdict, words, loaded, profile (which runs a node is for), written,
 *   placed (a profile's skills written where its runs are), used (which given
 *   tools runs use), lean (what a profile leaves out of Claude Code's
 *   context; its writer only with writing on), grow, since ("since
 *   you last heard", at each prompt), the Claude Code adapter (5181), the
 *   map's agent tools on its MCP server (mcp), the reference read from the
 *   running plugins (docs, and its `plugins` tool, docs-tool), the old maps kept read only
 *   (archive, from <data>/archives), and
 *   the bridge (5182) the page reaches them through.
 *
 * On fixed ports (the default, or --port), a port already taken is refused
 * in one line, naming it and `npm run map -- serve`, before anything is
 * written (scripts/maps.ts `takenOf`).
 *
 * --port moves all three (page, page + 1, page + 2); --no-watch turns hot
 * reload off, for the page and the plugins. ARCHIPELAGO_PORT and
 * ARCHIPELAGO_WATCH=0 set the same, so scripts/live.ts can start any commit:
 * an older one ignores them and runs on the default ports.
 *
 * --no-write (ARCHIPELAGO_WRITE=0) leaves the written plugin off, so the
 * server writes no skill or memory file, and the lean writer, so it writes
 * no project settings. The dev server (`npm run dev`, `dev:start`) runs so
 * beside a live one: those files are what real sessions load, and only live
 * writes them. `npm run serve`, a person's own copy, writes them.
 *
 * --checkout dir (ARCHIPELAGO_CHECKOUT) names the checkout people work in,
 * when the server runs from another: what the page offers to connect, and
 * what `connect.here` connects by default. scripts/live.ts sets it to the
 * checkout live was set up from, since live runs from a worktree of its own.
 *
 * The page serves <data>/files at /files/, images only: a note's
 * `![alt](/files/shot.png)` draws from there (plugins/item/README.md).
 *
 * --map name (ARCHIPELAGO_MAP) serves a map by name (scripts/maps.ts): its
 * data is <home>/maps/<name>, outside any checkout; it takes any free port
 * unless --port names one; it records itself in <home>/servers/<name>.json
 * while it runs, and a second server for the same map is refused, naming
 * the one that runs. --from copies a map in when this one has none yet: a
 * map's name copies that map; a data folder (an older server's) is moved
 * in with its ledgers, so the folders it had connected report to this map. Folders connected to it report by its name,
 * so they follow it to whatever port it takes (plugins/connect).
 *
 * The page's header says which map, commit and checkout this is (plugins/serving).
 *
 * Point Claude Code at the adapter (plugins/claude-code/README.md) and open
 * http://127.0.0.1:5180/app/.
 *
 *   node app/server.ts [--map name [--from map|dir]] [--data dir] [--port 5180] [--no-watch] [--no-write] [--checkout dir]
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { NodeHost } from "../runtime/node.ts";
import { serve } from "../runtime/serve.ts";
import { otelFromEnv, pageAccess, serverTree } from "./tree.ts";
import { temporaryPlace } from "../scripts/place.ts";
import { claim, commitOf, freePort, hasMap, homeOf, letPortGo, MAP_NAME, mapDir, release, snapshot, sourceOf, takenLine, takenOf, update } from "../scripts/maps.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({
  allowNegative: true,
  options: {
    map: { type: "string", default: process.env.ARCHIPELAGO_MAP || undefined },
    from: { type: "string" },
    data: { type: "string" },
    port: { type: "string", default: process.env.ARCHIPELAGO_PORT || undefined },
    watch: { type: "boolean", default: process.env.ARCHIPELAGO_WATCH !== "0" },
    write: { type: "boolean", default: process.env.ARCHIPELAGO_WRITE !== "0" },
    checkout: { type: "string", default: process.env.ARCHIPELAGO_CHECKOUT || undefined },
  },
});
const map = values.map;
const commit = commitOf(root);
if (map !== undefined && !MAP_NAME.test(map)) {
  console.error(`refused: "${map}" is not a map name (letters, digits, ".", "_" and "-")`);
  process.exit(1);
}
const data = values.data ?? (map ? mapDir(map) : join(root, "app", ".data"));
if (map) {
  // One server per map: the registry says who serves it, and hooks and the MCP proxy find it there.
  const home = homeOf();
  const claimed = claim({ map, pid: process.pid, checkout: root, data, started: new Date().toISOString(), ...(commit ? { commit } : {}) }, home);
  if (!claimed.ok) {
    const r = claimed.running;
    console.error(`refused: map ${map} is already served by pid ${r.pid}${r.port ? ` on http://127.0.0.1:${r.port}/app/` : ""}, from ${r.checkout}${r.commit ? ` at ${r.commit}` : ""}. Stop it first (npm run map -- down ${map}).`);
    process.exit(1);
  }
  process.on("exit", () => release(map, process.pid, home));
  if (values.from && !hasMap(data)) {
    const from = sourceOf(values.from, home);
    snapshot(from.dir, data, { takeover: from.takeover });
    console.log(`map ${map}: ${from.takeover ? "moved in" : "copied"} from ${from.dir}${from.takeover ? ", with the folders it had connected" : ""}`);
  }
}
const PAGE = values.port ? Number(values.port) : map ? await freePort() : 5180;
// A port given, or the fixed one: refused in one line while it is taken, before anything is written.
if (values.port || !map) {
  const taken = await takenOf(PAGE);
  if (taken.length) {
    console.error(takenLine(PAGE, taken));
    process.exit(1);
  }
}
if (map) {
  update(map, process.pid, { port: PAGE });
  process.on("exit", () => letPortGo(PAGE));
}
// A map kept somewhere that goes away goes with it: said once, at start (scripts/place.ts).
const away = temporaryPlace(data);
if (away) console.log(`note: this map's data (${data}) won't last: ${away}. To keep a map, run it from a checkout in a folder you keep (README, "Set it up to keep").`);

const tree = serverTree({
  data,
  port: PAGE,
  write: values.write,
  otel: otelFromEnv(process.env),
  serving: { root, ...(map ? { map } : {}), ...(commit ? { commit } : {}) },
  ...(values.checkout ? { checkout: values.checkout } : {}),
});

const host = new NodeHost({
  tree,
  base: pathToFileURL(root + "/").href,
  watch: values.watch ? join(root, "plugins") : undefined,
  onReload: (r) => r.reloaded.length && console.log(`reloaded ${r.reloaded.join(", ")}`),
});
host.runtime.onError = (fiber, error) => console.error(`[${fiber.plugin.id}]`, error);
await host.start();
await host.runtime.settle();
for (const s of host.loader.status()) {
  if (s.state !== "active") console.log(`${s.id}: ${s.state}${s.missing ? ` (waiting for ${s.missing.join(", ")})` : ""}${s.error ? ` ${s.error}` : ""}`);
}
// A note's pictures: <data>/files, at /files/ on the page's own origin.
const page = await serve({ port: PAGE, root, watch: values.watch, files: join(data, "files"), bridge: PAGE + 2, ...pageAccess({ port: PAGE }) });
console.log(`${map ? `map ${map}: ` : ""}context interface on ${page.url}app/${values.watch ? "" : " (hot reload off)"}`);

const stop = async () => {
  await page.close();
  await host.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
