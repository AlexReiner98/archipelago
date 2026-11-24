/**
 * The lint pack: its functions as the checker calls them (a graph as data
 * in, the verdict and what was read out), then the pack in a runtime with
 * the checks pack: a rule's tests made by `lint.cover`, solved, and solved
 * again when what they read moves.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Json } from "../spec/common.ts";
import type { Item } from "../spec/graph.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader } from "../runtime/loader.ts";
import { solve, tracker, type Read, type Write } from "../packs/checks/checker.ts";
import checks from "../packs/checks/index.ts";
import lint, { FNS, finding } from "../packs/lint/index.ts";

const item = (id: string, type: string, fields: Record<string, Json> = {}): Item => ({ id, type, fields });

function graph(items: Item[], links: [string, string, string][]): Read {
  const byId = new Map(items.map((i) => [i.id, i]));
  return {
    get: async (ids) => ids.map((id) => byId.get(id)),
    links: async (id, kind, dir) => links.filter(([k, f, t]) => k === kind && (dir === "out" ? f : t) === id).map(([k, from, to]) => ({ id: `${k}:${from}:${to}`, from, to })),
  };
}

const fn = (name: string) => FNS.find((f) => f.name === name)!;

/** Judges `subject` with a lint function, through a tracked reader: the verdict and what it read. */
async function judge(name: string, params: Json, items: Item[], links: [string, string, string][] = [], today = "2026-11-24") {
  const t = tracker(graph(items, links), () => today);
  const [subject] = await t.reader.get([items[0]!.id]);
  const v = await fn(name).judge({ subject: subject!, subjects: [subject!], fn: name, params, read: t.reader, test: "t", version: "v" });
  return { ...v, reads: t.reads() };
}

test("lint.has: a value in the field; blank is none; only the statuses it names", async () => {
  assert.equal((await judge("lint.has", { field: "to_see" }, [item("a", "work", { to_see: "the view" })])).passed, true);
  const r = await judge("lint.has", { field: "to_see" }, [item("a", "work", { to_see: "  ", status: "todo" })]);
  assert.deepEqual(r.findings, [{ key: "field:to_see", field: "to_see", message: "No to_see." }]);
  assert.equal((await judge("lint.has", { field: "to_see", statuses: ["todo"] }, [item("a", "work", { status: "done" })])).passed, true);
  // With no statuses it reads the field alone: a change of status moves nothing.
  assert.deepEqual(r.reads.items, [["a", ["to_see"]]]);
});

test("lint.linked: at least min links, reading a page of only min, so one more moves nothing", async () => {
  const items = [item("a", "work"), item("h1", "work"), item("h2", "work")];
  const one = await judge("lint.linked", { link: "part_of" }, items, [["part_of", "a", "h1"]]);
  assert.equal(one.passed, true);
  assert.deepEqual(one.reads.links, [["a", "part_of", "out", 1, null]]);
  const none = await judge("lint.linked", { link: "part_of", min: 2 }, items, [["part_of", "a", "h1"]]);
  assert.deepEqual(none.findings, [{ key: "link:part_of:out", link: "part_of", dir: "out", measured: 1, limit: 2, message: "Only 1 part_of from it; 2 wanted." }]);
  assert.equal((await judge("lint.linked", { link: "waits_on", dir: "in" }, items)).findings.length, 1);
});

test("lint.overdue: days past due over the grace, by the day it reads", async () => {
  const items = [item("a", "work", { due: "2026-11-20", status: "doing" })];
  assert.equal((await judge("lint.overdue", { grace_days: 4 }, items)).passed, true);
  const late = await judge("lint.overdue", { grace_days: 2 }, items);
  assert.deepEqual(late.findings, [{ key: "field:due", field: "due", measured: 4, limit: 2, message: "4 days past due (2026-11-20)." }]);
  assert.equal(late.reads.today, true);
  assert.equal((await judge("lint.overdue", {}, [item("a", "work")])).passed, true);
  assert.equal(finding(late.findings[0]!), "field:due");
  assert.equal(finding({ message: "x" }), undefined);
});

test("lint as a checks domain: solved by the checker, its reads the stamp", async () => {
  const items = [item("a", "work", { status: "todo" }), item("r", "rule", { fn: "lint.linked", params: { link: "part_of" } }), item("t", "test")];
  const g = graph(items, [["checks", "t", "a"], ["applies", "t", "r"]]);
  const writes: Write[] = [];
  const judging = { judge: (c: any) => fn(c.fn).judge(c), finding };
  await solve(["t"], g, (_t, f) => (f?.startsWith("lint.") ? judging : undefined), async (w) => void writes.push(w));
  assert.deepEqual(writes.map((w) => w.fields.result), ["pending", "fail"]);
  assert.deepEqual(writes[1]!.fields.reads, { items: [["a", []]], links: [["a", "part_of", "out", 1, null]] });
});

// ---- The pack in a runtime ----

const BASES = ["graph", "action", "types", "work", "question", "record", "actor", "links", "items", "schema"];

test("the pack: lint.cover makes a rule's tests, the checker solves them, and again when what they read moves", async () => {
  const packs: Record<string, Pack> = {};
  for (const id of BASES) packs[id] = (await import(`../packs/${id}/index.ts`)).default;
  Object.assign(packs, { checks, lint, probe: { id: "probe", inject: ["action.invoke", "graph.read"], apply() {} } });
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => void errors.push(e);
  const loader = new Loader(rt, { base: "mem:/", import: async (u) => ({ default: packs[u.slice(5)]! }) });
  await loader.apply([...BASES, "checks", "lint", "probe"].map((id) => ({ id, pack: id })));
  await rt.settle();
  try {
    const ctx = loader.fiber("probe")!.ctx.intercept({ actor: { id: "person:owner", kind: "person" } });
    const invoke = ctx.get<any>("action.invoke");
    const g = ctx.get<any>("graph.read");
    const act = async (action: string, input: unknown) => {
      const o = await invoke.invoke({ action, input, authority: { of: "human", basis: "a test" }, reason: "a test" });
      if (!o.ok) throw new Error(`${o.refused.code}: ${o.refused.message}`);
      return o.output as any;
    };
    const make = async (type: string, title: string, fields: Record<string, unknown> = {}) => (await act("items.create", { type, title, fields })).id as string;
    const quiet = () => new Promise((r) => setTimeout(r, 60));
    const hub = await make("work", "Hub");
    const a = await make("work", "Placed");
    const b = await make("work", "Loose");
    await act("items.link", { type: "part_of", from: a, to: hub });
    const rule = await make("rule", "Work is part of something", { fn: "lint.linked", params: { link: "part_of", statuses: ["todo", "doing"] } });
    const out = await act("lint.cover", { rule, type: "work" });
    assert.equal(out.made.length, 3);
    assert.deepEqual((await act("lint.cover", { rule, type: "work" })).made, []);
    await quiet();
    const testOf = async (subject: string) => {
      const l = (await g.links(subject, { type: "checks", dir: "in" }, { limit: 5 })).items[0];
      return (await g.get([l.from]))[0];
    };
    assert.deepEqual([(await testOf(a)).fields.result, (await testOf(b)).fields.result, (await testOf(hub)).fields.result], ["pass", "fail", "fail"]);

    // Linking the loose one solves its test again; closing the hub passes it, as the rule checks open work only.
    await act("items.link", { type: "part_of", from: b, to: hub });
    await act("items.set", { id: hub, fields: { status: "done" } });
    await quiet();
    assert.deepEqual([(await testOf(b)).fields.result, (await testOf(hub)).fields.result], ["pass", "pass"]);

    // A decision on a finding holds while it is still found.
    await act("items.set", { id: hub, fields: { status: "todo" } });
    await quiet();
    const t = await testOf(hub);
    await act("checks.decide", { test: t.id, decision: "rejected" });
    await act("items.set", { id: hub, fields: { title: "Hub, renamed" } });
    await act("items.set", { id: hub, fields: { status: "doing" } });
    await quiet();
    const after = await testOf(hub);
    assert.deepEqual([after.fields.result, after.fields.decision, after.fields.decided_findings], ["fail", "rejected", ["link:part_of:out"]]);
    const [reading] = await act("checks.rejections", { rule });
    assert.deepEqual([reading.param, reading.rejected.length], ["min", 1]);
    await assert.rejects(act("lint.cover", { rule: hub, type: "work" }), /lint.not_a_rule/);
    assert.deepEqual(errors, []);
  } finally {
    await loader.apply([]);
  }
});
