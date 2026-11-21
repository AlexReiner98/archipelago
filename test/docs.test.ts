import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import type { ActionInfo, ActionList } from "../spec/action.ts";
import type { AgentTree, NodeInfo } from "../spec/agent.ts";
import type { SlotRead } from "../spec/slot.ts";
import type { TypesRead } from "../spec/types.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader } from "../runtime/loader.ts";
import docs, { KEY, type DocsRead } from "../packs/docs/index.ts";
import tool, { brief } from "../packs/docs/tool.ts";
import { byFolder, countsOf, fieldsOf, foundation, listsOf, matches, stateWords, usedBy, uses } from "../packs/docs/cards.ts";
import { activityOf, folderOf, keyDoc, reference, shownConfig, type PackDoc } from "../packs/docs/read.ts";
import type { ExchangeRead, ExchangeWatch } from "../spec/exchange.ts";
import type { GraphRead, GraphWatch } from "../spec/graph.ts";
import type { McpHost, ToolDef } from "../packs/mcp/host.ts";

/** The registries a server has, as stubs: what the docs pack reads. */
function registries(actions: ActionInfo[], nodes: NodeInfo[]) {
  const on = new Set<() => void>();
  const watch = (f: () => void) => (on.add(f), () => void on.delete(f));
  const pack: Pack = {
    id: "action",
    apply(ctx) {
      ctx.provide<ActionList>("action.list", () => ({ list: () => actions, watch }));
      ctx.provide<AgentTree>("agent.tree", () => ({ nodes: () => nodes, watch }));
      const all = {
        types: [{ name: "node", base: "record", doc: "Words said to agents", statuses: {} as any, fields: {}, trial: false, pack: "words" }],
        links: [{ name: "says_at", pack: "words" }],
      };
      ctx.provide<TypesRead>("types.read", () => ({ all: () => all, get: () => undefined, watch }));
      // The map holds 3 nodes; the newest run has words' says and a refusal.
      ctx.provide<GraphRead>("graph.read", () => ({ of: async (type: string, page?: { limit?: number }) => (type === "node" ? { items: [1, 2, 3].slice(0, page?.limit ?? 3) as any, ...(page?.limit && page.limit < 3 ? { next: "c" } : {}) } : { items: [] }) }) as any);
      ctx.provide<GraphWatch>("graph.watch", () => ({ watch: () => () => {} }));
      ctx.provide<ExchangeRead>("exchange.read", () => ({
        runs: async () => ({ items: [{ run: "r1" }] as any }),
        events: async () => ({ items: [{ kind: "say", pack: "words" }, { kind: "say", pack: "words" }, { kind: "refuse", pack: "words" }, { kind: "begin" }] as any }),
        said: async () => ({ items: [] }),
      }));
      ctx.provide<ExchangeWatch>("exchange.watch", () => ({ watch: () => () => {} }));
    },
  };
  return { pack, changed: () => [...on].forEach((f) => f()) };
}

const graph: Pack = { id: "graph", apply: (ctx) => void ctx.provide("graph.own", () => ({})) };
const words: Pack = {
  id: "words",
  about: "Notes to agents whose wording lives on the map.",
  inject: ["graph.own"],
  apply(ctx) {
    ctx.provide("words.own", () => ({}));
    ctx.plugin({ id: "words-part", apply: (c) => void c.provide("words.part", () => ({})) });
  },
};
const lonely: Pack = { id: "lonely", inject: ["nothing.here"], apply() {} };

const ACTIONS: ActionInfo[] = [
  { name: "words.set", title: "Set a node's words", pack: "words", input: { type: "object", properties: { node: { type: "string" } }, required: ["node"] } },
  { name: "graph.x", title: "Elsewhere", pack: "graph", input: { type: "object" } },
];
const NODES: NodeInfo[] = [
  { id: "words/a", pack: "words", name: "a", kind: "reflex", title: "A", at: ["tool:Bash", "reply_end"] },
  { id: "words/b", pack: "words", name: "b", kind: "reflex", title: "B", at: ["tool:Bash"] },
  { id: "loaded/c", pack: "loaded", name: "c", kind: "skill", title: "C", at: ["skill:x"] },
];

async function boot(extra: Pack[] = []) {
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
    { id: "docs", pack: "docs", config: { every: 20 } },
    ...extra.map((p) => ({ id: p.id, pack: p.id })),
  ]);
  return { rt, loader, reg, read: rt.root.get<DocsRead>(KEY) };
}

test("docs.read: every loaded pack, in tree order, read from the packs themselves", async () => {
  const { rt, loader, read } = await boot();
  const all = await read.packs();
  assert.deepEqual(all.map((d) => d.id), ["action", "graph", "words", "lonely", "docs"]);
  const w = all.find((d) => d.id === "words")!;
  assert.equal(w.side, "server");
  assert.equal(w.state, "active");
  // What it says it is for, from the pack itself; none when it says nothing.
  assert.equal(w.about, "Notes to agents whose wording lives on the map.");
  assert.equal(all.find((d) => d.id === "graph")!.about, undefined);
  // Provides, a child's included; injects, with the spec contract each key is in.
  assert.deepEqual(w.provides.map((k) => k.key), ["words.own", "words.part"]);
  assert.deepEqual(w.inject, [{ key: "graph.own" }]);
  assert.deepEqual(keyDoc("graph.read"), { key: "graph.read", contract: "graph", since: 1, doc: keyDoc("graph.read").doc });
  assert.deepEqual(w.parts, ["words-part"]);
  // Its own actions, the kinds of item it defines, places counted from its nodes.
  assert.deepEqual(w.actions.map((a) => a.name), ["words.set"]);
  // How many of each kind the map holds; what it did in the newest run.
  assert.deepEqual(w.types, [{ name: "node", base: "record", doc: "Words said to agents", count: 3 }, { name: "says_at", base: "link" }]);
  assert.deepEqual(w.activity, { run: "r1", said: 2, refused: 1, acted: 0 });
  assert.deepEqual(w.places, [{ place: "tool:Bash", nodes: 2 }, { place: "reply_end", nodes: 1 }]);
  // Config: functions named, secrets hidden.
  assert.deepEqual(w.config, { seed: [1], apiToken: "•••", onListen: "ƒ" });
  assert.deepEqual(all.find((d) => d.id === "action")!.provides.map((k) => k.contract), ["action", "agent", "exchange", "exchange", "graph", "graph", "types"]);
  const l = all.find((d) => d.id === "lonely")!;
  assert.equal(l.state, "waiting");
  assert.deepEqual(l.missing, ["nothing.here"]);
  // Built in: loaded from under this repository's root, as the loader says where from.
  assert.equal(w.builtIn, false);
  assert.equal(reference(rt, { side: "server", root: "mem:/" }).find((d) => d.id === "words")!.builtIn, true);
  assert.equal(reference(rt, { side: "server", root: "mem:/w" }).find((d) => d.id === "graph")!.builtIn, false);
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
    slots: () => [{ name: "center", merge: "many", pack: "shell", doc: "views" }],
    fills: (s) => (s === "center" ? [{ slot: s, name: "view", title: "Packs", pack: "docs", view: () => null }] : []),
    watch: () => () => {},
    Slot: () => null,
  };
  const all = reference(rt, { side: "page", slots });
  assert.deepEqual(all.find((d) => d.id === "shell")!.slots, { declares: [{ name: "center", merge: "many", doc: "views" }], fills: [] });
  assert.deepEqual(all.find((d) => d.id === "docs")!.slots, { declares: [], fills: [{ slot: "center", name: "view", title: "Packs" }] });
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
  assert.match(list, /^words \(active\) Notes to agents whose wording lives on the map\.; provides words\.own, words\.part; actions words\.set; speaks at 2 places$/m);
  assert.match(list, /^lonely \(waiting\); waits for nothing\.here$/m);
  const one = JSON.parse((await packs.call({ pack: "words" }, undefined)).text);
  assert.equal(one.actions[0].name, "words.set");
  assert.equal((await packs.call({ pack: "nope" }, undefined)).isError, true);
  await loader.apply([]);
});

test("every pack in this repository says what it is for, in one sentence", async () => {
  const root = new URL("../packs/", import.meta.url);
  const missing: string[] = [];
  let packs = 0;
  for (const dir of await readdir(root)) {
    for (const file of await readdir(new URL(`${dir}/`, root)).catch(() => [] as string[])) {
      if (!file.endsWith(".ts")) continue;
      // Line ends as LF, whatever the checkout wrote (CRLF on Windows).
      const src = (await readFile(new URL(`${dir}/${file}`, root), "utf8")).replace(/\r\n/g, "\n");
      // A pack object: its id at the top level of an object literal, two spaces in.
      for (const m of src.matchAll(/^ {2}id: "([a-z-]+)",\n(?! {2}about: "[A-Z][^"\n]*\.",\n)/gm)) missing.push(`${dir}/${file} (${m[1]})`);
      packs += [...src.matchAll(/^ {2}id: "[a-z-]+",\n {2}about: /gm)].length;
    }
  }
  assert.deepEqual(missing, []);
  assert.ok(packs >= 40);
});

const doc = (over: Partial<PackDoc>): PackDoc => ({ id: "p", side: "server", state: "active", position: [0], inject: [], provides: [], actions: [], places: [], ...over });
const key = (k: string, contract?: string) => ({ key: k, ...(contract ? { contract } : {}) });

test("reading: the folder a pack is in, and each pack's acts in a run", () => {
  assert.equal(folderOf("file:///r/packs/docs/tool.ts"), "docs");
  assert.equal(folderOf("http://h:5480/packs/bridge/client.ts"), "bridge");
  assert.equal(folderOf("mem:/words"), undefined);
  assert.deepEqual(
    [...activityOf("r", [{ kind: "say", pack: "a" }, { kind: "act", pack: "a" }, { kind: "miss", pack: "b" }, { kind: "refuse", pack: "c" }, { kind: "say" }])],
    [["a", { run: "r", said: 1, refused: 0, acted: 1 }], ["c", { run: "r", said: 0, refused: 1, acted: 0 }]],
  );
});

test("cards: what a pack adds, as counts, live where they can be, each opening where it is", () => {
  const map = doc({ id: "map", slots: { declares: [{ name: "map.bar", merge: "many" }], fills: [{ slot: "center", name: "view", title: "Map" }] } });
  const find = doc({ id: "find", slots: { declares: [], fills: [{ slot: "map.bar", name: "find", title: "Find" }, { slot: "root", name: "x" }] } });
  const p = doc({
    actions: [{ name: "items.create", title: "Make an item", input: {} }],
    types: [{ name: "work", count: 40 }, { name: "branch", base: "work", count: 100, more: true }, { name: "part_of", base: "link" }],
    places: [{ place: "tool:Bash", nodes: 2 }, { place: "prompt", nodes: 1 }],
    activity: { run: "r1", said: 3, refused: 0, acted: 1 },
    provides: [key("p.read")],
  });
  const user = doc({ id: "user", inject: [key("p.read")] });
  const all = [map, find, p, user];
  assert.deepEqual(countsOf(p, all), [
    { key: "kinds", label: "140+ items", items: [{ title: "work: 40", query: "type:work" }, { title: "branch (a kind of work): 100+", query: "type:branch" }] },
    { key: "links", label: "1 kind of link", items: [{ title: "part_of" }] },
    { key: "actions", label: "1 action", items: [{ title: "Make an item" }] },
    { key: "says", label: "3 nodes for agents", to: { title: "Reflex tree", view: "reflex" } },
    { key: "run", label: "last run: said 3 times, 1 act", to: { title: "the run", view: "harness", run: "r1" } },
    { key: "used", label: "used by 1 pack", items: [{ title: "user", pack: "user" }] },
  ]);
  // Not counted (the map wasn't read): the kinds, by number.
  assert.equal(countsOf(doc({ types: [{ name: "work" }] }))[0]!.label, "1 kind of item");
  assert.deepEqual(countsOf(map, all), [{ key: "views", label: "1 view", items: [{ title: "Map", view: "map" }] }]);
  // A part opens the view it is in: the pack that declared its slot.
  assert.deepEqual(countsOf(find, all), [{ key: "parts", label: "1 part of a view", items: [{ title: "Find", view: "map" }] }]);
  assert.deepEqual(usedBy(user, all), []);
  assert.deepEqual(uses(user, all), ["p"]);
  assert.deepEqual(countsOf(user, all), []);
  assert.ok(matches(p, "make item"));
  assert.ok(matches(p, "branch"));
  assert.ok(!matches(p, "tool:bash"));
});

test("lists: problems first and only when there are any, then features, then the foundation, each by name", () => {
  const all = [
    doc({ id: "map" }),
    doc({ id: "w", state: "waiting" }),
    doc({ id: "graph", provides: [key("graph.read", "graph")] }),
    doc({ id: "docs", provides: [key("docs.read")] }),
    doc({ id: "action", provides: [key("action.list", "action")] }),
  ];
  assert.ok(foundation(all[2]!));
  assert.ok(!foundation(all[3]!));
  assert.deepEqual(listsOf(all).map((l) => [l.title, l.docs.map((d) => d.id)]), [
    ["Needs attention", ["w"]],
    ["Features", ["docs", "map"]],
    ["Foundation", ["action", "graph"]],
  ]);
  assert.deepEqual(listsOf([doc({})]).map((l) => l.title), ["Features"]);
  assert.equal(stateWords(doc({})), undefined);
  assert.equal(stateWords(doc({ state: "waiting" })), "Waiting for another pack to load.");
  assert.equal(stateWords(doc({ state: "off" })), "Turned off.");
  assert.equal(stateWords(doc({ state: "failed", error: "boom" })), "Failed to start: boom");
});

test("byFolder: the packs in one folder are one card, its line the folder's own", () => {
  const all = byFolder([
    doc({ id: "docs", folder: "docs", about: "What each pack is for.", provides: [key("docs.read")], activity: { run: "r", said: 1, refused: 0, acted: 0 } }),
    doc({ id: "docs-tool", folder: "docs", about: "The tool.", inject: [key("mcp.host")], activity: { run: "r", said: 2, refused: 0, acted: 1 } }),
    doc({ id: "docs", folder: "docs", side: "page", slots: { declares: [], fills: [{ slot: "center", name: "view", title: "Packs" }] } }),
    doc({ id: "bridge", folder: "bridge" }),
    doc({ id: "bridge", folder: "bridge", side: "page", state: "failed", error: "boom", provides: [key("graph.read", "graph")] }),
    doc({ id: "graph", provides: [key("graph.read", "graph")] }),
    doc({ id: "words", inject: [key("graph.read")] }),
  ]);
  assert.deepEqual(all.map((d) => d.id), ["docs", "bridge", "graph", "words"]);
  // Ties are read in each runtime: the page's bridge re-provides graph.read, which is no tie on the server.
  assert.deepEqual(uses(all[3]!, all), ["graph"]);
  assert.deepEqual(usedBy(all[2]!, all), ["words"]);
  assert.deepEqual(usedBy(all[1]!, all), []);
  const d = all[0]!;
  assert.equal(d.about, "What each pack is for.");
  assert.deepEqual(d.parts, ["docs", "docs-tool"]);
  assert.deepEqual(d.provides.map((k) => k.key), ["docs.read"]);
  assert.deepEqual(d.inject.map((k) => k.key), ["mcp.host"]);
  assert.deepEqual(d.activity, { run: "r", said: 3, refused: 0, acted: 1 });
  assert.deepEqual(countsOf(d)[0]!.items, [{ title: "Packs", view: "docs" }]);
  // A problem in either half shows on the one card.
  assert.equal(stateWords(all[1]!), "Failed to start: boom");
  assert.deepEqual(all[1]!.provides.map((k) => k.key), ["graph.read"]);
  assert.equal(JSON.stringify(shownConfig({ deep: { password: 1, x: undefined } })), '{"deep":{"password":"•••"}}');
});

test("fieldsOf: an action's input in words, for its pack's page", () => {
  assert.deepEqual(
    fieldsOf({ type: "object", properties: { node: { type: "string", description: "Its id" }, kind: { enum: ["a", "b"] }, at: { type: "array", items: { type: "string" } }, x: {} }, required: ["node"] }),
    [
      { name: "node", type: "string", required: true, doc: "Its id" },
      { name: "kind", type: '"a" or "b"', required: false },
      { name: "at", type: "list of string", required: false },
      { name: "x", type: "anything", required: false },
    ],
  );
  assert.deepEqual(fieldsOf({ type: "object" }), []);
});
