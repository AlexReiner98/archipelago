/**
 * The app, server side: `npm run serve`. One process runs
 * - the dev server for the page (runtime/serve.ts, port 5180), and
 * - a Node runtime with the server's packs, hot-reloaded: graph, action,
 *   types and the bases (work, question, record, actor, links, items) with
 *   the trial flavour branch, interchange (a moved map's change sets),
 *   exchange, agent, verdict, words, loaded, written, grow, since ("since
 *   you last heard", at each prompt), the Claude Code adapter (5181), the
 *   map's agent tools on its MCP server (mcp), the old maps kept read only
 *   (archive, from <data>/archives), and
 *   the bridge (5182) the page reaches them through.
 *
 * --port moves all three (page, page + 1, page + 2); --no-watch turns hot
 * reload off, for the page and the packs. ARCHIPELAGO_PORT and
 * ARCHIPELAGO_WATCH=0 set the same, so scripts/live.ts can start any commit:
 * an older one ignores them and runs on the default ports.
 *
 * --no-write (ARCHIPELAGO_WRITE=0) leaves the written pack off, so the
 * server writes no skill or memory file. The dev server runs so: those files
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
import type { Entry } from "../runtime/loader.ts";

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

export const SEED = [
  {
    title: "Says the run is recorded",
    kind: "instruction",
    at: ["session_start"],
    words: "This run is recorded on the exchange: every say, refusal and act shows live in the harness view.",
  },
  {
    title: "The spec is Alex's",
    kind: "reflex",
    at: ["file:spec/**"],
    words: "spec/ holds the contracts. Don't change one silently: ask Alex first.",
  },
  {
    title: "Packs, not kernel",
    kind: "reflex",
    at: ["file:runtime/**"],
    words: "runtime/ is the kernel. Keep it small: a new idea becomes a pack.",
  },
  {
    title: "Read files with Read",
    kind: "reflex",
    at: ["tool:Bash"],
    words: "To read or search files, prefer Read, Grep and Glob over Bash.",
  },
  {
    title: "No secrets",
    kind: "rule",
    at: ["file:.env", "file:**/.env"],
    words: "The map refuses .env files: they hold secrets.",
    refuse: true,
  },
  {
    title: "Check before you stop",
    kind: "reflex",
    at: ["reply_end"],
    words: "Before you finish: did every change you made pass npm run check?",
  },
];

const tree: Entry[] = [
  { id: "graph", pack: "packs/graph/index.ts", config: { db: join(values.data, "graph.sqlite") } },
  { id: "action", pack: "packs/action/index.ts" },
  { id: "types", pack: "packs/types/index.ts" },
  { id: "work", pack: "packs/work/index.ts" },
  { id: "question", pack: "packs/question/index.ts" },
  { id: "record", pack: "packs/record/index.ts" },
  { id: "actor", pack: "packs/actor/index.ts" },
  { id: "links", pack: "packs/links/index.ts" },
  { id: "branch", pack: "packs/branch/index.ts" },
  { id: "items", pack: "packs/items/index.ts" },
  { id: "schema", pack: "packs/schema/index.ts", config: { db: join(values.data, "schema.sqlite") } },
  { id: "history", pack: "packs/history/index.ts", config: { db: join(values.data, "history.sqlite") } },
  { id: "interchange", pack: "packs/interchange/index.ts" },
  { id: "exchange", pack: "packs/exchange/index.ts", config: { journal: join(values.data, "exchange.jsonl") } },
  { id: "agent", pack: "packs/agent/index.ts" },
  { id: "verdict", pack: "packs/verdict/index.ts" },
  { id: "words", pack: "packs/words/index.ts", config: { seed: SEED } },
  { id: "loaded", pack: "packs/loaded/index.ts" },
  { id: "written", pack: "packs/written/index.ts", disabled: !values.write },
  { id: "grow", pack: "packs/grow/index.ts" },
  { id: "since", pack: "packs/since/index.ts" },
  {
    id: "claude-code",
    pack: "packs/claude-code/index.ts",
    config: { port: PAGE + 1, onListen: (p: number) => console.log(`claude-code adapter on http://127.0.0.1:${p}`) },
  },
  { id: "mcp", pack: "packs/mcp/index.ts" },
  { id: "archive", pack: "packs/archive/index.ts", config: { dir: join(values.data, "archives") } },
  {
    id: "bridge",
    pack: "packs/bridge/server.ts",
    config: {
      port: PAGE + 2,
      actor: { id: "person:owner", kind: "person" },
      origins: [`http://127.0.0.1:${PAGE}`, `http://localhost:${PAGE}`],
      onListen: (p: number) => console.log(`bridge on http://127.0.0.1:${p}`),
    },
  },
];

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
const page = await serve({ port: PAGE, root, watch: values.watch });
console.log(`harness view on ${page.url}app/${values.watch ? "" : " (hot reload off)"}`);

const stop = async () => {
  await page.close();
  await host.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
