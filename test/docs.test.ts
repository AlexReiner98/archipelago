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
import { countsOf, listsOf, matches, merged, stateWords, usedBy } from "../packs/docs/cards.ts";
import { keyDoc, reference, shownConfig, type PackDoc } from "../packs/docs/read.ts";
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
    },
  };
  return { pack, changed: () => [...on].forEach((f) => f()) };
}

const graph: Pack = { id: "graph", apply: (ctx) => void ctx.provide("graph.read", () => ({})) };
const words: Pack = {
  id: "words",
  about: "Notes to agents whose wording lives on the map.",
  inject: ["graph.read"],
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
  assert.deepEqual(w.inject, [{ key: "graph.read", contract: "graph", since: 1, doc: keyDoc("graph.read").doc }]);
  assert.deepEqual(w.parts, ["words-part"]);
  // Its own actions, the kinds of item it defines, places counted from its nodes.
  assert.deepEqual(w.actions.map((a) => a.name), ["words.set"]);
  assert.deepEqual(w.types, [{ name: "node", base: "record", doc: "Words said to agents" }, { name: "says_at", base: "link" }]);
  assert.deepEqual(w.places, [{ place: "tool:Bash", nodes: 2 }, { place: "reply_end", nodes: 1 }]);
  // Config: functions named, secrets hidden.
  assert.deepEqual(w.config, { seed: [1], apiToken: "•••", onListen: "ƒ" });
  assert.deepEqual(all.find((d) => d.id === "action")!.provides.map((k) => k.contract), ["action", "agent", "types"]);
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
      const src = await readFile(new URL(`${dir}/${file}`, root), "utf8");
      // A pack object: its id at the top level of an object literal, two spaces in.
      for (const m of src.matchAll(/^ {2}id: "([a-z-]+)",\n(?! {2}about: "[A-Z][^"\n]*\.",\n)/gm)) missing.push(`${dir}/${file} (${m[1]})`);
      packs += [...src.matchAll(/^ {2}id: "[a-z-]+",\n {2}about: /gm)].length;
    }
  }
  assert.deepEqual(missing, []);
  assert.ok(packs >= 40);
});

const doc = (over: Partial<PackDoc>): PackDoc => ({ id: "p", side: "server", state: "active", position: [0], inject: [], provides: [], actions: [], places: [], ...over });
const key = (k: string) => ({ key: k });

test("cards: what a pack adds, as counts that open where each thing is", () => {
  const map = doc({ id: "map", slots: { declares: [{ name: "map.bar", merge: "many" }], fills: [{ slot: "shell.main", name: "view", title: "Map" }] } });
  const find = doc({ id: "find", slots: { declares: [], fills: [{ slot: "map.bar", name: "find", title: "Find" }, { slot: "root", name: "x" }] } });
  const p = doc({
    actions: [{ name: "items.create", title: "Make an item", input: {} }],
    types: [{ name: "work" }, { name: "branch", base: "work" }, { name: "part_of", base: "link" }],
    places: [{ place: "tool:Bash", nodes: 2 }, { place: "prompt", nodes: 1 }],
    provides: [key("p.read")],
  });
  const user = doc({ id: "user", inject: [key("p.read")] });
  const all = [map, find, p, user];
  assert.deepEqual(countsOf(p, all), [
    { key: "kinds", label: "3 kinds of item", items: [{ title: "work", query: "type:work" }, { title: "branch (a kind of work)", query: "type:branch" }, { title: "part_of (link)" }] },
    { key: "actions", label: "1 action", items: [{ title: "Make an item" }] },
    { key: "says", label: "3 things said to agents", view: "reflex" },
    { key: "used", label: "used by 1 pack", items: [{ title: "user" }] },
  ]);
  assert.deepEqual(countsOf(map, all), [{ key: "views", label: "1 view", items: [{ title: "Map", view: "map" }] }]);
  // A part opens the view it is in: the pack that declared its slot.
  assert.deepEqual(countsOf(find, all), [{ key: "parts", label: "1 part of a view", items: [{ title: "Find", view: "map" }] }]);
  assert.deepEqual(usedBy(user, all), []);
  assert.deepEqual(countsOf(user, all), []);
  assert.ok(matches(p, "make item"));
  assert.ok(matches(p, "branch"));
  assert.ok(!matches(p, "tool:bash"));
});

test("lists: problems first and only when there are any, then built in, then added; states in words", () => {
  const all = [doc({ id: "a", builtIn: true }), doc({ id: "w", state: "waiting", builtIn: true }), doc({ id: "x", builtIn: false }), doc({ id: "b" })];
  assert.deepEqual(listsOf(all).map((l) => [l.title, l.docs.map((d) => d.id)]), [
    ["Needs attention", ["w"]],
    ["Built in", ["a", "b"]],
    ["Added", ["x"]],
  ]);
  assert.deepEqual(listsOf([doc({ builtIn: true })]).map((l) => l.title), ["Built in"]);
  assert.equal(stateWords(doc({})), undefined);
  assert.equal(stateWords(doc({ state: "waiting" })), "Waiting for another pack to load.");
  assert.equal(stateWords(doc({ state: "off" })), "Turned off.");
  assert.equal(stateWords(doc({ state: "failed", error: "boom" })), "Failed to start: boom");
});

test("merged: a pack with a server half and a page half is one card", () => {
  const server = [doc({ id: "docs", about: "What each pack is for." }), doc({ id: "bridge" }), doc({ id: "graph" })];
  const page = [
    doc({ id: "docs", side: "page", slots: { declares: [], fills: [{ slot: "shell.main", name: "view", title: "Packs" }] } }),
    doc({ id: "bridge", side: "page", provides: [key("graph.read")] }),
    doc({ id: "shell", side: "page", state: "failed", error: "boom" }),
  ];
  const all = merged(server, page);
  assert.deepEqual(all.map((d) => d.id), ["docs", "bridge", "graph", "shell"]);
  assert.deepEqual(countsOf(all[0]!)[0]!.items, [{ title: "Packs", view: "docs" }]);
  assert.equal(all[0]!.about, "What each pack is for.");
  assert.deepEqual(all[1]!.provides.map((k) => k.key), ["graph.read"]);
  assert.equal(JSON.stringify(shownConfig({ deep: { password: 1, x: undefined } })), '{"deep":{"password":"•••"}}');
});
