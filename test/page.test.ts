import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionInvoke } from "../spec/action.ts";
import type { GraphCommit, GraphRead } from "../spec/graph.ts";
import type { LoaderEntry } from "../spec/loader.ts";
import { Runtime, type Plugin } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import action from "../plugins/action/index.ts";
import graph from "../plugins/graph/index.ts";
import types from "../plugins/types/index.ts";
import record from "../plugins/record/index.ts";
import page from "../plugins/page/index.ts";
import { merge, overlay, TYPE } from "../plugins/page/overlay.ts";

const BASE: LoaderEntry[] = [
  { id: "renderer", plugin: "r.ts", config: { mount: "#app" } },
  { id: "frame", plugin: "f.ts" },
  { id: "tabs", plugin: "t.ts" },
  { id: "map", plugin: "m.ts" },
];

test("changes merge: on and off, config key by key, null clears, an empty change drops out", () => {
  let c = merge({}, { plugin: "tabs", on: false });
  assert.deepEqual(c, { tabs: { off: true } });
  c = merge(c, { plugin: "renderer", config: { arrange: { "item/page": "left" } } });
  c = merge(c, { plugin: "tabs", on: null });
  assert.deepEqual(c, { renderer: { config: { arrange: { "item/page": "left" } } } }, "back as the template has it");
  assert.deepEqual(merge({}, { plugin: "today", on: true }), { today: { off: false } }, "on is kept: the template may have it off");
  c = merge(c, { plugin: "renderer", config: null });
  assert.deepEqual(c, {});
});

test("the overlay turns on what the template has off", () => {
  assert.equal(overlay([{ id: "today", plugin: "t.ts", disabled: true }], { today: { off: false } })[0]!.disabled, false);
});

test("the overlay turns off, lays config over the template's, and moves; the template is untouched", () => {
  const out = overlay(BASE, { tabs: { off: true }, renderer: { config: { arrange: { "b/x": "off" } } }, map: { after: "" }, ghost: { off: true } });
  assert.deepEqual(out.map((e) => e.id), ["map", "renderer", "frame", "tabs"]);
  assert.equal(out.find((e) => e.id === "tabs")!.disabled, true);
  assert.deepEqual(out.find((e) => e.id === "renderer")!.config, { mount: "#app", arrange: { "b/x": "off" } });
  assert.deepEqual(BASE[0]!.config, { mount: "#app" });
  assert.deepEqual(overlay(BASE, { frame: { after: "map" } }).map((e) => e.id), ["renderer", "tabs", "map", "frame"]);
});

test("page.set writes one page item, and each call changes its plugins as one change set", async () => {
  const rt = new Runtime();
  const modules: Record<string, Plugin> = { "graph.ts": graph, "action.ts": action, "types.ts": types, "record.ts": record, "page.ts": page };
  const loader = new Loader(rt, { base: "mem:/", import: async (url) => ({ default: modules[url.slice(5)] }) });
  const tree: Entry[] = ["graph", "action", "types", "record", "page"].map((id) => ({ id, plugin: `${id}.ts` }));
  await loader.apply(tree);
  const invoke = rt.root.get<ActionInvoke>("action.invoke");
  const by = { of: "human" as const, basis: "a test" };
  const a = await invoke.invoke({ action: "page.set", input: { plugin: "tabs", on: false }, authority: by, reason: "hide the tabs" });
  const b = await invoke.invoke({ action: "page.set", input: { plugin: "renderer", config: { arrange: { "item/page": "left" } } }, authority: by, reason: "item page left" });
  assert.ok(a.ok && b.ok);
  const items = (await rt.root.get<GraphRead>("graph.read").of(TYPE, { limit: 5 })).items;
  assert.equal(items.length, 1, "one item holds every change");
  assert.deepEqual(items[0]!.fields.plugins, { tabs: { off: true }, renderer: { config: { arrange: { "item/page": "left" } } } });
});

test("a page item written before spec edition 11 holds its changes as packs: read, and moved to plugins on the next change", async () => {
  const rt = new Runtime();
  const modules: Record<string, Plugin> = { "graph.ts": graph, "action.ts": action, "types.ts": types, "record.ts": record, "page.ts": page };
  const loader = new Loader(rt, { base: "mem:/", import: async (url) => ({ default: modules[url.slice(5)] }) });
  await loader.apply(["graph", "action", "types", "record", "page"].map((id) => ({ id, plugin: `${id}.ts` })));
  const header = { actor: { id: "person:me", kind: "person" as const }, authority: { of: "human" as const }, plugin: { id: "test" }, action: "test", reason: "as edition 10 wrote it", time: "2026-11-20T00:00:00.000Z" };
  await rt.root.get<GraphCommit>("graph.commit").commit({ header, facts: [["+", "p1", "type", TYPE], ["+", "p1", "title", "The page's packs"], ["+", "p1", "packs", { tabs: { off: true } }]] });
  const ok = await rt.root.get<ActionInvoke>("action.invoke").invoke({ action: "page.set", input: { plugin: "map", on: false }, authority: { of: "human", basis: "a test" }, reason: "hide the map" });
  assert.ok(ok.ok);
  const [item] = (await rt.root.get<GraphRead>("graph.read").of(TYPE, { limit: 5 })).items;
  assert.deepEqual(item!.fields.plugins, { tabs: { off: true }, map: { off: true } }, "the old changes are kept");
  assert.equal(item!.fields.packs, undefined, "the old field is gone");
  assert.equal(item!.fields.title, "The page's plugins");
});
