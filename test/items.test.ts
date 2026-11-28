import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionInvoke } from "../spec/action.ts";
import type { GraphRead, Link } from "../spec/graph.ts";
import { Runtime, type Plugin } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import action from "../plugins/action/index.ts";
import actor from "../plugins/actor/index.ts";
import graph from "../plugins/graph/index.ts";
import history from "../plugins/history/index.ts";
import items from "../plugins/items/index.ts";
import links from "../plugins/links/index.ts";
import question from "../plugins/question/index.ts";
import record from "../plugins/record/index.ts";
import schema from "../plugins/schema/index.ts";
import types from "../plugins/types/index.ts";
import work from "../plugins/work/index.ts";
import { preview, twinWords } from "../plugins/items/view.ts";
import type { TypeInfo } from "../spec/types.ts";

const BASE = "mem:/plugins/";
const probe: Plugin = { id: "probe", inject: ["action.invoke", "graph.read"], apply() {} };
const modules: Record<string, Plugin> = { graph, action, types, work, question, record, actor, links, schema, history, items, probe };
const TREE: Entry[] = ["graph", "action", "types", "work", "question", "record", "actor", "links", "schema", "history", "items", "probe"].map((id) => ({ id, plugin: `${id}.ts` }));

async function setup() {
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length, -3)] }) });
  await loader.apply(TREE);
  await rt.settle();
  assert.deepEqual(errors, []);
  const ctx = () => loader.fiber("probe")!.ctx.intercept({ actor: { id: "person:owner", kind: "person" } });
  const invoke = (a: string, input: unknown) =>
    ctx().get<ActionInvoke>("action.invoke").invoke({ action: a, input: input as never, authority: { of: "human", basis: "test" }, reason: "test" });
  const ok = async (a: string, input: unknown) => {
    const r = await invoke(a, input);
    assert.ok(r.ok, JSON.stringify(r));
    return r as Extract<typeof r, { ok: true }>;
  };
  const read = () => ctx().get<GraphRead>("graph.read");
  const get = async (id: string) => (await read().get([id]))[0];
  const linksAt = async (id: string) => (await read().links(id, { dir: "both" }, { limit: 50 })).items as Link[];
  const make = async (type: string, title: string, fields?: Record<string, unknown>) => (await ok("items.create", { type, title, ...(fields ? { fields } : {}) })).output as unknown as { id: string };
  const link = async (type: string, from: string, to: string, fields?: Record<string, unknown>) => ((await ok("items.link", { type, from, to, ...(fields ? { fields } : {}) })).output as { id: string }).id;
  return { invoke, ok, get, linksAt, make, link, stop: () => loader.apply([]) };
}

const ends = (ls: Link[]) => ls.map((l) => `${l.type}:${l.from}>${l.to}`).sort();

test("items.merge: drop's links go to keep, none doubled or to itself; drop's fields fill what keep lacks; drop goes; one change set", async () => {
  const m = await setup();
  const hub = (await m.make("work", "Hub")).id;
  const other = (await m.make("work", "Other")).id;
  const keep = (await m.make("work", "Pat's notes", { priority: "high" })).id;
  const drop = (await m.make("work", "Pat notes", { note: "From the second thread.", priority: "low" })).id;
  await m.link("part_of", keep, hub);
  await m.link("part_of", drop, hub); // keep has this one: a duplicate
  await m.link("depends_on", drop, keep); // would join keep to itself
  const moved = await m.link("depends_on", other, drop, {});

  const r = await m.ok("items.merge", { keep, drop });
  const out = r.output as unknown as { moved: string[]; removed: { why: string }[]; took: string[]; left: string[] };
  assert.deepEqual(out.moved, [moved]);
  assert.deepEqual(out.removed.map((x) => x.why).sort(), ["duplicate", "self"]);
  assert.deepEqual(out.took, ["note"]);
  assert.equal(r.committed!.header.action, "items.merge");

  assert.equal(await m.get(drop), null);
  const k = (await m.get(keep))!;
  assert.deepEqual([k.fields.title, k.fields.priority, k.fields.note], ["Pat's notes", "high", "From the second thread."]);
  assert.deepEqual(ends(await m.linksAt(keep)), [`depends_on:${other}>${keep}`, `part_of:${keep}>${hub}`].sort());
  assert.deepEqual(await m.linksAt(drop), []);

  // history.undo of the one change set unmerges: drop back with its fields and links, keep as it was.
  await m.ok("history.undo", { change: r.change });
  const d = (await m.get(drop))!;
  assert.deepEqual([d.fields.title, d.fields.priority, d.fields.note], ["Pat notes", "low", "From the second thread."]);
  assert.equal((await m.get(keep))!.fields.note, undefined);
  assert.deepEqual(ends(await m.linksAt(drop)), [`depends_on:${drop}>${keep}`, `depends_on:${other}>${drop}`, `part_of:${drop}>${hub}`].sort());
  assert.deepEqual(ends(await m.linksAt(keep)), [`depends_on:${drop}>${keep}`, `part_of:${keep}>${hub}`].sort());
  await m.stop();
});

test("items.merge: the rule says whose value stays for a field both hold, field by field", async () => {
  const m = await setup();
  const keep = (await m.make("work", "Keep", { priority: "high", note: "keep's" })).id;
  const drop = (await m.make("work", "Drop", { priority: "low", note: "drop's" })).id;
  const r = await m.ok("items.merge", { keep, drop, rule: "drop", fields: { title: "keep" } });
  assert.deepEqual((r.output as { took: string[] }).took.sort(), ["note", "priority"]);
  const k = (await m.get(keep))!;
  assert.deepEqual([k.fields.title, k.fields.priority, k.fields.note], ["Keep", "low", "drop's"]);
  await m.stop();
});

test("items.merge refuses two types, unless told; a missing item; an item into itself; a link", async () => {
  const m = await setup();
  const w = (await m.make("work", "Which store")).id;
  const q = (await m.make("question", "Which store?")).id;
  const l = await m.link("about", w, q);
  const no = await m.invoke("items.merge", { keep: w, drop: q });
  assert.ok(!no.ok && no.refused.code === "items.merge_types", JSON.stringify(no));
  for (const [input, code] of [
    [{ keep: w, drop: "i_nothing" }, "items.missing"],
    [{ keep: "i_nothing", drop: w }, "items.missing"],
    [{ keep: w, drop: w }, "items.merge_self"],
    [{ keep: w, drop: l }, "items.not_an_item"],
  ] as const) {
    const r = await m.invoke("items.merge", input);
    assert.ok(!r.ok && r.refused.code === code, `${JSON.stringify(input)}: ${JSON.stringify(r)}`);
  }
  assert.ok(await m.get(q), "a refusal writes nothing");

  // Told: across types, the fields keep's type has no room for, or whose value doesn't fit it, are left.
  const r = await m.ok("items.merge", { keep: w, drop: q, across_types: true, rule: "drop" });
  const out = r.output as unknown as { left: string[]; removed: { why: string }[] };
  assert.ok(out.left.includes("status"), JSON.stringify(out)); // a question's status isn't a work's
  assert.deepEqual(out.removed.map((x) => x.why), ["self"]);
  assert.equal(await m.get(q), null);
  assert.equal((await m.get(w))!.fields.title, "Which store?");
  assert.equal((await m.get(w))!.fields.status, "todo");
  await m.stop();
});

test("the page's confirm: what stays, what goes, the links that move or go, and each field that differs, worked out without writing", () => {
  const t = { name: "work", base: "work", statuses: { open: ["todo", "doing"], closed: ["done", "dropped"] }, fields: { title: { kind: "text" }, status: { kind: "text" }, note: { kind: "text" } } } as unknown as TypeInfo;
  const keep = { id: "k", type: "work", fields: { title: "Pat's notes", status: "todo" } };
  const drop = { id: "d", type: "work", fields: { title: "Pat notes", status: "todo", note: "more" } };
  const w = (id: string, type: string, from: string, to: string) => ({ id, type, from, to, fields: {} });
  const p = preview(keep, drop, t, [w("l0", "part_of", "k", "h")], [w("l1", "part_of", "d", "h"), w("l2", "depends_on", "x", "d"), w("l3", "depends_on", "d", "k")]);
  assert.deepEqual(p.moved, ["l2"]);
  assert.deepEqual(p.removed, [{ id: "l1", why: "duplicate" }, { id: "l3", why: "self" }]);
  assert.deepEqual(p.took, ["note"]);
  assert.deepEqual(p.differ, [{ field: "title", keep: "Pat's notes", drop: "Pat notes" }]);
  assert.equal(twinWords("Pat's notes, 2026"), "notes");
});
