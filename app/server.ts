/**
 * The app, server side: `npm run serve`. One process runs
 * - the dev server for the page (runtime/serve.ts, port 5180), and
 * - a Node runtime with the server's packs, hot-reloaded: graph, action,
 *   exchange, agent, verdict, words, loaded, grow, the Claude Code adapter (5181) and
 *   the bridge (5182) the page reaches them through.
 *
 * Point Claude Code at the adapter (packs/claude-code/README.md) and open
 * http://127.0.0.1:5180/app/.
 *
 *   node app/server.ts [--data dir]
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { NodeHost } from "../runtime/node.ts";
import { serve } from "../runtime/serve.ts";
import type { Entry } from "../runtime/loader.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: { data: { type: "string", default: join(root, "app", ".data") } } });
const PAGE = 5180;

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
  { id: "graph", pack: "packs/graph/index.ts", config: { file: join(values.data, "graph.json") } },
  { id: "action", pack: "packs/action/index.ts" },
  { id: "exchange", pack: "packs/exchange/index.ts", config: { journal: join(values.data, "exchange.jsonl") } },
  { id: "agent", pack: "packs/agent/index.ts" },
  { id: "verdict", pack: "packs/verdict/index.ts" },
  { id: "words", pack: "packs/words/index.ts", config: { seed: SEED } },
  { id: "loaded", pack: "packs/loaded/index.ts" },
  { id: "grow", pack: "packs/grow/index.ts" },
  {
    id: "claude-code",
    pack: "packs/claude-code/index.ts",
    config: { port: 5181, onListen: (p: number) => console.log(`claude-code adapter on http://127.0.0.1:${p}`) },
  },
  {
    id: "bridge",
    pack: "packs/bridge/server.ts",
    config: {
      port: 5182,
      actor: { id: "person:owner", kind: "person" },
      origins: [`http://127.0.0.1:${PAGE}`, `http://localhost:${PAGE}`],
      onListen: (p: number) => console.log(`bridge on http://127.0.0.1:${p}`),
    },
  },
];

const host = new NodeHost({
  tree,
  base: pathToFileURL(root + "/").href,
  watch: join(root, "packs"),
  onReload: (r) => r.reloaded.length && console.log(`reloaded ${r.reloaded.join(", ")}`),
});
host.runtime.onError = (fiber, error) => console.error(`[${fiber.pack.id}]`, error);
await host.start();
await host.runtime.settle();
for (const s of host.loader.status()) {
  if (s.state !== "active") console.log(`${s.id}: ${s.state}${s.missing ? ` (waiting for ${s.missing.join(", ")})` : ""}${s.error ? ` ${s.error}` : ""}`);
}
const page = await serve({ port: PAGE, root });
console.log(`harness view on ${page.url}app/`);

const stop = async () => {
  await page.close();
  await host.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
