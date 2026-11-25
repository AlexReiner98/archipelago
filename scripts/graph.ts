/**
 * Moves a graph in and out of a store by the interchange format (change
 * sets as JSON Lines, plugins/graph/interchange.ts). Stop the server first
 * when writing to the store it uses.
 *
 *   node scripts/graph.ts export <db> [out.jsonl]     what the store holds, as change sets
 *   node scripts/graph.ts import <db> <in.jsonl>      apply change sets to the store, in order
 *   node scripts/graph.ts from-json <graph.json> [out.jsonl]
 *                                                    the old JSON graph file, as change sets
 *   node scripts/graph.ts counts <db | graph.json | sets.jsonl>
 *                                                    how many items, by type
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { Header } from "../spec/changeset.ts";
import { Store, applyFacts, type Fields } from "../plugins/graph/store.ts";
import { exportSets, fromLines, importSets, setsOf, toLines } from "../plugins/graph/interchange.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { reason: { type: "string", default: "Moved by the interchange format" } },
});
const [cmd, a, b] = positionals;

const header = (action: string): Header => ({
  actor: { id: "person:owner", kind: "person" },
  authority: { of: "human", basis: "run by hand: node scripts/graph.ts" },
  plugin: { id: "graph" },
  action,
  reason: values.reason!,
  time: new Date().toISOString(),
});

const out = (text: string, file?: string) => (file ? writeFileSync(file, text) : process.stdout.write(text));

function countsOf(items: Iterable<[string, Fields]>) {
  const types: Record<string, number> = {};
  let n = 0;
  for (const [, f] of items) {
    n++;
    types[String(f.type)] = (types[String(f.type)] ?? 0) + 1;
  }
  return { items: n, types: Object.fromEntries(Object.entries(types).sort(([x], [y]) => (x < y ? -1 : 1))) };
}

switch (cmd) {
  case "export": {
    const store = new Store(a!);
    out(toLines(exportSets(store, header("graph.export"))), b);
    store.close();
    break;
  }
  case "import": {
    const store = new Store(a!);
    console.log(importSets(store, fromLines(readFileSync(b!, "utf8"))));
    console.log(store.counts());
    store.close();
    break;
  }
  case "from-json": {
    const saved = JSON.parse(readFileSync(a!, "utf8")) as { items: Record<string, Fields> };
    out(toLines(setsOf(Object.entries(saved.items), header("graph.import"))), b);
    break;
  }
  case "counts": {
    if (a!.endsWith(".json")) console.log(countsOf(Object.entries((JSON.parse(readFileSync(a!, "utf8")) as { items: Record<string, Fields> }).items)));
    else if (a!.endsWith(".jsonl")) {
      const facts = [...fromLines(readFileSync(a!, "utf8"))].flatMap((s) => s.facts);
      const items = applyFacts(new Map(), facts);
      console.log(countsOf([...items].filter((e): e is [string, Fields] => e[1] !== null)));
    } else {
      const store = new Store(a!);
      console.log(store.counts());
      store.close();
    }
    break;
  }
  default:
    console.log("node scripts/graph.ts export|import|from-json|counts ...");
    process.exitCode = 1;
}
