/**
 * The checks pack: its checker and rejections reading apart from the
 * runtime (a graph as plain data in, the writes it makes out), then the pack
 * in a runtime with the map's packs in memory and a stand-in domain whose
 * judge compares a subject's `thickness` (by its `rev`) with a rule's limit.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Json } from "../spec/common.ts";
import type { Item } from "../spec/graph.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader } from "../runtime/loader.ts";
import { order, seeds, solve, stamp, type Judging, type Read, type Write } from "../packs/checks/checker.ts";
import { decidedOf, read as reading, type Decided, type RuleLimit } from "../packs/checks/rejections.ts";
import checks, { type CheckDomain, type ChecksDomain } from "../packs/checks/index.ts";

/** A graph as data: items by id, and links as [type, from, to]. */
function graph(items: Item[], links: [string, string, string][]): Read & { items: Map<string, Item> } {
  const byId = new Map(items.map((i) => [i.id, i]));
  return {
    items: byId,
    get: async (ids) => ids.map((id) => byId.get(id)),
    links: async (id, kind, dir) =>
      links.filter(([k, f, t]) => k === kind && (dir === "out" ? f : t) === id).map(([k, from, to]) => ({ id: `${k}:${from}:${to}`, from, to })),
  };
}

const item = (id: string, type: string, fields: Record<string, Json> = {}): Item => ({ id, type, fields });

/** A judge over `rev`s: passes when the subject's thickness is at least the rule's min. */
function judging(thickness: Record<string, number>, calls: string[] = []): Judging {
  return {
    stamp: "rev",
    async judge({ subject, other, fn, params }) {
      const rev = subject.fields.rev as string;
      calls.push(`${rev}${other ? `|${other.fields.rev}` : ""}:${fn}`);
      const t = thickness[rev];
      if (t === undefined) throw new Error(`no subject ${rev}`);
      const min = (params as { min: number }).min;
      return { passed: t >= min, findings: t >= min ? [] : [{ measured: t, limit: min }] };
    },
  };
}

test("a stamp is the same for the same inputs, whatever their order, and keeps its bytes", () => {
  // Pinned: these are the stamps a one-part and a two-part test had before the pack was general.
  assert.equal(stamp({ fn: "thin_wall", params: { min_thickness: 2 }, field: "hash", value: "h1", needs: [] }), "bcb1287e5079a677");
  assert.equal(stamp({ fn: "thin_wall", params: { min_thickness: 2 }, field: "hash", value: "h1", needs: [["t_b", "v1", "pass"], ["t_a", "v0", "fail"]] }), "9b838258c6385a0e");
  assert.equal(stamp({ fn: "clearance", params: { min_gap: 0.05 }, field: "hash", value: "block", other: "pin1", needs: [] }), "969566fd97ee8025");
  assert.equal(stamp({ fn: "f", params: { a: 1, b: 2 }, field: "rev", value: "r", needs: [] }), stamp({ fn: "f", params: { b: 2, a: 1 }, field: "rev", value: "r", needs: [] }));
  assert.notEqual(stamp({ fn: "f", params: { a: 1 }, field: "rev", value: "r", needs: [] }), stamp({ fn: "f", params: { a: 2 }, field: "rev", value: "r", needs: [] }));
});

test("order puts each test after the tests it needs, and only what is downstream", async () => {
  const g = graph([], [["needs", "b", "a"], ["needs", "c", "b"], ["needs", "d", "a"], ["needs", "e", "x"]]);
  const o = await order(["a"], g);
  assert.deepEqual(new Set(o), new Set(["a", "b", "c", "d"]));
  assert.ok(o.indexOf("a") < o.indexOf("b") && o.indexOf("b") < o.indexOf("c") && o.indexOf("a") < o.indexOf("d"));
});

test("solve: pending at the new version, then the result; blocked behind a failure; a held stamp is left", async () => {
  const g = graph(
    [
      item("s", "part", { rev: "r1" }),
      item("walls", "rule", { fn: "min", params: { min: 2 } }),
      item("t1", "test"),
      item("t2", "test"),
    ],
    [["checks", "t1", "s"], ["applies", "t1", "walls"], ["checks", "t2", "s"], ["applies", "t2", "walls"], ["needs", "t2", "t1"]],
  );
  const writes: Write[] = [];
  const apply = async (w: Write) => {
    writes.push(w);
    const t = g.items.get(w.test)!;
    g.items.set(w.test, { ...t, fields: { ...t.fields, ...w.fields } });
  };
  const domains = (type: string) => (type === "part" ? judging({ r1: 1, r2: 3 }) : undefined);
  await solve(["t1"], g, domains, apply);
  assert.deepEqual(writes.map((w) => [w.test, w.fields.result]), [["t1", "pending"], ["t1", "fail"], ["t2", "pending"], ["t2", "blocked"]]);
  assert.deepEqual(g.items.get("t1")!.fields.findings, [{ measured: 1, limit: 2 }]);

  // Nothing moved: nothing is written.
  writes.length = 0;
  await solve(["t1", "t2"], g, domains, apply);
  assert.equal(writes.length, 0);

  // A decision is cleared when the version moves.
  g.items.set("t1", { ...g.items.get("t1")!, fields: { ...g.items.get("t1")!.fields, decision: "rejected", decided_version: g.items.get("t1")!.fields.version! } });
  g.items.set("s", item("s", "part", { rev: "r2" }));
  await solve(["t1"], g, domains, apply);
  assert.deepEqual(writes[0]!.fields.decision, null);
  assert.equal(g.items.get("t1")!.fields.result, "pass");
  assert.equal(g.items.get("t2")!.fields.result, "pass");
});

test("solve: a subject no domain judges is left as it is; a judge that throws is an error", async () => {
  const g = graph([item("s", "part", { rev: "r1" }), item("r", "rule", { fn: "min", params: { min: 1 } }), item("t", "test")], [["checks", "t", "s"], ["applies", "t", "r"]]);
  const writes: Write[] = [];
  await solve(["t"], g, () => undefined, async (w) => void writes.push(w));
  assert.equal(writes.length, 0);
  await solve(["t"], g, () => judging({}), async (w) => void writes.push(w));
  assert.deepEqual(writes.map((w) => w.fields.result), ["pending", "error"]);
  assert.deepEqual(writes[1]!.fields.findings, [{ message: "no subject r1" }]);
});

test("solve: a two-subject test judges its subject against the other, and stamps both", async () => {
  const g = graph(
    [item("a", "part", { rev: "a1" }), item("b", "part", { rev: "b1" }), item("r", "rule", { fn: "fit", params: { min: 0 } }), item("t", "test")],
    [["checks", "t", "a"], ["against", "t", "b"], ["applies", "t", "r"]],
  );
  const calls: string[] = [];
  const writes: Write[] = [];
  await solve(["t"], g, () => judging({ a1: 1 }, calls), async (w) => void writes.push(w));
  assert.deepEqual(calls, ["a1|b1:fit"]);
  assert.equal(writes[0]!.version, stamp({ fn: "fit", params: { min: 0 }, field: "rev", value: "a1", other: "b1", needs: [] }));
});

test("seeds: a change reaches the tests whose inputs it may have moved", async () => {
  const g = graph(
    [item("s", "part"), item("r", "rule"), item("t", "test"), item("l", "needs", { from: "t", to: "u" })],
    [["checks", "t", "s"], ["against", "u", "s"], ["applies", "t", "r"]],
  );
  const typeOf = async (id: string) => g.items.get(id)?.type;
  const stampOf = (type: string) => (type === "part" ? "rev" : undefined);
  assert.deepEqual(await seeds([["+", "s", "rev", "r2"]], g, typeOf, stampOf), ["t", "u"]);
  assert.deepEqual(await seeds([["+", "s", "title", "x"]], g, typeOf, stampOf), []);
  assert.deepEqual(await seeds([["+", "r", "params", { min: 3 }]], g, typeOf, stampOf), ["t"]);
  assert.deepEqual(await seeds([["+", "l", "type", "needs"], ["+", "l", "from", "t"]], g, typeOf, stampOf), ["t"]);
  assert.deepEqual(await seeds([["+", "n", "type", "test"]], g, typeOf, stampOf), ["n"]);
});

const LIMITS: RuleLimit[] = [
  { fn: "thin_wall", limit: "min_thickness", fails: "below" },
  { fn: "deep_hole", limit: "max_depth_ratio", fails: "above" },
];
const walls = { id: "walls", title: "Walls at least 2 mm", fn: "thin_wall", params: { min_thickness: 2 } };
const holes = { id: "holes", title: "Holes at most 5 x", fn: "deep_hole", params: { max_depth_ratio: 5 } };
const d = (test: string, rule: string, decision: Decided["decision"], measured: number): Decided => ({ test, title: test, rule, decision, measured: [measured] });

test("rejections: the limit that spares the rejected and still catches the accepted, either side", () => {
  const [r] = reading([walls], LIMITS, [d("a", "walls", "accepted", 0.8), d("b", "walls", "accepted", 1.2), d("c", "walls", "rejected", 1.5), d("e", "walls", "rejected", 1.8)]);
  assert.equal(r!.current, 2);
  assert.equal(r!.proposal, 1.5);
  assert.match(r!.note, /Lowering min_thickness to 1.5 spares every rejection and still catches 2 accepted/);
  const [h] = reading([holes], LIMITS, [d("a", "holes", "rejected", 7), d("b", "holes", "accepted", 10)]);
  assert.equal(h!.proposal, 7);
  assert.match(h!.note, /Raising max_depth_ratio to 7/);
});

test("rejections: no proposal when no threshold can say it; nothing decided or an unknown fn is left out", () => {
  const [r] = reading([walls], LIMITS, [d("a", "walls", "rejected", 1.0), d("b", "walls", "accepted", 1.4)]);
  assert.equal(r!.proposal, null);
  assert.match(r!.note, /a threshold can't say/);
  assert.deepEqual(reading([walls, holes], LIMITS, []), []);
  assert.deepEqual(reading([{ ...walls, fn: "unknown" }], LIMITS, [d("a", "walls", "rejected", 1)]), []);
  const [s] = reading([walls], LIMITS, [d("a", "walls", "accepted", 1)]);
  assert.match(s!.note, /Nothing rejected/);
});

test("decidedOf: a decision counts at its version, with a rule and a measured finding", () => {
  const t = (fields: Record<string, Json>) => item("t", "test", { title: "T", version: "v", findings: [{ measured: 1.5 }, { message: "x" }], ...fields });
  assert.deepEqual(decidedOf(t({ decision: "rejected", decided_version: "v" }), "r"), { test: "t", title: "T", rule: "r", decision: "rejected", measured: [1.5] });
  assert.equal(decidedOf(t({ decision: "rejected", decided_version: "old" }), "r"), undefined);
  assert.equal(decidedOf(t({ decision: "rejected", decided_version: "v" }), undefined), undefined);
  assert.equal(decidedOf(t({ decision: "rejected", decided_version: "v", findings: [] }), "r"), undefined);
});

// ---- The pack in a runtime ----

const BASES = ["graph", "action", "types", "work", "question", "record", "actor", "links", "items", "schema"];

/** A stand-in domain pack: subjects of type `part`, stamped by `rev`. */
function partDomain(thickness: Map<string, number>, calls: string[]): Pack {
  return {
    id: "parts",
    about: "A stand-in domain for the checks pack's tests.",
    inject: ["types.define", "checks.domain"],
    apply(ctx) {
      ctx.get<any>("types.define").flavour({ name: "part", base: "record", fields: { rev: { kind: "text" } }, trial: false });
      const domain: CheckDomain = {
        subject: "part",
        stamp: "rev",
        judge: (call) => judging(Object.fromEntries(thickness), calls).judge(call),
        limits: async () => [{ fn: "min", limit: "min", fails: "below" }],
      };
      ctx.get<ChecksDomain>("checks.domain").register(domain);
    },
  };
}

async function setup(thickness: Map<string, number>) {
  const calls: string[] = [];
  const packs: Record<string, Pack> = {};
  for (const id of BASES) packs[id] = (await import(`../packs/${id}/index.ts`)).default;
  packs.checks = checks;
  packs.parts = partDomain(thickness, calls);
  packs.probe = { id: "probe", inject: ["action.invoke", "graph.read"], apply() {} };
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => void errors.push(e);
  const loader = new Loader(rt, { base: "mem:/", import: async (u) => ({ default: packs[u.slice(5)]! }) });
  await loader.apply([...BASES, "checks", "parts", "probe"].map((id) => ({ id, pack: id })));
  await rt.settle();
  const ctx = loader.fiber("probe")!.ctx.intercept({ actor: { id: "person:owner", kind: "person" } });
  const invoke = ctx.get<any>("action.invoke");
  const g = ctx.get<any>("graph.read");
  const act = async (action: string, input: unknown) => {
    const o = await invoke.invoke({ action, input, authority: { of: "human", basis: "a test" }, reason: "a test" });
    if (!o.ok) throw new Error(`${o.refused.code}: ${o.refused.message}`);
    return o.output as any;
  };
  const make = async (type: string, title: string, fields: Record<string, unknown> = {}) => (await act("items.create", { type, title, fields })).id as string;
  const link = (type: string, from: string, to: string) => act("items.link", { type, from, to });
  const get = async (id: string) => (await g.get([id]))[0];
  const settled = async (ids: string[]) => {
    for (let i = 0; i < 300; i++) {
      const ts = await g.get(ids);
      if (ts.every((t: any) => t.fields.result && t.fields.result !== "pending")) return ts;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.fail(`still pending: ${JSON.stringify((await g.get(ids)).map((t: any) => [t.id, t.fields.result]))}`);
  };
  const quiet = () => new Promise((r) => setTimeout(r, 40));
  return { act, make, link, get, settled, quiet, calls, errors, history: (page: any) => g.since(page), stop: () => loader.apply([]) };
}

test("the pack solves a test through its domain's judge, on the test's word, and again when its inputs move", async () => {
  const thickness = new Map([["r1", 1], ["r2", 3]]);
  const s = await setup(thickness);
  try {
    const p = await s.make("part", "Bracket", { rev: "r1" });
    const r = await s.make("rule", "At least 2", { fn: "min", params: { min: 2 } });
    const t = await s.make("test", "Bracket walls");
    await s.link("checks", t, p);
    await s.link("applies", t, r);
    let [x] = await s.settled([t]);
    assert.equal(x.fields.result, "fail");
    const changes = (await s.history({ limit: 500 })).items.filter((c: any) => c.header.actor.id === `test:${t}`);
    assert.equal(changes.at(-1).header.authority.basis, `test ${t} at ${x.fields.version}`);

    await assert.rejects(s.act("checks.decide", { test: await s.make("test", "Unsolved"), decision: "accepted" }), /checks.not_solved/);
    await s.act("checks.decide", { test: t, decision: "rejected" });
    assert.equal((await s.get(t)).fields.decided_version, x.fields.version);
    const [reading] = await s.act("checks.rejections", {});
    assert.deepEqual([reading.rule, reading.proposal], [r, 1]);

    // A field the stamp doesn't read changes nothing; the stamped one solves it again and clears the decision.
    await s.act("items.set", { id: p, fields: { title: "Bracket, left" } });
    await s.quiet();
    assert.equal((await s.get(t)).fields.decision, "rejected");
    await s.act("items.set", { id: p, fields: { rev: "r2" } });
    await s.quiet();
    [x] = await s.settled([t]);
    assert.equal(x.fields.result, "pass");
    assert.equal(x.fields.decision, undefined);

    // The rule's limit is data: raising it fails the test again.
    await s.act("items.set", { id: r, fields: { params: { min: 4 } } });
    await s.quiet();
    [x] = await s.settled([t]);
    assert.equal(x.fields.result, "fail");
    assert.deepEqual(s.errors, []);
  } finally {
    await s.stop();
  }
});

test("needs is held acyclic, and a domain can't take a subject or stamp field that is taken", async () => {
  const s = await setup(new Map());
  try {
    const a = await s.make("test", "A");
    const b = await s.make("test", "B");
    await s.link("needs", a, b);
    await assert.rejects(s.link("needs", b, a), /schema\.(quarantined|cycle)/);
  } finally {
    await s.stop();
  }
  const rt = new Runtime();
  const loaded: Record<string, Pack> = {};
  for (const id of BASES) loaded[id] = (await import(`../packs/${id}/index.ts`)).default;
  const tries: string[] = [];
  const probe: Pack = {
    id: "probe",
    inject: ["checks.domain"],
    apply(ctx) {
      const reg = ctx.get<ChecksDomain>("checks.domain");
      const j = judging({});
      for (const dom of [{ subject: "part", stamp: "fn" }, { subject: "test", stamp: "rev" }, { subject: "part", stamp: "rev" }, { subject: "part", stamp: "rev" }]) {
        try {
          reg.register({ ...j, ...dom });
          tries.push("ok");
        } catch (err) {
          tries.push((err as { refusal: { code: string } }).refusal.code);
        }
      }
    },
  };
  const loader = new Loader(rt, { base: "mem:/", import: async (u) => ({ default: { ...loaded, checks, probe }[u.slice(5)]! }) });
  await loader.apply([...BASES, "checks", "probe"].map((id) => ({ id, pack: id })));
  await rt.settle();
  assert.deepEqual(tries, ["checks.stamp", "checks.subject", "ok", "checks.subject_taken"]);
  await loader.apply([]);
});
