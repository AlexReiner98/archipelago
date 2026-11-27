import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionInvoke, Outcome } from "../spec/action.ts";
import type { Json } from "../spec/common.ts";
import type { GraphRead } from "../spec/graph.ts";
import { Runtime, type Plugin } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import action from "../plugins/action/index.ts";
import graph from "../plugins/graph/index.ts";
import history from "../plugins/history/index.ts";
import record from "../plugins/record/index.ts";
import types from "../plugins/types/index.ts";
import { TYPE as PAGE_TYPE } from "../plugins/page/overlay.ts";
import { byFolder } from "../plugins/docs/cards.ts";
import { reference, type PluginDoc } from "../plugins/docs/read.ts";
import sw, { refused, SET, TYPE, unlocked } from "../plugins/switch/server.ts";
import { holds, leftBy, needed, orphans, plan, splitOrphans, standsOn, stops } from "../plugins/switch/ties.ts";

const doc = (id: string, more: Partial<PluginDoc> = {}): PluginDoc => ({
  id,
  side: "page",
  state: "active",
  position: [0],
  inject: [],
  provides: [],
  actions: [],
  places: [],
  ...more,
});

// a ← b ← c (c uses b, b uses a); v fills frame's region; frame fills renderer's root.
const ALL: PluginDoc[] = [
  doc("a"),
  doc("b", { uses: ["a"] }),
  doc("c", { uses: ["b"] }),
  doc("lone"),
  doc("renderer", { slots: { declares: [{ name: "root", merge: "one" }, { name: "center", merge: "one" }], fills: [] } }),
  doc("frame", { slots: { declares: [], fills: [{ slot: "root", name: "frame" }] } }),
  doc("v", { slots: { declares: [], fills: [{ slot: "center", name: "view" }] } }),
  doc("docs", { uses: ["here"] }),
  doc("here"),
  doc("off", { uses: ["a"], entries: [{ id: "off", side: "page", off: true }] }),
];

test("ties: a card stands on what it uses and on the plugin whose slot it fills", () => {
  assert.deepEqual(standsOn(ALL[2]!, ALL), ["b"]);
  assert.deepEqual(standsOn(ALL[6]!, ALL), ["renderer"]);
  assert.deepEqual(standsOn(ALL[3]!, ALL), []);
});

test("ties: turning one off stops every running card that stands on it, however far down", () => {
  assert.deepEqual(stops("a", ALL), ["b", "c"], "off is already off: it doesn't stop");
  assert.deepEqual(stops("c", ALL), []);
  assert.deepEqual(stops("renderer", ALL), ["frame", "v"]);
});

test("ties: what the Plugins view and its switch stand on is needed, the rest can go", () => {
  const n = needed(ALL);
  assert.ok(n.has("docs") && n.has("here") && n.has("frame") && n.has("renderer"));
  assert.ok(!n.has("a") && !n.has("v") && !n.has("lone"));
  assert.deepEqual([...needed(ALL, ["c"])].sort(), ["a", "b", "c"]);
});

test("ties: an off card says what it left without a type; an on card, what its kinds hold", () => {
  const untyped = [
    { type: "work", plugin: "work", base: "work", items: 30 },
    { type: "bug", plugin: "work-bugs", base: "work", items: 12, more: true },
    { type: "event", items: 4 },
    { type: "note", plugin: "notes", base: "record", items: 2 },
  ];
  const off = doc("work", { parts: ["work", "work-bugs"], entries: [{ id: "work", side: "server", off: true }] });
  assert.deepEqual(leftBy(off, untyped).map((u) => u.type), ["work", "bug"], "by the card, its parts and its entries");
  assert.deepEqual(leftBy(doc("lone"), untyped), [], "a type never defined is no card's");

  const on = doc("work", { types: [{ name: "work", count: 30 }, { name: "bug", base: "work", count: 100, more: true }, { name: "chore", base: "work", count: 0 }] });
  assert.deepEqual(holds(on), { items: 130, more: true, kinds: ["work", "bug"] });
  assert.deepEqual(holds(doc("lone")), { items: 0, more: false, kinds: [] });
});

test("ties: kinds whose plugin is not loaded at all are no card's, and listed on their own", () => {
  const untyped = [
    { type: "work", plugin: "work", base: "work", items: 30 },
    { type: "branch", plugin: "branch", base: "record", items: 78 },
    { type: "event", items: 4 },
  ];
  const all = [doc("work", { entries: [{ id: "work", side: "server", off: true }] }), doc("lone")];
  assert.deepEqual(orphans(untyped, all).map((u) => u.type), ["branch", "event"], "work's card answers for work; branch's plugin was deleted; event was never defined");
  assert.deepEqual(orphans(untyped, [...all, doc("branch")]).map((u) => u.type), ["event"], "loaded again, its card answers for it");
  assert.deepEqual(orphans([], all), []);
});

test("ties: orphans split into kinds whose plugin is gone and kinds never seen defined", () => {
  const untyped = [
    { type: "work", plugin: "work", base: "work", items: 30 },
    { type: "branch", plugin: "branch", base: "record", items: 78 },
    { type: "node", items: 312 },
    { type: "loaded", items: 20 },
  ];
  const all = [doc("work", { entries: [{ id: "work", side: "server", off: true }] }), doc("words"), doc("loaded")];
  const { gone, never } = splitOrphans(untyped, all);
  assert.deepEqual(gone.map((u) => u.type), ["branch"], "its plugin is deleted: without a plugin");
  assert.deepEqual(never.map((u) => u.type), ["node", "loaded"], "a loaded plugin's own records, never a type: listed apart, not as plugin-less");
  assert.deepEqual(splitOrphans([], all), { gone: [], never: [] });
});

test("plan: a card's entries split by the runtime each is in", () => {
  const entries = [
    { id: "docs", side: "server", off: false },
    { id: "docs-tool", side: "server", off: false },
    { id: "docs", side: "page", off: false },
  ];
  assert.deepEqual(plan(entries, false), { page: ["docs"], server: ["docs", "docs-tool"], on: false });
});

test("docs reads each plugin's entry from the loader, and a card holds all of its folder's", async () => {
  const rt = new Runtime();
  const one: Plugin = { id: "one", apply() {} };
  const two: Plugin = { id: "two", apply() {} };
  const loader = new Loader(rt, { base: "mem:/", import: async (url) => ({ default: url.endsWith("one.ts") ? one : two }) });
  await loader.apply([
    { id: "first", plugin: "plugins/x/one.ts" },
    { id: "second", plugin: "plugins/x/two.ts", disabled: true },
  ]);
  const docs = reference(rt, { side: "server", entries: loader.status() });
  assert.deepEqual(docs.map((d) => d.entries), [[{ id: "first", side: "server", off: false }], [{ id: "second", side: "server", off: true }]]);
  const [card] = byFolder(docs.map((d) => ({ ...d, folder: "x" })));
  assert.deepEqual(card!.entries!.map((e) => e.id), ["first", "second"]);
});

/** A server with the switch, and two plugins to turn: `low` provides a key `high` uses. */
async function boot() {
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const low: Plugin = { id: "low", apply: (ctx) => ctx.provide("low.key", () => ({})) };
  const high: Plugin = { id: "high", inject: ["low.key"], apply() {} };
  const modules: Record<string, Plugin> = { graph, action, types, record, history, switch: sw, low, high };
  const loader = new Loader(rt, { base: "mem:/", import: async (url) => ({ default: modules[url.slice(5, -3)] }) });
  const tree: Entry[] = [
    // A config with a function, as the server's has: an edit must keep it.
    { id: "graph", plugin: "graph.ts", config: { onListen: () => {} } },
    ...["action", "types", "record", "history", "switch", "low", "high"].map((id) => ({ id, plugin: `${id}.ts` })),
  ];
  await loader.apply(tree);
  await rt.settle();
  const invoke = rt.root.get<ActionInvoke>("action.invoke");
  const call = (name: string, input: Json): Promise<Outcome> =>
    invoke.invoke({ action: name, input, authority: { of: "human", basis: "a test" }, reason: "a test" });
  const state = (id: string) => loader.status().find((s) => s.id === id)!.state;
  /** Waits for the switch to follow its item. */
  const until = async (ok: () => boolean) => {
    for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(ok(), "followed in time");
  };
  return { rt, loader, call, state, until, errors };
}

test("switch.set: the server's plugins and the page's in one change set, and undo takes both back", async () => {
  const { rt, call, state, until, errors } = await boot();
  assert.equal(state("low"), "active");
  const out = await call(SET, { server: ["low"], page: ["map"], on: false });
  assert.ok(out.ok && out.change, "one change set");
  await until(() => state("low") === "off");
  assert.notEqual(state("high"), "active", "what stood on it stops");
  const read = rt.root.get<GraphRead>("graph.read");
  assert.deepEqual((await read.of(TYPE, { limit: 2 })).items.map((i) => i.fields.plugins), [{ low: { off: true } }]);
  assert.deepEqual((await read.of(PAGE_TYPE, { limit: 2 })).items.map((i) => i.fields.plugins), [{ map: { off: true } }], "the item page.set writes");

  const undo = await call("history.undo", { change: out.change! });
  assert.ok(undo.ok);
  await until(() => state("low") === "active" && state("high") === "active");
  assert.equal((await read.of(PAGE_TYPE, { limit: 2 })).items.length, 0, "the page item goes with it");
  assert.deepEqual(errors, []);
});

test("switch.set: on null puts a plugin back as the template has it", async () => {
  const { call, state, until } = await boot();
  await call(SET, { server: ["low"], on: false });
  await until(() => state("low") === "off");
  await call(SET, { server: ["low"], on: null });
  await until(() => state("low") === "active");
});

test("switch.set: the way back can't be turned off, and a host adds its own locks", async () => {
  const { call, state } = await boot();
  const out = await call(SET, { server: ["history", "low"], on: false });
  assert.equal(out.ok, false, "refused, nothing changed");
  assert.match(JSON.stringify(out.ok ? {} : out.refused), /history/);
  assert.equal(state("history"), "active");
  assert.equal(state("low"), "active", "refused whole: nothing else in the same call goes off");
  assert.deepEqual(refused(["gateway", "low", "graph"], ["gateway"]), ["gateway", "graph"]);
});

test("switch: an item that says a locked plugin is off is never followed at start", () => {
  assert.deepEqual(unlocked({ graph: { off: true }, low: { off: true }, gateway: { off: true }, bridge: { off: false } }, ["gateway"]), {
    low: { off: true },
    bridge: { off: false },
  });
});
