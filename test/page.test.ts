import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionInvoke } from "../spec/action.ts";
import type { GraphRead } from "../spec/graph.ts";
import type { LoaderEntry } from "../spec/loader.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import action from "../packs/action/index.ts";
import graph from "../packs/graph/index.ts";
import types from "../packs/types/index.ts";
import record from "../packs/record/index.ts";
import page from "../packs/page/index.ts";
import { merge, overlay, TYPE } from "../packs/page/overlay.ts";

const BASE: LoaderEntry[] = [
  { id: "renderer", pack: "r.ts", config: { mount: "#app" } },
  { id: "frame", pack: "f.ts" },
  { id: "tabs", pack: "t.ts" },
  { id: "map", pack: "m.ts" },
];

test("changes merge: on and off, config key by key, null clears, an empty change drops out", () => {
  let c = merge({}, { pack: "tabs", on: false });
  assert.deepEqual(c, { tabs: { off: true } });
  c = merge(c, { pack: "renderer", config: { arrange: { "item/page": "left" } } });
  c = merge(c, { pack: "tabs", on: null });
  assert.deepEqual(c, { renderer: { config: { arrange: { "item/page": "left" } } } }, "back as the template has it");
  assert.deepEqual(merge({}, { pack: "today", on: true }), { today: { off: false } }, "on is kept: the template may have it off");
  c = merge(c, { pack: "renderer", config: null });
  assert.deepEqual(c, {});
});

test("the overlay turns on what the template has off", () => {
  assert.equal(overlay([{ id: "today", pack: "t.ts", disabled: true }], { today: { off: false } })[0]!.disabled, false);
});

test("the overlay turns off, lays config over the template's, and moves; the template is untouched", () => {
  const out = overlay(BASE, { tabs: { off: true }, renderer: { config: { arrange: { "b/x": "off" } } }, map: { after: "" }, ghost: { off: true } });
  assert.deepEqual(out.map((e) => e.id), ["map", "renderer", "frame", "tabs"]);
  assert.equal(out.find((e) => e.id === "tabs")!.disabled, true);
  assert.deepEqual(out.find((e) => e.id === "renderer")!.config, { mount: "#app", arrange: { "b/x": "off" } });
  assert.deepEqual(BASE[0]!.config, { mount: "#app" });
  assert.deepEqual(overlay(BASE, { frame: { after: "map" } }).map((e) => e.id), ["renderer", "tabs", "map", "frame"]);
});

test("page.set writes one page item, and each call changes its packs as one change set", async () => {
  const rt = new Runtime();
  const modules: Record<string, Pack> = { "graph.ts": graph, "action.ts": action, "types.ts": types, "record.ts": record, "page.ts": page };
  const loader = new Loader(rt, { base: "mem:/", import: async (url) => ({ default: modules[url.slice(5)] }) });
  const tree: Entry[] = ["graph", "action", "types", "record", "page"].map((id) => ({ id, pack: `${id}.ts` }));
  await loader.apply(tree);
  const invoke = rt.root.get<ActionInvoke>("action.invoke");
  const by = { of: "human" as const, basis: "a test" };
  const a = await invoke.invoke({ action: "page.set", input: { pack: "tabs", on: false }, authority: by, reason: "hide the tabs" });
  const b = await invoke.invoke({ action: "page.set", input: { pack: "renderer", config: { arrange: { "item/page": "left" } } }, authority: by, reason: "item page left" });
  assert.ok(a.ok && b.ok);
  const items = (await rt.root.get<GraphRead>("graph.read").of(TYPE, { limit: 5 })).items;
  assert.equal(items.length, 1, "one item holds every change");
  assert.deepEqual(items[0]!.fields.packs, { tabs: { off: true }, renderer: { config: { arrange: { "item/page": "left" } } } });
});
