import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionInvoke, Outcome } from "../spec/action.ts";
import type { Json } from "../spec/common.ts";
import type { GraphRead } from "../spec/graph.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import action from "../packs/action/index.ts";
import graph from "../packs/graph/index.ts";
import history from "../packs/history/index.ts";
import record from "../packs/record/index.ts";
import types from "../packs/types/index.ts";
import { TYPE as PAGE_TYPE } from "../packs/page/overlay.ts";
import { byFolder } from "../packs/docs/cards.ts";
import { reference, type PackDoc } from "../packs/docs/read.ts";
import sw, { SET, TYPE } from "../packs/switch/server.ts";
import { needed, plan, standsOn, stops } from "../packs/switch/ties.ts";

const doc = (id: string, more: Partial<PackDoc> = {}): PackDoc => ({
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
const ALL: PackDoc[] = [
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

test("ties: a card stands on what it uses and on the pack whose slot it fills", () => {
  assert.deepEqual(standsOn(ALL[2]!, ALL), ["b"]);
  assert.deepEqual(standsOn(ALL[6]!, ALL), ["renderer"]);
  assert.deepEqual(standsOn(ALL[3]!, ALL), []);
});

test("ties: turning one off stops every running card that stands on it, however far down", () => {
  assert.deepEqual(stops("a", ALL), ["b", "c"], "off is already off: it doesn't stop");
  assert.deepEqual(stops("c", ALL), []);
  assert.deepEqual(stops("renderer", ALL), ["frame", "v"]);
});

test("ties: what the Packs view and its switch stand on is needed, the rest can go", () => {
  const n = needed(ALL);
  assert.ok(n.has("docs") && n.has("here") && n.has("frame") && n.has("renderer"));
  assert.ok(!n.has("a") && !n.has("v") && !n.has("lone"));
  assert.deepEqual([...needed(ALL, ["c"])].sort(), ["a", "b", "c"]);
});

test("plan: a card's entries split by the runtime each is in", () => {
  const entries = [
    { id: "docs", side: "server", off: false },
    { id: "docs-tool", side: "server", off: false },
    { id: "docs", side: "page", off: false },
  ];
  assert.deepEqual(plan(entries, false), { page: ["docs"], server: ["docs", "docs-tool"], on: false });
});

test("docs reads each pack's entry from the loader, and a card holds all of its folder's", async () => {
  const rt = new Runtime();
  const one: Pack = { id: "one", apply() {} };
  const two: Pack = { id: "two", apply() {} };
  const loader = new Loader(rt, { base: "mem:/", import: async (url) => ({ default: url.endsWith("one.ts") ? one : two }) });
  await loader.apply([
    { id: "first", pack: "packs/x/one.ts" },
    { id: "second", pack: "packs/x/two.ts", disabled: true },
  ]);
  const docs = reference(rt, { side: "server", entries: loader.status() });
  assert.deepEqual(docs.map((d) => d.entries), [[{ id: "first", side: "server", off: false }], [{ id: "second", side: "server", off: true }]]);
  const [card] = byFolder(docs.map((d) => ({ ...d, folder: "x" })));
  assert.deepEqual(card!.entries!.map((e) => e.id), ["first", "second"]);
});

/** A server with the switch, and two packs to turn: `low` provides a key `high` uses. */
async function boot() {
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const low: Pack = { id: "low", apply: (ctx) => ctx.provide("low.key", () => ({})) };
  const high: Pack = { id: "high", inject: ["low.key"], apply() {} };
  const modules: Record<string, Pack> = { graph, action, types, record, history, switch: sw, low, high };
  const loader = new Loader(rt, { base: "mem:/", import: async (url) => ({ default: modules[url.slice(5, -3)] }) });
  const tree: Entry[] = [
    // A config with a function, as the server's has: an edit must keep it.
    { id: "graph", pack: "graph.ts", config: { onListen: () => {} } },
    ...["action", "types", "record", "history", "switch", "low", "high"].map((id) => ({ id, pack: `${id}.ts` })),
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

test("switch.set: the server's packs and the page's in one change set, and undo takes both back", async () => {
  const { rt, call, state, until, errors } = await boot();
  assert.equal(state("low"), "active");
  const out = await call(SET, { server: ["low"], page: ["map"], on: false });
  assert.ok(out.ok && out.change, "one change set");
  await until(() => state("low") === "off");
  assert.notEqual(state("high"), "active", "what stood on it stops");
  const read = rt.root.get<GraphRead>("graph.read");
  assert.deepEqual((await read.of(TYPE, { limit: 2 })).items.map((i) => i.fields.packs), [{ low: { off: true } }]);
  assert.deepEqual((await read.of(PAGE_TYPE, { limit: 2 })).items.map((i) => i.fields.packs), [{ map: { off: true } }], "the item page.set writes");

  const undo = await call("history.undo", { change: out.change! });
  assert.ok(undo.ok);
  await until(() => state("low") === "active" && state("high") === "active");
  assert.equal((await read.of(PAGE_TYPE, { limit: 2 })).items.length, 0, "the page item goes with it");
  assert.deepEqual(errors, []);
});

test("switch.set: on null puts a pack back as the template has it", async () => {
  const { call, state, until } = await boot();
  await call(SET, { server: ["low"], on: false });
  await until(() => state("low") === "off");
  await call(SET, { server: ["low"], on: null });
  await until(() => state("low") === "active");
});
