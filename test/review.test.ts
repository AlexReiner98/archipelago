/**
 * Two apps on one map: a reciprocal frame kept as items (the reciprocal
 * plugin's server side), solved into a record about it, and the review
 * plugin raising and deciding issues on its beams from that record. Neither
 * plugin names the other: review reads a shape of record.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionInvoke } from "../spec/action.ts";
import type { GraphRead } from "../spec/graph.ts";
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
import reciprocal from "../plugins/reciprocal/map.ts";
import review from "../plugins/review/index.ts";

const probe: Plugin = { id: "probe", inject: ["action.invoke", "graph.read"], apply() {} };

async function map() {
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const modules: Record<string, Plugin> = { graph, action, types, work, question, record, actor, links, items, schema, history, reciprocal, review, probe };
  const BASE = "mem:/plugins/";
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length)] }) });
  const tree: Entry[] = Object.keys(modules).map((id) => ({ id, plugin: id }));
  await loader.apply(tree);
  await rt.settle();
  const ctx = loader.fiber("probe")!.ctx.intercept({ actor: { id: "e_agent", kind: "agent" }, run: "r1" });
  const invoke = ctx.get<ActionInvoke>("action.invoke");
  const read = ctx.get<GraphRead>("graph.read");
  const call = (name: string, input: unknown) => invoke.invoke<any>({ action: name, input: input as never, authority: { of: "agent", basis: "test" }, reason: "test" });
  const ok = async (name: string, input: unknown) => {
    const out = await call(name, input);
    if (!out.ok) assert.fail(`${name} refused: ${out.refused.message}`);
    return out as { ok: true; output: any; change?: string };
  };
  const item = async (id: string) => (await read.get([id]))[0]!;
  return { call, ok, item, read, errors, done: () => loader.apply([]) };
}

test("a frame is made as items: the frame, and a beam part of it for each edge of its mesh", async () => {
  const m = await map();
  const { output } = await ok(m, "reciprocal.create", { title: "Pavilion roof", mesh: "dome", detail: 2, dials: { engage: 0.2 }, diameters: { 3: 12 } });
  const frame = await m.item(output.frame);
  assert.equal(frame.type, "frame");
  assert.equal(frame.fields.status, "current");
  assert.deepEqual(frame.fields.dials, { engage: 0.2 });
  assert.equal(output.beams.length, 65);
  const parts = await m.read.links(output.frame, { type: "part_of", dir: "in" }, { limit: 500 });
  assert.equal(parts.items.length, 65);
  const b3 = await m.item(output.beams[3]);
  assert.equal(b3.type, "beam");
  assert.equal(b3.fields.index, 3);
  assert.equal(b3.fields.diameter, 12);
  assert.equal((await m.item(output.beams[4])).fields.diameter, undefined);
  assert.deepEqual(m.errors, []);
  await m.done();
});

const ok = (m: Awaited<ReturnType<typeof map>>, name: string, input: unknown) => m.ok(name, input);

test("dials and diameters are choices on the map: set through actions, refused out of range, and undone", async () => {
  const m = await map();
  const { output } = await ok(m, "reciprocal.create", { title: "F", mesh: "fan", detail: 2 });
  const set = await ok(m, "reciprocal.dial", { frame: output.frame, dials: { diameter: 12, sweep: 0.5 } });
  // sweep 0.5 is where it starts, so only diameter is kept.
  assert.deepEqual((await m.item(output.frame)).fields.dials, { diameter: 12 });
  const fixed = await m.call("reciprocal.dial", { frame: output.frame, dials: { mesh: 1 } });
  assert.equal(fixed.ok, false);
  assert.equal(fixed.refused.code, "reciprocal.dial");
  assert.match(fixed.refused.message, /fixed when it is made/);
  const far = await m.call("reciprocal.dial", { frame: output.frame, dials: { diameter: 400 } });
  assert.equal(far.ok, false);
  await ok(m, "history.undo", { change: set.change });
  assert.deepEqual((await m.item(output.frame)).fields.dials, {});
  await ok(m, "reciprocal.diameter", { beams: output.beams.slice(0, 2), diameter: 20 });
  assert.equal((await m.item(output.beams[1])).fields.diameter, 20);
  await ok(m, "reciprocal.diameter", { beams: output.beams.slice(0, 1), diameter: null });
  assert.equal((await m.item(output.beams[0])).fields.diameter, undefined);
  await m.done();
});

test("a solve is one record about the frame, each beam's worst gap by its id; the next supersedes it", async () => {
  const m = await map();
  const { output } = await ok(m, "reciprocal.create", { title: "Roof", mesh: "dome", detail: 2 });
  const first = (await ok(m, "reciprocal.solve", { frame: output.frame })).output;
  assert.equal(first.settled, true);
  assert.ok(first.worst < 0.05);
  const rec = await m.item(first.recorded);
  assert.equal(rec.type, "record");
  assert.equal(rec.fields.kind, "solve");
  assert.equal(Object.keys((rec.fields.value as any).items).length, 65);
  assert.ok(output.beams.every((b: string) => typeof (rec.fields.value as any).items[b] === "number"));
  // The same choices solve the same: nothing new is written.
  const again = await ok(m, "reciprocal.solve", { frame: output.frame });
  assert.equal(again.output.recorded, first.recorded);
  assert.equal(again.change, undefined);
  await ok(m, "reciprocal.dial", { frame: output.frame, dials: { diameter: 40 } });
  const second = (await ok(m, "reciprocal.solve", { frame: output.frame })).output;
  assert.ok(second.worst > 0.05);
  assert.deepEqual(second.superseded, [first.recorded]);
  assert.equal((await m.item(first.recorded)).fields.status, "superseded");
  await m.done();
});

test("a check raises an issue on each beam over the limit, once, and decides them when a later solve is within it", async () => {
  const m = await map();
  const { output } = await ok(m, "reciprocal.create", { title: "Roof", mesh: "dome", detail: 2, dials: { diameter: 40 } });
  const bad = (await ok(m, "reciprocal.solve", { frame: output.frame })).output;
  const over = Object.entries(bad.items as Record<string, number>).filter(([, w]) => w > 0.05).map(([id]) => id);
  assert.ok(over.length > 5);
  const checked = (await ok(m, "review.check", { record: bad.recorded })).output;
  assert.equal(checked.raised.length, over.length);
  const q = await m.item(checked.raised[0]);
  assert.equal(q.type, "question");
  assert.equal(q.fields.kind, "review");
  assert.equal(q.fields.status, "open");
  const bears = await m.read.links(q.id, { type: "bears_on", dir: "in" }, { limit: 10 });
  assert.equal(bears.items[0]!.from, bad.recorded);
  // Checking again raises nothing new.
  assert.deepEqual((await ok(m, "review.check", { record: bad.recorded })).output.raised, []);
  // The frame's issues, read through it: its beams are its parts.
  const open = (await ok(m, "review.of", { items: [output.frame] })).output.issues;
  assert.equal(open.length, over.length);
  assert.ok(open.every((i: any) => i.measured && over.includes(i.about[0])));

  // A hand-raised issue on a beam that will pass stays open: no check decides it.
  const fine = output.beams.find((b: string) => !over.includes(b));
  const hand = (await ok(m, "review.raise", { title: "Check the timber grade", about: [fine] })).output.issue;

  // The fix: back to the starting diameter; solve and check again.
  await ok(m, "reciprocal.dial", { frame: output.frame, dials: { diameter: null } });
  const good = (await ok(m, "reciprocal.solve", { frame: output.frame })).output;
  const after = (await ok(m, "review.check", { record: good.recorded })).output;
  assert.equal(after.decided.length, over.length);
  assert.equal(after.raised.length, 0);
  const d = await m.item(checked.raised[0]);
  assert.equal(d.fields.status, "decided");
  assert.match(String(d.fields.outcome), /^Within 5\.0%/);
  assert.equal((await m.item(hand)).fields.status, "open");
  assert.deepEqual((await ok(m, "review.of", { items: [output.frame] })).output.issues.map((i: any) => i.id), [hand]);
  await m.done();
});

test("a check refuses a record that measures nothing, and review.raise an item that isn't there", async () => {
  const m = await map();
  const r = (await ok(m, "items.create", { type: "record", title: "A note" })).output;
  const no = await m.call("review.check", { record: r.id ?? r });
  assert.equal(no.ok, false);
  assert.equal(no.refused.code, "review.not_measured");
  const gone = await m.call("review.raise", { title: "x", about: ["i_nothere"] });
  assert.equal(gone.ok, false);
  assert.equal(gone.refused.code, "review.missing");
  await m.done();
});
