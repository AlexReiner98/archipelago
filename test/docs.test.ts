import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import type { ActionInfo, ActionList } from "../spec/action.ts";
import type { AgentTree, NodeInfo } from "../spec/agent.ts";
import type { SlotRead } from "../spec/slot.ts";
import type { TypesRead } from "../spec/types.ts";
import { Runtime, type Plugin } from "../runtime/core.ts";
import { Loader } from "../runtime/loader.ts";
import docs, { KEY, type DocsRead } from "../plugins/docs/index.ts";
import tool, { brief } from "../plugins/docs/tool.ts";
import { ago, byFolder, countsOf, failureOf, fieldsOf, foundation, listsOf, matches, originWords, stateWords, usedBy, uses } from "../plugins/docs/cards.ts";
import { origins } from "../plugins/docs/origin.ts";
import { activityOf, failureKey, folderOf, keyDoc, reference, Seen, shortPath, shownConfig, stackOf, type PluginDoc } from "../plugins/docs/read.ts";
import type { ExchangeRead, ExchangeWatch } from "../spec/exchange.ts";
import type { GraphRead, GraphWatch } from "../spec/graph.ts";
import type { McpHost, ToolDef } from "../plugins/mcp/host.ts";

/** The registries a server has, as stubs: what the docs plugin reads. */
function registries(actions: ActionInfo[], nodes: NodeInfo[]) {
  const on = new Set<() => void>();
  const watch = (f: () => void) => (on.add(f), () => void on.delete(f));
  const plugin: Plugin = {
    id: "action",
    apply(ctx) {
      ctx.provide<ActionList>("action.list", () => ({ list: () => actions, watch }));
      ctx.provide<AgentTree>("agent.tree", () => ({ nodes: () => nodes, watch }));
      const all = {
        types: [{ name: "node", base: "record", doc: "Words said to agents", statuses: {} as any, fields: {}, trial: false, plugin: "words" }],
        links: [{ name: "says_at", plugin: "words" }],
      };
      ctx.provide<TypesRead>("types.read", () => ({ all: () => all, get: () => undefined, watch }));
      // The map holds 3 nodes; the newest run has words' says and a refusal.
      ctx.provide<GraphRead>("graph.read", () => ({ of: async (type: string, page?: { limit?: number }) => (type === "node" ? { items: [1, 2, 3].slice(0, page?.limit ?? 3) as any, ...(page?.limit && page.limit < 3 ? { next: "c" } : {}) } : { items: [] }) }) as any);
      ctx.provide<GraphWatch>("graph.watch", () => ({ watch: () => () => {} }));
      ctx.provide<ExchangeRead>("exchange.read", () => ({
        runs: async () => ({ items: [{ run: "r1" }] as any }),
        events: async () => ({ items: [{ kind: "say", plugin: "words" }, { kind: "say", plugin: "words" }, { kind: "refuse", plugin: "words" }, { kind: "begin" }] as any }),
        said: async () => ({ items: [] }),
      }));
      ctx.provide<ExchangeWatch>("exchange.watch", () => ({ watch: () => () => {} }));
    },
  };
  return { plugin, changed: () => [...on].forEach((f) => f()) };
}

const graph: Plugin = { id: "graph", apply: (ctx) => void ctx.provide("graph.own", () => ({})) };
const words: Plugin = {
  id: "words",
  about: "Notes to agents whose wording lives on the map.",
  inject: ["graph.own"],
  apply(ctx) {
    ctx.provide("words.own", () => ({}));
    ctx.plugin({ id: "words-part", apply: (c) => void c.provide("words.part", () => ({})) });
  },
};
const lonely: Plugin = { id: "lonely", inject: ["nothing.here"], apply() {} };

const ACTIONS: ActionInfo[] = [
  { name: "words.set", title: "Set a node's words", plugin: "words", input: { type: "object", properties: { node: { type: "string" } }, required: ["node"] } },
  { name: "graph.x", title: "Elsewhere", plugin: "graph", input: { type: "object" } },
];
const NODES: NodeInfo[] = [
  { id: "words/a", plugin: "words", name: "a", kind: "reflex", title: "A", at: ["tool:Bash", "reply_end"] },
  { id: "words/b", plugin: "words", name: "b", kind: "reflex", title: "B", at: ["tool:Bash"] },
  { id: "loaded/c", plugin: "loaded", name: "c", kind: "skill", title: "C", at: ["skill:x"] },
];

async function boot(extra: Plugin[] = []) {
  const rt = new Runtime();
  rt.onError = () => {};
  const reg = registries(ACTIONS, NODES);
  const modules: Record<string, Plugin> = { action: reg.plugin, graph, words, lonely, docs, ...Object.fromEntries(extra.map((p) => [p.id, p])) };
  const loader = new Loader(rt, { base: "mem:/", import: async (url) => ({ default: modules[url.slice(5)]! }) });
  await loader.apply([
    { id: "action", plugin: "action" },
    { id: "graph", plugin: "graph" },
    { id: "words", plugin: "words", config: { seed: [1], apiToken: "s3cret", onListen: () => {} } },
    { id: "lonely", plugin: "lonely" },
    { id: "docs", plugin: "docs", config: { every: 20 } },
    ...extra.map((p) => ({ id: p.id, plugin: p.id })),
  ]);
  return { rt, loader, reg, read: rt.root.get<DocsRead>(KEY) };
}

test("docs.read: every loaded plugin, in tree order, read from the plugins themselves", async () => {
  const { rt, loader, read } = await boot();
  const all = await read.plugins();
  assert.deepEqual(all.map((d) => d.id), ["action", "graph", "words", "lonely", "docs"]);
  const w = all.find((d) => d.id === "words")!;
  assert.equal(w.side, "server");
  assert.equal(w.state, "active");
  // What it says it is for, from the plugin itself; none when it says nothing.
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

test("docs.read.watch: told when a plugin leaves, and when actions or nodes change", async () => {
  const { loader, reg, read } = await boot();
  let n = 0;
  read.watch(() => n++);
  reg.changed();
  assert.equal(n, 1);
  await loader.apply(loader.tree.map((e) => (e.id === "graph" ? { ...e, disabled: true } : e)));
  await new Promise((ok) => setTimeout(ok, 80));
  assert.ok(n > 1);
  const all = await read.plugins();
  assert.equal(all.find((d) => d.id === "graph")!.state, "off");
  assert.equal(all.find((d) => d.id === "words")!.state, "waiting");
  await loader.apply([]);
});

test("the page side: slots a plugin declares and fills", () => {
  const rt = new Runtime();
  rt.onError = () => {};
  rt.root.plugin({ id: "shell", apply() {} });
  rt.root.plugin({ id: "docs", apply() {} });
  const slots: SlotRead = {
    slots: () => [{ name: "center", merge: "many", plugin: "shell", doc: "views" }],
    fills: (s) => (s === "center" ? [{ slot: s, name: "view", title: "Plugins", plugin: "docs", view: () => null }] : []),
    watch: () => () => {},
    Slot: () => null,
  };
  const all = reference(rt, { side: "page", slots });
  assert.deepEqual(all.find((d) => d.id === "shell")!.slots, { declares: [{ name: "center", merge: "many", doc: "views" }], fills: [] });
  assert.deepEqual(all.find((d) => d.id === "docs")!.slots, { declares: [], fills: [{ slot: "center", name: "view", title: "Plugins" }] });
});

test("the plugins tool: agents read the same reference", async () => {
  const tools: ToolDef[] = [];
  const host: Plugin = {
    id: "host",
    apply(ctx) {
      ctx.provide<McpHost>("mcp.host", () => ({ harness: "test", place: (t) => `tool:${t}`, add: (d) => (tools.push(d), () => {}) }));
    },
  };
  const { loader, read } = await boot([host, tool]);
  const plugins = tools.find((t) => t.name === "plugins")!;
  assert.ok(plugins);
  const list = (await plugins.call({}, undefined)).text;
  assert.equal(list, brief(await read.plugins()));
  assert.match(list, /^words \(active\) Notes to agents whose wording lives on the map\.; provides words\.own, words\.part; actions words\.set; speaks at 2 places$/m);
  assert.match(list, /^lonely \(waiting\); waits for nothing\.here$/m);
  const one = JSON.parse((await plugins.call({ plugin: "words" }, undefined)).text);
  assert.equal(one.actions[0].name, "words.set");
  assert.equal((await plugins.call({ plugin: "nope" }, undefined)).isError, true);
  await loader.apply([]);
});

test("every plugin in this repository says what it is for, in one sentence", async () => {
  const root = new URL("../plugins/", import.meta.url);
  const missing: string[] = [];
  let plugins = 0;
  for (const dir of await readdir(root)) {
    for (const file of await readdir(new URL(`${dir}/`, root)).catch(() => [] as string[])) {
      if (!file.endsWith(".ts")) continue;
      // Line ends as LF, whatever the checkout wrote (CRLF on Windows).
      const src = (await readFile(new URL(`${dir}/${file}`, root), "utf8")).replace(/\r\n/g, "\n");
      // A plugin object: its id at the top level of an object literal, two spaces in.
      for (const m of src.matchAll(/^ {2}id: "([a-z-]+)",\n(?! {2}about: "[A-Z][^"\n]*\.",\n)/gm)) missing.push(`${dir}/${file} (${m[1]})`);
      plugins += [...src.matchAll(/^ {2}id: "[a-z-]+",\n {2}about: /gm)].length;
    }
  }
  assert.deepEqual(missing, []);
  assert.ok(plugins >= 40);
});

const doc = (over: Partial<PluginDoc>): PluginDoc => ({ id: "p", side: "server", state: "active", position: [0], inject: [], provides: [], actions: [], places: [], ...over });
const key = (k: string, contract?: string) => ({ key: k, ...(contract ? { contract } : {}) });

test("reading: the folder a plugin is in, and each plugin's acts in a run", () => {
  assert.equal(folderOf("file:///r/plugins/docs/tool.ts"), "docs");
  assert.equal(folderOf("http://h:5480/plugins/bridge/client.ts"), "bridge");
  assert.equal(folderOf("mem:/words"), undefined);
  assert.deepEqual(
    [...activityOf("r", [{ kind: "say", plugin: "a" }, { kind: "act", plugin: "a" }, { kind: "miss", plugin: "b" }, { kind: "refuse", plugin: "c" }, { kind: "say" }])],
    [["a", { run: "r", said: 1, refused: 0, acted: 1 }], ["c", { run: "r", said: 0, refused: 1, acted: 0 }]],
  );
});

test("cards: what a plugin adds, as counts, live where they can be, each opening where it is", () => {
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
    { key: "says", label: "3 nodes for agents", to: { title: "Context interface", view: "harness" } },
    { key: "run", label: "last run: said 3 times, 1 act", to: { title: "the run", view: "harness", run: "r1" } },
    { key: "used", label: "used by 1 plugin", items: [{ title: "user", plugin: "user" }] },
  ]);
  // Not counted (the map wasn't read): the kinds, by number.
  assert.equal(countsOf(doc({ types: [{ name: "work" }] }))[0]!.label, "1 kind of item");
  assert.deepEqual(countsOf(map, all), [{ key: "views", label: "1 view", items: [{ title: "Map", view: "map" }] }]);
  // A part opens the view it is in: the plugin that declared its slot.
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
  assert.equal(stateWords(doc({ state: "waiting" })), "Waiting for another plugin to load.");
  assert.equal(stateWords(doc({ state: "off" })), "Turned off.");
  assert.equal(stateWords(doc({ state: "failed", error: "boom" })), "Failed to start: boom");
});

test("byFolder: the plugins in one folder are one card, its line the folder's own", () => {
  const all = byFolder([
    doc({ id: "docs", folder: "docs", about: "What each plugin is for.", provides: [key("docs.read")], activity: { run: "r", said: 1, refused: 0, acted: 0 } }),
    doc({ id: "docs-tool", folder: "docs", about: "The tool.", inject: [key("mcp.host")], activity: { run: "r", said: 2, refused: 0, acted: 1 } }),
    doc({ id: "docs", folder: "docs", side: "page", slots: { declares: [], fills: [{ slot: "center", name: "view", title: "Plugins" }] } }),
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
  assert.equal(d.about, "What each plugin is for.");
  assert.deepEqual(d.parts, ["docs", "docs-tool"]);
  assert.deepEqual(d.provides.map((k) => k.key), ["docs.read"]);
  assert.deepEqual(d.inject.map((k) => k.key), ["mcp.host"]);
  assert.deepEqual(d.activity, { run: "r", said: 3, refused: 0, acted: 1 });
  assert.deepEqual(countsOf(d)[0]!.items, [{ title: "Plugins", view: "docs" }]);
  // A problem in either half shows on the one card.
  assert.equal(stateWords(all[1]!), "Failed to start: boom");
  assert.deepEqual(all[1]!.provides.map((k) => k.key), ["graph.read"]);
  assert.equal(JSON.stringify(shownConfig({ deep: { password: 1, x: undefined } })), '{"deep":{"password":"•••"}}');
});

test("fieldsOf: an action's input in words, for its plugin's page", () => {
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

test("a failed plugin: its error, when it was first seen, and where to look, whether its import or its apply threw", async () => {
  const rt = new Runtime();
  rt.onError = () => {};
  const reg = registries(ACTIONS, NODES);
  const thrower: Plugin = {
    id: "thrower",
    apply: () => {
      throw new Error("no config file");
    },
  };
  const modules: Record<string, Plugin> = { action: reg.plugin, docs, "plugins/thrower/index.ts": thrower };
  const loader = new Loader(rt, {
    base: "mem:/",
    import: async (url) => {
      if (url.endsWith("broken/index.ts")) throw new SyntaxError("Unexpected token '}'");
      return { default: modules[url.slice(5)]! };
    },
  });
  await loader.apply([
    { id: "action", plugin: "action" },
    { id: "docs", plugin: "docs", config: { every: 20, log: "/home/me/.data/server.log" } },
    { id: "broken", plugin: "plugins/broken/index.ts" },
    { id: "thrower", plugin: "plugins/thrower/index.ts" },
  ]);
  const read = rt.root.get<DocsRead>(KEY);
  const all = await read.plugins();
  // One whose module failed to import has no fiber: its card is read from the tree, named for its folder.
  const b = all.find((d) => d.id === "broken")!;
  assert.equal(b.state, "failed");
  assert.equal(b.folder, "broken");
  assert.equal(b.error, "Unexpected token '}'");
  // The log file isn't written by this process: the server's output is where to look.
  assert.deepEqual(b.where, { module: "plugins/broken/index.ts", log: "the server's output, in the terminal it runs in" });
  assert.deepEqual(b.entries, [{ id: "broken", side: "server", off: false }]);
  assert.ok(!Number.isNaN(Date.parse(b.failedAt!)));
  // One whose apply threw: the same, with its stack.
  const t = all.find((d) => d.id === "thrower")!;
  assert.equal(t.error, "no config file");
  assert.equal(t.where?.module, "plugins/thrower/index.ts");
  assert.match(t.stack![0]!, /^Error: no config file/);
  assert.ok(t.failedAt);
  // Both need attention, and say what went wrong in words.
  const f = failureOf(byFolder(all).find((d) => d.id === "broken")!, Date.parse(b.failedAt!) + 120_000)!;
  assert.equal(f.error, "Unexpected token '}'");
  assert.match(f.when!, /^Seen failing at \d\d:\d\d:\d\d, 2 min ago$/);
  assert.deepEqual(f.look, ["plugins/broken/index.ts, its module", "the server's output, in the terminal it runs in"]);
  assert.deepEqual(listsOf(byFolder(all))[0]!.docs.map((d) => d.id), ["broken", "thrower"]);
  // Taken out of the tree, it is gone from the view.
  await loader.apply(loader.tree.filter((e) => e.id !== "broken"));
  assert.equal((await read.plugins()).some((d) => d.id === "broken"), false);
  await loader.apply([]);
});

test("Seen: a failure's time is when it was first seen, forgotten once it is gone", () => {
  let now = Date.parse("2026-11-27T10:00:00Z");
  const seen = new Seen(() => now);
  const k = failureKey("server", [3], "boom");
  seen.note([k]);
  now += 5000;
  seen.note([k]);
  assert.equal(seen.at(k), "2026-11-27T10:00:00.000Z");
  seen.note([]);
  assert.equal(seen.at(k), undefined);
  seen.note([k]);
  assert.equal(seen.at(k), "2026-11-27T10:00:05.000Z");
});

test("stackOf: the stack's paths from the repository's root, and the frame in the plugin's own folder", () => {
  const e = new Error("boom");
  e.stack = [
    "Error: boom",
    "    at Fiber.reload (file:///home/me/arch/runtime/core.ts:380:41)",
    "    at load (file:///home/me/arch/plugins/thrower/util.ts:12:9)",
    "    at apply (file:///home/me/arch/plugins/thrower/index.ts:7:11)",
  ].join("\n");
  const s = stackOf(e, "file:///home/me/arch/", "thrower");
  assert.equal(s.file, "plugins/thrower/util.ts:12");
  assert.equal(s.stack![1], "at Fiber.reload (runtime/core.ts:380:41)");
  // Windows paths too, and with no frame in its folder, the first outside the kernel.
  e.stack = "Error: boom\n    at x (C:\\Users\\me\\arch\\runtime\\core.ts:1:1)\n    at y (C:\\Users\\me\\arch\\plugins\\other\\a.ts:4:2)";
  assert.equal(stackOf(e, "file:///C:/Users/me/arch/", "thrower").file, "plugins/other/a.ts:4");
  assert.deepEqual(stackOf("not an error"), {});
  // A plugin from outside this repository: the frame in its module's own folder, shown short on a card.
  e.stack = "Error: boom\n    at load (file:///home/me/mine/thrower/index.ts:1:28)\n    at Fiber.reload (file:///home/me/arch/runtime/core.ts:381:34)";
  const out = stackOf(e, "file:///home/me/arch/", undefined, "file:///home/me/mine/thrower/index.ts");
  assert.equal(out.file, "file:///home/me/mine/thrower/index.ts:1");
  assert.equal(shortPath(out.file!), "…/mine/thrower/index.ts:1");
  assert.equal(shortPath("plugins/docs/index.ts:3"), "plugins/docs/index.ts:3");
});

test("origin: where a plugin came from, at what commit or version, and when it last changed, read from its folder", async () => {
  const base = await mkdtemp(join(tmpdir(), "docs-origin-"));
  try {
    const inside = join(base, "repo", "plugins", "x");
    const outside = join(base, "mine", "extra");
    await mkdir(inside, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(inside, "index.ts"), "export default {}");
    await writeFile(join(base, "mine", "package.json"), JSON.stringify({ name: "my-plugins", version: "1.2.0" }));
    await writeFile(join(outside, "index.ts"), "export default {}");
    const calls: string[][] = [];
    let edited = "";
    const git = async (cwd: string, args: string[]) => {
      calls.push(args);
      if (!cwd.startsWith(join(base, "repo"))) return undefined;
      return args[0] === "log" ? "3f2a1c9\t2026-11-20T10:00:00+00:00" : edited || undefined;
    };
    let now = 0;
    const o = origins(pathToFileURL(join(base, "repo") + "/").href, { git, fresh: 1000, now: () => now });
    const a = pathToFileURL(join(inside, "index.ts")).href;
    const b = pathToFileURL(join(outside, "index.ts")).href;
    const got = await o.of([a, b, "mem:/x"]);
    assert.deepEqual(got.get(a), { from: "repository", path: "plugins/x", commit: "3f2a1c9", changed: "2026-11-20T10:00:00+00:00" });
    const out = got.get(b)!;
    assert.equal(out.from, "outside");
    assert.equal(out.name, "my-plugins");
    assert.equal(out.version, "1.2.0");
    assert.ok(out.changed && !Number.isNaN(Date.parse(out.changed)));
    assert.equal(got.has("mem:/x"), false);
    // Kept for `fresh`: no git again until it has passed; then edits not committed show, with the newest file's time.
    const n = calls.length;
    await o.of([a]);
    assert.equal(calls.length, n);
    edited = " M index.ts";
    now = 2000;
    const again = (await o.of([a])).get(a)!;
    assert.equal(again.edited, true);
    assert.notEqual(again.changed, "2026-11-20T10:00:00+00:00");
    // In words, on the card.
    const at = Date.parse("2026-11-22T10:00:00Z");
    assert.equal(originWords({ ...doc({}), origin: got.get(a)! }, at), "This repository at 3f2a1c9, changed 2 days ago");
    assert.equal(originWords({ ...doc({}), origin: { from: "outside", name: "my-plugins", version: "1.2.0", changed: "2026-11-22T09:58:00Z" } }, at), "Outside: my-plugins v1.2.0, changed 2 min ago");
    assert.equal(originWords({ ...doc({}), origin: { from: "repository", commit: "3f2a1c9", changed: "2026-11-22T07:00:00Z", edited: true } }, at), "This repository at 3f2a1c9, edited 3 h ago, not committed");
    assert.equal(originWords(doc({})), undefined);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("ago: a time beside now, as a person reads it", () => {
  const now = Date.parse("2026-11-27T12:00:00Z");
  assert.equal(ago("2026-11-27T11:59:30Z", now), "just now");
  assert.equal(ago("2026-11-26T11:00:00Z", now), "yesterday");
  assert.equal(ago("2026-10-01T12:00:00Z", now), "1 Oct 2026");
  assert.equal(ago("not a time", now), "not a time");
});

test("byFolder: a card carries its folder's origin, and the failing half's error, time and where to look", () => {
  const origin = { from: "repository" as const, path: "plugins/w", commit: "abc1234" };
  const [card] = byFolder([
    { ...doc({ id: "w", side: "server" }), folder: "w", origin },
    {
      ...doc({ id: "w-view", side: "page", state: "failed", error: "boom" }),
      folder: "w",
      failedAt: "2026-11-27T10:00:00Z",
      where: { file: "plugins/w/view.ts:3", log: "the browser's console" },
      stack: ["Error: boom"],
    },
  ]);
  assert.deepEqual(card!.origin, origin);
  assert.equal(card!.error, "boom");
  assert.equal(card!.failedAt, "2026-11-27T10:00:00Z");
  assert.deepEqual(failureOf(card!)!.look, ["plugins/w/view.ts:3, where it threw", "the browser's console"]);
  assert.deepEqual(card!.stack, ["Error: boom"]);
  assert.equal(failureOf(doc({})), undefined);
});
