import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionInvoke } from "../spec/action.ts";
import type { GraphRead } from "../spec/graph.ts";
import type { LinkInfo, TypeInfo, TypesAcyclic, TypesDefine, TypesMark, TypesRead } from "../spec/types.ts";
import { Runtime, type Plugin } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import action from "../plugins/action/index.ts";
import actor from "../plugins/actor/index.ts";
import graph from "../plugins/graph/index.ts";
import items from "../plugins/items/index.ts";
import links from "../plugins/links/index.ts";
import question from "../plugins/question/index.ts";
import record from "../plugins/record/index.ts";
import types from "../plugins/types/index.ts";
import work from "../plugins/work/index.ts";

const BASE = "mem:/plugins/";
const probe: Plugin = { id: "probe", inject: ["types.define", "types.read", "types.mark", "types.acyclic", "action.invoke", "graph.read"], apply() {} };
const modules: Record<string, Plugin> = { graph, action, types, work, question, record, actor, links, items, probe };

const TREE: Entry[] = ["graph", "action", "types", "work", "question", "record", "actor", "links", "items", "probe"].map((id) => ({ id, plugin: `${id}.ts` }));

async function setup(tree = TREE) {
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length, -3)] }) });
  await loader.apply(tree);
  await rt.settle();
  const ctx = () => loader.fiber("probe")!.ctx.intercept({ actor: { id: "person:owner", kind: "person" } });
  const p = {
    define: () => ctx().get<TypesDefine>("types.define"),
    read: () => ctx().get<TypesRead>("types.read"),
    mark: () => ctx().get<TypesMark>("types.mark"),
    acyclic: () => ctx().get<TypesAcyclic>("types.acyclic"),
    invoke: (a: string, input: unknown) =>
      ctx().get<ActionInvoke>("action.invoke").invoke({ action: a, input: input as never, authority: { of: "human", basis: "test" }, reason: "test" }),
    get: async (id: string) => (await ctx().get<GraphRead>("graph.read").get([id]))[0],
  };
  return { rt, loader, errors, p };
}

test("the four bases and five links are defined, each with its statuses and the common fields", async () => {
  const { errors, p } = await setup();
  assert.deepEqual(errors, []);
  const { types: ts, links: ls } = p.read().all();
  assert.deepEqual(ts.map((t) => t.name), ["work", "question", "record", "actor"]);
  assert.deepEqual(ls.map((l) => l.name), ["part_of", "depends_on", "waits_on", "bears_on", "about"]);
  const w = p.read().get("work") as TypeInfo;
  assert.deepEqual(w.statuses, { open: ["todo", "doing"], closed: ["done", "dropped"] });
  assert.ok(w.fields.title && w.fields.note && w.fields.status && w.fields.priority);
  assert.equal(w.plugin, "work");
  assert.deepEqual((p.read().get("waits_on") as LinkInfo).to, ["actor"]);
});

test("each base is drawn in the shape its plugin names; one none names takes the first shape left", async () => {
  const { loader, rt, p } = await setup();
  assert.deepEqual(p.mark().marks(), { work: "square", question: "diamond", record: "circle", actor: "triangle" });
  let heard = 0;
  p.mark().watch(() => heard++);
  // A base none names: the first shape no base holds.
  const d = p.define();
  d.base({ name: "place", statuses: { open: ["here"], closed: [] }, fields: {} });
  assert.equal(p.mark().marks().place, "pentagon");
  // Named, it takes its own; a shape another base holds, or a second name, is refused.
  const drop = p.mark().mark("place", "hexagon");
  assert.equal(p.mark().marks().place, "hexagon");
  assert.ok(heard >= 2);
  assert.throws(() => p.mark().mark("note", "square"), /work is drawn as a square/);
  assert.throws(() => p.mark().mark("place", "pentagon"), /place is drawn as a hexagon/);
  assert.throws(() => p.mark().mark("other", "star" as never), /not a mark shape/);
  await drop();
  assert.equal(p.mark().marks().place, "pentagon");
  // A base's plugin unloading takes its shape back: the shape is free for the next base none names.
  await loader.edit((t) => (t.find((e) => e.id === "work")!.disabled = true, t));
  await rt.settle();
  assert.equal(p.mark().marks().work, undefined);
  assert.equal(p.mark().marks().place, "square");
});

test("a flavour adds fields to its base and starts as a trial; it can't redefine a field or bring statuses", async () => {
  const { p } = await setup();
  const d = p.define();
  d.flavour({ name: "bug", base: "work", fields: { repro: { kind: "text" } } });
  const bug = p.read().get("bug") as TypeInfo;
  assert.equal(bug.base, "work");
  assert.equal(bug.trial, true);
  assert.deepEqual(bug.statuses, (p.read().get("work") as TypeInfo).statuses);
  assert.ok(bug.fields.repro && bug.fields.priority);

  assert.throws(() => d.flavour({ name: "x", base: "nothing", fields: {} }), /isn't defined/);
  assert.throws(() => d.flavour({ name: "y", base: "work", fields: { priority: { kind: "text" } } }), /never redefines/);
  assert.throws(() => d.flavour({ name: "z", base: "work", fields: {}, statuses: { open: ["a"], closed: [] } } as never), /never statuses/);
  assert.throws(() => d.flavour({ name: "t", base: "work", fields: { title: { kind: "text" } } }), /every base has title/);
  assert.throws(() => d.base({ name: "work", statuses: { open: ["a"], closed: [] }, fields: {} }), /already defined by work/);
});

test("a base's plugin unloading takes its type back, and its flavours with it until it returns", async () => {
  const { loader, rt, p } = await setup();
  p.define().flavour({ name: "bug", base: "work", fields: {} });
  await loader.edit((t) => (t.find((e) => e.id === "work")!.disabled = true, t));
  await rt.settle();
  assert.equal(p.read().get("work"), undefined);
  assert.equal(p.read().get("bug"), undefined);
  assert.ok(!p.read().all().types.some((t) => t.name === "work" || t.name === "bug"));
  await loader.edit((t) => (t.find((e) => e.id === "work")!.disabled = false, t));
  await rt.settle();
  assert.equal((p.read().get("bug") as TypeInfo).base, "work");
});

test("items.create makes an item at its base's first open status, part_of linked in the same change", async () => {
  const { p } = await setup();
  const hub = await p.invoke("items.create", { type: "work", title: "Track 3" });
  assert.ok(hub.ok);
  const hubId = (hub.ok && (hub.output as { id: string }).id) as string;
  assert.equal((await p.get(hubId))!.fields.status, "todo");

  const step = await p.invoke("items.create", { type: "work", title: "Base types", fields: { priority: "high" }, part_of: hubId });
  assert.ok(step.ok && step.committed);
  if (!step.ok) return;
  const facts = step.committed!.facts;
  assert.equal(step.committed!.header.action, "items.create");
  assert.equal(step.committed!.header.plugin.id, "items");
  assert.ok(facts.some(([, , f, v]) => f === "type" && v === "part_of"));
  assert.ok(facts.some(([, , f, v]) => f === "to" && v === hubId));
});

test("items.set changes fields with retractions, and refuses what the base doesn't allow", async () => {
  const { p } = await setup();
  const made = await p.invoke("items.create", { type: "question", title: "Which store?" });
  const id = (made.ok && (made.output as { id: string }).id) as string;
  const set = await p.invoke("items.set", { id, fields: { status: "decided", outcome: "SQLite" } });
  assert.ok(set.ok);
  if (set.ok) assert.deepEqual(set.committed!.facts.slice(0, 2), [["-", id, "status", "open"], ["+", id, "status", "decided"]]);
  assert.equal((await p.get(id))!.fields.outcome, "SQLite");

  const cleared = await p.invoke("items.set", { id, fields: { outcome: null } });
  assert.ok(cleared.ok);
  assert.equal((await p.get(id))!.fields.outcome, undefined);

  const bad = [
    [{ status: "done" }, "items.status"],
    [{ priority: "high" }, "items.field_unknown"],
    [{ title: "" }, "items.title"],
    [{ decided_on: "not a date" }, "items.field_kind"],
  ] as const;
  for (const [fields, code] of bad) {
    const r = await p.invoke("items.set", { id, fields });
    assert.ok(!r.ok && r.refused.code === code, `${JSON.stringify(fields)} → ${code}`);
  }
  const unknown = await p.invoke("items.create", { type: "epic", title: "x" });
  assert.ok(!unknown.ok && unknown.refused.code === "items.type_unknown" && /work, question, record, actor/.test(unknown.refused.message));
});

test("items.link checks the ends' bases; items.unlink takes the link away whole", async () => {
  const { p } = await setup();
  const mk = async (type: string, title: string) => {
    const r = await p.invoke("items.create", { type, title });
    return (r.ok && (r.output as { id: string }).id) as string;
  };
  const task = await mk("work", "Ship it");
  const owner = await mk("actor", "Owner");
  const q = await mk("question", "Ready?");

  const waits = await p.invoke("items.link", { type: "waits_on", from: task, to: owner, fields: { for: "a look" } });
  assert.ok(waits.ok);
  const wrong = await p.invoke("items.link", { type: "waits_on", from: task, to: q });
  assert.ok(!wrong.ok && wrong.refused.code === "items.link_end");
  const bears = await p.invoke("items.link", { type: "bears_on", from: task, to: q });
  assert.ok(bears.ok);
  const self = await p.invoke("items.link", { type: "about", from: task, to: task });
  assert.ok(!self.ok && self.refused.code === "items.link_self");

  const linkId = (waits.ok && (waits.output as { id: string }).id) as string;
  assert.equal((await p.get(linkId))!.fields.for, "a look");
  const gone = await p.invoke("items.unlink", { id: linkId });
  assert.ok(gone.ok);
  assert.equal(await p.get(linkId), null);
  const notLink = await p.invoke("items.unlink", { id: task });
  assert.ok(!notLink.ok && notLink.refused.code === "items.not_a_link");
});

test("a kind of link is held acyclic while any plugin holds it", async () => {
  const { p } = await setup();
  let heard = 0;
  p.acyclic().watch(() => heard++);
  assert.deepEqual(p.acyclic().held(), []);
  const one = p.acyclic().hold("depends_on");
  const two = p.acyclic().hold("depends_on");
  p.acyclic().hold("needs");
  assert.deepEqual(p.acyclic().held(), ["depends_on", "needs"]);
  await one();
  assert.deepEqual(p.acyclic().held(), ["depends_on", "needs"]);
  await two();
  assert.deepEqual(p.acyclic().held(), ["needs"]);
  assert.equal(heard, 5);
  assert.throws(() => p.acyclic().hold(""), /Name the kind of link/);
});
