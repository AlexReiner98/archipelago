import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionInfo, ActionList } from "../spec/action.ts";
import type { AgentTree, NodeInfo } from "../spec/agent.ts";
import type { SlotRead } from "../spec/slot.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader } from "../runtime/loader.ts";
import docs, { KEY, type DocsRead } from "../packs/docs/index.ts";
import tool, { brief } from "../packs/docs/tool.ts";
import { addsOf, matches, merged, ordered, stateWords } from "../packs/docs/cards.ts";
import { aboutOf, keyDoc, reference, shownConfig, type PackDoc } from "../packs/docs/read.ts";
import type { TypesRead } from "../spec/types.ts";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpHost, ToolDef } from "../packs/mcp/host.ts";

/** The registries a server has, as stubs: what the docs pack reads. */
function registries(actions: ActionInfo[], nodes: NodeInfo[]) {
  const on = new Set<() => void>();
  const pack: Pack = {
    id: "action",
    apply(ctx) {
      ctx.provide<ActionList>("action.list", () => ({ list: () => actions, watch: (f) => (on.add(f), () => void on.delete(f)) }));
      ctx.provide<AgentTree>("agent.tree", () => ({ nodes: () => nodes, watch: (f) => (on.add(f), () => void on.delete(f)) }));
      const all = {
        types: [{ name: "node", base: "record", doc: "Words said to agents", statuses: {} as any, fields: {}, trial: false, pack: "words" }],
        links: [{ name: "says_at", pack: "words" }],
      };
      ctx.provide<TypesRead>("types.read", () => ({ all: () => all, get: () => undefined, watch: (f) => (on.add(f), () => void on.delete(f)) }));
    },
  };
  return { pack, changed: () => [...on].forEach((f) => f()) };
}

const graph: Pack = { id: "graph", apply: (ctx) => void ctx.provide("graph.read", () => ({})) };
const words: Pack = {
  id: "words",
  inject: ["graph.read"],
  apply(ctx) {
    ctx.provide("words.own", () => ({}));
    ctx.plugin({ id: "words-part", apply: (c) => void c.provide("words.part", () => ({})) });
  },
};
const lonely: Pack = { id: "lonely", inject: ["nothing.here"], apply() {} };

const ACTIONS: ActionInfo[] = [
  {
    name: "words.set",
    title: "Set a node's words",
    pack: "words",
    input: { type: "object", properties: { node: { type: "string", description: "Its id" }, kind: { enum: ["a", "b"] }, at: { type: "array", items: { type: "string" } } }, required: ["node"] },
  },
  { name: "graph.x", title: "Elsewhere", pack: "graph", input: { type: "object" } },
];
const NODES: NodeInfo[] = [
  { id: "words/a", pack: "words", name: "a", kind: "reflex", title: "A", at: ["tool:Bash", "reply_end"] },
  { id: "words/b", pack: "words", name: "b", kind: "reflex", title: "B", at: ["tool:Bash"] },
  { id: "loaded/c", pack: "loaded", name: "c", kind: "skill", title: "C", at: ["skill:x"] },
];

const README = "# words\n\nAgent nodes whose words are on the map. Each graph item of type `node` is one.\n";

async function boot(extra: Pack[] = []) {
  const dir = await mkdtemp(join(tmpdir(), "docs-"));
  await mkdir(join(dir, "words"));
  await writeFile(join(dir, "words", "README.md"), README);
  const rt = new Runtime();
  rt.onError = () => {};
  const reg = registries(ACTIONS, NODES);
  const modules: Record<string, Pack> = { action: reg.pack, graph, words, lonely, docs, ...Object.fromEntries(extra.map((p) => [p.id, p])) };
  const loader = new Loader(rt, { base: "mem:/", import: async (url) => ({ default: modules[url.slice(5)]! }) });
  await loader.apply([
    { id: "action", pack: "action" },
    { id: "graph", pack: "graph" },
    { id: "words", pack: "words", config: { seed: [1], apiToken: "s3cret", onListen: () => {} } },
    { id: "lonely", pack: "lonely" },
    { id: "docs", pack: "docs", config: { every: 20, packs: dir } },
    ...extra.map((p) => ({ id: p.id, pack: p.id })),
  ]);
  return { rt, loader, reg, read: rt.root.get<DocsRead>(KEY) };
}

test("docs.read: every loaded pack, in tree order, read from the packs themselves", async () => {
  const { loader, read } = await boot();
  const all = await read.packs();
  assert.deepEqual(all.map((d) => d.id), ["action", "graph", "words", "lonely", "docs"]);
  const w = all.find((d) => d.id === "words")!;
  assert.equal(w.side, "server");
  assert.equal(w.state, "active");
  // Provides, a child's included; injects, with the spec contract each key is in.
  assert.deepEqual(w.provides.map((k) => k.key), ["words.own", "words.part"]);
  assert.deepEqual(w.inject, [{ key: "graph.read", contract: "graph", since: 1, doc: keyDoc("graph.read").doc }]);
  assert.deepEqual(w.parts, ["words-part"]);
  // Its own actions only, with their inputs; places counted from its nodes.
  assert.deepEqual(w.actions.map((a) => a.name), ["words.set"]);
  assert.deepEqual(w.places, [{ place: "tool:Bash", nodes: 2 }, { place: "reply_end", nodes: 1 }]);
  // Config: functions named, secrets hidden.
  assert.deepEqual(w.config, { seed: [1], apiToken: "•••", onListen: "ƒ" });
  // What implements the spec, and what waits.
  assert.deepEqual(all.find((d) => d.id === "action")!.provides.map((k) => k.contract), ["action", "agent", "types"]);
  const l = all.find((d) => d.id === "lonely")!;
  assert.equal(l.state, "waiting");
  assert.deepEqual(l.missing, ["nothing.here"]);
  assert.equal(all.find((d) => d.id === "docs")!.provides[0]!.key, KEY);
  // What it is for, from its README; the kinds of item it defines.
  assert.equal(w.about, "Agent nodes whose words are on the map.");
  assert.equal(all.find((d) => d.id === "graph")!.about, undefined);
  assert.deepEqual(w.types, [{ name: "node", base: "record", doc: "Words said to agents" }, { name: "says_at", base: "link" }]);
  assert.deepEqual(await read.about(["words", "graph", "../x"]), { words: "Agent nodes whose words are on the map." });
  await loader.apply([]);
});

test("docs.read.watch: told when a pack leaves, and when actions or nodes change", async () => {
  const { loader, reg, read } = await boot();
  let n = 0;
  read.watch(() => n++);
  reg.changed();
  assert.equal(n, 1);
  await loader.apply(loader.tree.map((e) => (e.id === "graph" ? { ...e, disabled: true } : e)));
  await new Promise((ok) => setTimeout(ok, 80));
  assert.ok(n > 1);
  const all = await read.packs();
  assert.equal(all.find((d) => d.id === "graph")!.state, "off");
  assert.equal(all.find((d) => d.id === "words")!.state, "waiting");
  await loader.apply([]);
});

test("the page side: slots a pack declares and fills", () => {
  const rt = new Runtime();
  rt.onError = () => {};
  rt.root.plugin({ id: "shell", apply() {} });
  rt.root.plugin({ id: "docs", apply() {} });
  const slots: SlotRead = {
    slots: () => [{ name: "shell.main", merge: "many", pack: "shell", doc: "views" }],
    fills: (s) => (s === "shell.main" ? [{ slot: s, name: "view", title: "Packs", pack: "docs", view: () => null }] : []),
    watch: () => () => {},
  };
  const all = reference(rt, { side: "page", slots });
  assert.deepEqual(all.find((d) => d.id === "shell")!.slots, { declares: [{ name: "shell.main", merge: "many", doc: "views" }], fills: [] });
  assert.deepEqual(all.find((d) => d.id === "docs")!.slots, { declares: [], fills: [{ slot: "shell.main", name: "view", title: "Packs" }] });
});

test("the packs tool: agents read the same reference", async () => {
  const tools: ToolDef[] = [];
  const host: Pack = {
    id: "host",
    apply(ctx) {
      ctx.provide<McpHost>("mcp.host", () => ({ harness: "test", place: (t) => `tool:${t}`, add: (d) => (tools.push(d), () => {}) }));
    },
  };
  const { loader, read } = await boot([host, tool]);
  const packs = tools.find((t) => t.name === "packs")!;
  assert.ok(packs);
  const list = (await packs.call({}, undefined)).text;
  assert.equal(list, brief(await read.packs()));
  assert.match(list, /^words \(active\) Agent nodes whose words are on the map\.; provides words\.own, words\.part; actions words\.set; speaks at 2 places$/m);
  assert.match(list, /^lonely \(waiting\); waits for nothing\.here$/m);
  const one = JSON.parse((await packs.call({ pack: "words" }, undefined)).text);
  assert.equal(one.actions[0].name, "words.set");
  assert.equal((await packs.call({ pack: "nope" }, undefined)).isError, true);
  await loader.apply([]);
});

test("aboutOf: a README's first sentence, in plain words, wiring cut", () => {
  assert.equal(aboutOf("# x\n\nThe one way anyone changes anything. Provides `action.register`.\n"), "The one way anyone changes anything.");
  assert.equal(aboutOf("# x\n\nPage side. The map as the page holds it, and [find](f.md).\n"), "The map as the page holds it, and find.");
  assert.equal(aboutOf("# x\n\nThe types broker ([spec/types.md](../../spec/types.md)): provides\n`types.define`.\n"), "The types broker.");
  assert.equal(aboutOf("# x\n\nOne of the map's bases: see [work](../work/README.md).\n"), "One of the map's bases.");
  assert.equal(aboutOf("# agent\n\nProvides `agent.node` and `agent.tree`.\n"), undefined);
  assert.equal(aboutOf("# only a title\n"), undefined);
});

const doc = (over: Partial<PackDoc>): PackDoc => ({ id: "p", side: "server", state: "active", position: [0], inject: [], provides: [], actions: [], places: [], ...over });

test("cards: what a pack adds and its state, in plain words; problems first; one card per pack", () => {
  const p = doc({
    actions: [{ name: "items.create", title: "Make an item", input: {} }],
    types: [{ name: "work" }, { name: "branch", base: "work" }, { name: "part_of", base: "link" }],
    places: [{ place: "tool:Bash", nodes: 2 }, { place: "prompt", nodes: 1 }],
    slots: { declares: [], fills: [{ slot: "shell.main", name: "view", title: "Map" }, { slot: "map.bar", name: "find", title: "Find" }, { slot: "root", name: "shell" }] },
  });
  assert.deepEqual(addsOf(p), { actions: ["Make an item"], kinds: ["work", "branch (a kind of work)", "part_of (link)"], views: ["Map"], parts: ["Find"], says: 3 });
  assert.equal(stateWords(p), undefined);
  assert.equal(stateWords(doc({ state: "waiting", missing: ["graph.read"] })), "Waiting for another pack to load.");
  assert.equal(stateWords(doc({ state: "off" })), "Turned off.");
  assert.ok(matches(p, "make item"));
  assert.ok(matches(p, "branch"));
  assert.ok(!matches(p, "tool:bash"));
  const w = doc({ id: "w", state: "waiting" });
  assert.deepEqual(ordered([p, w]).map((d) => d.id), ["w", "p"]);
  // A pack with a server half and a page half is one card: the page half's views, a problem in either.
  const server = [doc({ id: "docs", about: "What each pack is for." }), doc({ id: "graph" })];
  const page = [doc({ id: "docs", side: "page", slots: { declares: [], fills: [{ slot: "shell.main", name: "view", title: "Packs" }] } }), doc({ id: "shell", side: "page", state: "failed", error: "boom" })];
  const all = merged(server, page);
  assert.deepEqual(all.map((d) => d.id), ["docs", "graph", "shell"]);
  assert.deepEqual(addsOf(all[0]!).views, ["Packs"]);
  assert.equal(all[0]!.about, "What each pack is for.");
  assert.equal(stateWords(all[2]!), "Failed to start: boom");
  assert.equal(JSON.stringify(shownConfig({ deep: { password: 1, x: undefined } })), '{"deep":{"password":"•••"}}');
});
