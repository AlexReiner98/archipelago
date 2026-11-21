import assert from "node:assert/strict";
import { test } from "node:test";
import type { HereSet } from "../spec/here.ts";
import type { SlotDeclare, SlotFill, SlotRead } from "../spec/slot.ts";
import { REGIONS } from "../spec/slot.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import here from "../packs/here/index.ts";
import renderer from "../packs/renderer/index.ts";

const View = () => null;
const filler = (id: string, fills: { slot: string; name: string; when?: Record<string, any> }[]): Pack => ({
  id,
  inject: ["slot.fill"],
  apply(ctx) {
    for (const f of fills) ctx.get<SlotFill>("slot.fill").fill({ ...f, view: View });
  },
});
const names = (read: SlotRead, slot: string) => read.fills(slot).map((f) => `${f.pack}/${f.name}`);

async function page(arrange?: Record<string, string>) {
  const rt = new Runtime();
  rt.root.plugin(here);
  rt.root.plugin(renderer, { arrange });
  rt.root.plugin(filler("a", [{ slot: "left", name: "tree", when: { "here.view": "a/run" } }, { slot: "center", name: "run" }, { slot: "right", name: "page", when: { "here.item": true } }]));
  rt.root.plugin(filler("b", [{ slot: "left", name: "today" }, { slot: "center", name: "map" }]));
  await rt.settle();
  return { rt, read: rt.root.get<SlotRead>("slot.read"), set: rt.root.get<HereSet>("here.set") };
}

test("the six regions are there from the start, and no pack may declare one", async () => {
  const { rt, read } = await page();
  for (const r of REGIONS) assert.ok(read.slots().some((s) => s.name === r && s.merge === "many"), r);
  assert.throws(() => rt.root.get<SlotDeclare>("slot.declare").declare({ name: "left", merge: "many" }));
});

test("a fill with when shows only while here matches", async () => {
  const { read, set } = await page();
  assert.deepEqual(names(read, "left"), ["b/today"]);
  assert.deepEqual(names(read, "right"), []);
  let heard = 0;
  read.watch("left", () => heard++);
  set.set("here.view", "a/run");
  assert.deepEqual(names(read, "left"), ["a/tree", "b/today"], "in config order");
  assert.ok(heard > 0, "the region heard the change");
  set.set("here.item", "i_1");
  assert.deepEqual(names(read, "right"), ["a/page"]);
});

test("arrange moves a fill to another region, or hides it", async () => {
  const { read } = await page({ "b/today": "right", "a/run": "off" });
  assert.deepEqual(names(read, "left"), []);
  assert.deepEqual(names(read, "right"), ["b/today"]);
  assert.deepEqual(names(read, "center"), ["b/map"]);
});
