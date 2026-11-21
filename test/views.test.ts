import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionInvoke } from "../spec/action.ts";
import type { GraphRead } from "../spec/graph.ts";
import type { HereDeclare, HereRead, HereSet } from "../spec/here.ts";
import type { SlotArrange, SlotFill, SlotRead } from "../spec/slot.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader } from "../runtime/loader.ts";
import action from "../packs/action/index.ts";
import graph from "../packs/graph/index.ts";
import types from "../packs/types/index.ts";
import record from "../packs/record/index.ts";
import items from "../packs/items/index.ts";
import here from "../packs/here/index.ts";
import renderer from "../packs/renderer/index.ts";
import views from "../packs/views/index.ts";
import { SHOWN, shower } from "../packs/views/apply.ts";
import { byHash, search, sections, tabs, views as list, type Kind, type Row } from "../packs/views/pick.ts";

const KINDS: Kind[] = [
  { pack: "harness", name: "view", title: "Harness" },
  { pack: "map", name: "map", title: "Map" },
  { pack: "field", name: "field", title: "Field" },
  { pack: "docs", name: "view", title: "Packs" },
  { pack: "two", name: "a", title: "A" },
  { pack: "two", name: "b", title: "B" },
];
const view = (id: string, fields: Record<string, unknown>): Row => ({ id, type: "view", fields: { title: id, ...fields } as any });
const hubs: Record<string, { id: string; title: string }> = { i_b: { id: "i_hub", title: "Release" } };
const none = () => undefined;

test("each kind of center fill is a view; a pack with two is named pack/name; home is the configured kind, first", () => {
  const all = list(KINDS, [], none, { home: "map", pinned: ["field"] });
  assert.deepEqual(
    all.map((v) => v.id),
    ["map", "field", "two/a", "two/b", "harness", "docs"], "home, the pinned, then by title",
  );
  assert.equal(all[0]!.home, true);
  assert.equal(all[0]!.center, "map/map");
  assert.deepEqual(tabs(all).map((v) => v.id), ["map", "field"]);
});

test("a view item holds its center, settings and arrange; one whose center isn't loaded is left out", () => {
  const all = list(KINDS, [view("i_a", { center: "map/map", here: { "find.query": "in:i_hub" }, arrange: { "item/page": "left" } }), view("i_x", { center: "gone/x" })], none);
  const a = all.find((v) => v.id === "i_a")!;
  assert.deepEqual(a.here, { "find.query": "in:i_hub" });
  assert.deepEqual(a.arrange, { "item/page": "left" });
  assert.equal(a.kind, false);
  assert.ok(!all.some((v) => v.id === "i_x"));
});

test("the newest item tagged home is home, over the kind; pinned items are tabs", () => {
  const all = list(KINDS, [view("i_1", { center: "map/map", tags: "home" }), view("i_2", { center: "field/field", tags: "home pinned" }), view("i_3", { center: "map/map", tags: "pinned" })], none, { home: "map" });
  assert.equal(all[0]!.id, "i_2");
  assert.equal(all.filter((v) => v.home).length, 1, "one home");
  assert.deepEqual(tabs(all).map((v) => v.id), ["i_2", "i_3"]);
});

test("at most five tabs past home", () => {
  const rows = [1, 2, 3, 4, 5, 6, 7].map((n) => view(`i_${n}`, { center: "map/map", tags: "pinned" }));
  assert.equal(tabs(list(KINDS, rows, none)).length, 6);
});

test("sections by part_of, search over titles and sections", () => {
  const all = list(KINDS, [view("i_b", { center: "map/map", title: "Wave 1" }), view("i_c", { center: "map/map", title: "Loose" })], (id) => hubs[id]);
  const s = sections(all);
  assert.equal(s[0]!.title, "", "home, kinds and loose views first");
  assert.ok(s[0]!.views.some((v) => v.id === "i_c"));
  assert.deepEqual(s.find((x) => x.title === "Release")!.views.map((v) => v.id), ["i_b"]);
  assert.deepEqual(search(all, "release").map((v) => v.id), ["i_b"]);
  assert.deepEqual(search(all, "fie").map((v) => v.id), ["field"]);
});

test("a hash names a view by id, or a kind by its center fill", () => {
  const all = list(KINDS, [view("i_b", { center: "map/map" })], none);
  assert.equal(byHash(all, "#i_b")!.id, "i_b");
  assert.equal(byHash(all, "#map/map")!.id, "map");
  assert.equal(byHash(all, "#two/b")!.id, "two/b");
  assert.equal(byHash(all, ""), undefined);
});

const filler: Pack = {
  id: "item",
  inject: ["slot.fill", "here.declare"],
  apply(ctx) {
    const fill = ctx.get<SlotFill>("slot.fill");
    fill.fill({ slot: "right", name: "page", view: () => null });
    fill.fill({ slot: "center", name: "map", view: () => null });
    ctx.get<HereDeclare>("here.declare").declare({ key: "item.q", scope: "page" });
  },
};

test("showing a view sets here.view and its settings, lays its arrange; the next takes both back", async () => {
  const rt = new Runtime();
  rt.root.plugin(here);
  rt.root.plugin(renderer);
  rt.root.plugin(filler);
  await rt.settle();
  const read = rt.root.get<SlotRead>("slot.read");
  const h = rt.root.get<HereRead>("here.read");
  const set = rt.root.get<HereSet>("here.set");
  const declared: string[] = []; // the views pack declares views.view; here nobody does
  const s = shower(h, set, rt.root.get<SlotArrange>("slot.arrange"), (e) => declared.push(String(e)));
  const [a] = list([{ pack: "item", name: "map" }], [view("i_a", { center: "item/map", here: { "item.q": "in:x" }, arrange: { "item/page": "left" } })], none).filter((v) => v.id === "i_a");
  s.show(a!);
  assert.equal(h.get("here.view"), "item/map");
  assert.equal(h.get("item.q"), "in:x");
  assert.deepEqual(read.fills("left").map((f) => f.name), ["page"]);
  assert.deepEqual(read.fills("right"), []);
  const [kind] = list([{ pack: "item", name: "map" }], [], none);
  s.show(kind!);
  assert.equal(h.get("item.q"), undefined, "its settings cleared");
  assert.deepEqual(read.fills("right").map((f) => f.name), ["page"], "its arrange taken back");
  assert.ok(declared.some((e) => e.includes(SHOWN)), "views.view isn't declared here: reported, not thrown");
});

test("the flavour view: an agent makes a view with items.create", async () => {
  const rt = new Runtime();
  const modules: Record<string, Pack> = { graph, action, types, record, items, views };
  const loader = new Loader(rt, { base: "mem:/", import: async (url) => ({ default: modules[url.slice(5, -3)] }) });
  await loader.apply(Object.keys(modules).map((id) => ({ id, pack: `${id}.ts` })));
  const invoke = rt.root.get<ActionInvoke>("action.invoke");
  const out: any = await invoke.invoke({
    action: "items.create",
    input: { type: "view", title: "Wave 1", fields: { center: "map/map", here: { "find.query": "in:i_x" }, tags: "pinned" } },
    authority: { of: "agent", basis: "a test" },
    reason: "a view for the wave",
  } as any);
  const g = rt.root.get<GraphRead>("graph.read");
  const page = await g.of("view", { limit: 5 });
  assert.equal(page.items.length, 1, JSON.stringify(out));
  assert.equal(page.items[0]!.fields.center, "map/map");
});
