/**
 * The checks plugin: its checker and rejections reading apart from the
 * runtime (a graph as plain data in, the writes it makes out), then the plugin
 * in a runtime with the map's plugins in memory and a stand-in domain whose
 * judge compares a subject's `length` (by its `rev`) with a rule's limit.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Json } from "../spec/common.ts";
import type { Item } from "../spec/graph.ts";
import { Runtime, type Plugin } from "../runtime/core.ts";
import { Loader } from "../runtime/loader.ts";
import { carried, identities, order, readsOf, ReadsIndex, seeds, solve, stamp, type Judging, type Read, type Write } from "../plugins/checks/checker.ts";
import { LIMIT_MAX } from "../spec/graph.ts";
import { decidedOf, read as reading, type Decided, type RuleLimit } from "../plugins/checks/rejections.ts";
import checks, { type CheckDomain, type ChecksDomain } from "../plugins/checks/index.ts";
import { preview } from "../plugins/checks/preview.ts";

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

/** A judge over `rev`s: passes when the subject's length is at least the rule's min. */
function judging(length: Record<string, number>, calls: string[] = []): Judging {
  return {
    stamp: "rev",
    async judge({ subject, other, fn, params }) {
      const rev = subject.fields.rev as string;
      calls.push(`${rev}${other ? `|${other.fields.rev}` : ""}:${fn}`);
      const t = length[rev];
      if (t === undefined) throw new Error(`no subject ${rev}`);
      const min = (params as { min: number }).min;
      return { passed: t >= min, findings: t >= min ? [] : [{ measured: t, limit: min }] };
    },
  };
}

test("a stamp is the same for the same inputs, whatever their order, and keeps its bytes", () => {
  // Pinned: a stamp keeps its bytes, or every test on a map already solved would be solved again.
  assert.equal(stamp({ fn: "few_words", params: { min_words: 2 }, field: "hash", value: "h1", needs: [] }), "740ede90364e12e3");
  assert.equal(stamp({ fn: "few_words", params: { min_words: 2 }, field: "hash", value: "h1", needs: [["t_b", "v1", "pass"], ["t_a", "v0", "fail"]] }), "fae55f5b85bf676d");
  assert.equal(stamp({ fn: "overlap", params: { min_distance: 0.05 }, field: "hash", value: "a.md", other: "b.md", needs: [] }), "9495b8c1dbd584f8");
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
      item("s", "doc", { rev: "r1" }),
      item("words", "rule", { fn: "min", params: { min: 2 } }),
      item("t1", "test"),
      item("t2", "test"),
    ],
    [["checks", "t1", "s"], ["applies", "t1", "words"], ["checks", "t2", "s"], ["applies", "t2", "words"], ["needs", "t2", "t1"]],
  );
  const writes: Write[] = [];
  const apply = async (w: Write) => {
    writes.push(w);
    const t = g.items.get(w.test)!;
    g.items.set(w.test, { ...t, fields: { ...t.fields, ...w.fields } });
  };
  const domains = (type: string) => (type === "doc" ? judging({ r1: 1, r2: 3 }) : undefined);
  await solve(["t1"], g, domains, apply);
  assert.deepEqual(writes.map((w) => [w.test, w.fields.result]), [["t1", "pending"], ["t1", "fail"], ["t2", "pending"], ["t2", "blocked"]]);
  assert.deepEqual(g.items.get("t1")!.fields.findings, [{ measured: 1, limit: 2 }]);

  // Nothing moved: nothing is written.
  writes.length = 0;
  await solve(["t1", "t2"], g, domains, apply);
  assert.equal(writes.length, 0);

  // A decision is cleared when the version moves.
  g.items.set("t1", { ...g.items.get("t1")!, fields: { ...g.items.get("t1")!.fields, decision: "rejected", decided_version: g.items.get("t1")!.fields.version! } });
  g.items.set("s", item("s", "doc", { rev: "r2" }));
  await solve(["t1"], g, domains, apply);
  assert.deepEqual(writes[0]!.fields.decision, null);
  assert.equal(g.items.get("t1")!.fields.result, "pass");
  assert.equal(g.items.get("t2")!.fields.result, "pass");
});

test("solve: a subject no domain judges is left as it is; a judge that throws is an error", async () => {
  const g = graph([item("s", "doc", { rev: "r1" }), item("r", "rule", { fn: "min", params: { min: 1 } }), item("t", "test")], [["checks", "t", "s"], ["applies", "t", "r"]]);
  const writes: Write[] = [];
  await solve(["t"], g, () => undefined, async (w) => void writes.push(w));
  assert.equal(writes.length, 0);
  await solve(["t"], g, () => judging({}), async (w) => void writes.push(w));
  assert.deepEqual(writes.map((w) => w.fields.result), ["pending", "error"]);
  assert.deepEqual(writes[1]!.fields.findings, [{ message: "no subject r1" }]);
});

test("solve: a two-subject test judges its subject against the other, and stamps both", async () => {
  const g = graph(
    [item("a", "doc", { rev: "a1" }), item("b", "doc", { rev: "b1" }), item("r", "rule", { fn: "fit", params: { min: 0 } }), item("t", "test")],
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
    [item("s", "doc"), item("r", "rule"), item("t", "test"), item("l", "needs", { from: "t", to: "u" })],
    [["checks", "t", "s"], ["against", "u", "s"], ["applies", "t", "r"]],
  );
  const typeOf = async (id: string) => g.items.get(id)?.type;
  const stampOf = (type: string) => (type === "doc" ? "rev" : undefined);
  assert.deepEqual(await seeds([["+", "s", "rev", "r2"]], g, typeOf, stampOf), ["t", "u"]);
  assert.deepEqual(await seeds([["+", "s", "title", "x"]], g, typeOf, stampOf), []);
  assert.deepEqual(await seeds([["+", "r", "params", { min: 3 }]], g, typeOf, stampOf), ["t"]);
  assert.deepEqual(await seeds([["+", "l", "type", "needs"], ["+", "l", "from", "t"]], g, typeOf, stampOf), ["t"]);
  assert.deepEqual(await seeds([["+", "n", "type", "test"]], g, typeOf, stampOf), ["n"]);
});

const LIMITS: RuleLimit[] = [
  { fn: "few_words", limit: "min_words", fails: "below" },
  { fn: "long_lines", limit: "max_line_ratio", fails: "above" },
];
const words = { id: "words", title: "Sections at least 2 words", fn: "few_words", params: { min_words: 2 } };
const lines = { id: "lines", title: "Lines at most 5 x", fn: "long_lines", params: { max_line_ratio: 5 } };
const d = (test: string, rule: string, decision: Decided["decision"], measured: number): Decided => ({ test, title: test, rule, decision, measured: [measured] });

test("rejections: the limit that spares the rejected and still catches the accepted, either side", () => {
  const [r] = reading([words], LIMITS, [d("a", "words", "accepted", 0.8), d("b", "words", "accepted", 1.2), d("c", "words", "rejected", 1.5), d("e", "words", "rejected", 1.8)]);
  assert.equal(r!.current, 2);
  assert.equal(r!.proposal, 1.5);
  assert.match(r!.note, /Lowering min_words to 1.5 spares every rejection and still catches 2 accepted/);
  const [h] = reading([lines], LIMITS, [d("a", "lines", "rejected", 7), d("b", "lines", "accepted", 10)]);
  assert.equal(h!.proposal, 7);
  assert.match(h!.note, /Raising max_line_ratio to 7/);
});

test("rejections: no proposal when no threshold can say it; nothing decided or an unknown fn is left out", () => {
  const [r] = reading([words], LIMITS, [d("a", "words", "rejected", 1.0), d("b", "words", "accepted", 1.4)]);
  assert.equal(r!.proposal, null);
  assert.match(r!.note, /a threshold can't say/);
  assert.deepEqual(reading([words, lines], LIMITS, []), []);
  assert.deepEqual(reading([{ ...words, fn: "unknown" }], LIMITS, [d("a", "words", "rejected", 1)]), []);
  const [s] = reading([words], LIMITS, [d("a", "words", "accepted", 1)]);
  assert.match(s!.note, /Nothing rejected/);
});

test("decidedOf: a decision counts at its version, with a rule and a measured finding", () => {
  const t = (fields: Record<string, Json>) => item("t", "test", { title: "T", version: "v", findings: [{ measured: 1.5 }, { message: "x" }], ...fields });
  assert.deepEqual(decidedOf(t({ decision: "rejected", decided_version: "v" }), "r"), { test: "t", title: "T", rule: "r", decision: "rejected", measured: [1.5] });
  assert.equal(decidedOf(t({ decision: "rejected", decided_version: "old" }), "r"), undefined);
  assert.equal(decidedOf(t({ decision: "rejected", decided_version: "v" }), undefined), undefined);
  assert.equal(decidedOf(t({ decision: "rejected", decided_version: "v", findings: [] }), "r"), undefined);
});

// ---- The plugin in a runtime ----

const BASES = ["graph", "action", "types", "work", "question", "record", "actor", "links", "items", "schema"];

/** A stand-in domain plugin: subjects of type `doc`, stamped by `rev`. */
function docDomain(length: Map<string, number>, calls: string[]): Plugin {
  return {
    id: "docs",
    about: "A stand-in domain for the checks plugin's tests.",
    inject: ["types.define", "checks.domain"],
    apply(ctx) {
      ctx.get<any>("types.define").flavour({ name: "doc", base: "record", fields: { rev: { kind: "text" } }, trial: false });
      const domain: CheckDomain = {
        subject: "doc",
        stamp: "rev",
        judge: (call) => judging(Object.fromEntries(length), calls).judge(call),
        limits: async () => [{ fn: "min", limit: "min", fails: "below" }],
      };
      ctx.get<ChecksDomain>("checks.domain").register(domain);
    },
  };
}

async function setup(length: Map<string, number>) {
  const calls: string[] = [];
  const plugins: Record<string, Plugin> = {};
  for (const id of BASES) plugins[id] = (await import(`../plugins/${id}/index.ts`)).default;
  plugins.checks = checks;
  plugins.docs = docDomain(length, calls);
  plugins.probe = { id: "probe", inject: ["action.invoke", "graph.read", "checks.domain"], apply() {} };
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => void errors.push(e);
  const loader = new Loader(rt, { base: "mem:/", import: async (u) => ({ default: plugins[u.slice(5)]! }) });
  await loader.apply([...BASES, "checks", "docs", "probe"].map((id) => ({ id, plugin: id })));
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
  const register = (d: CheckDomain) => ctx.get<ChecksDomain>("checks.domain").register(d);
  return { act, make, link, get, settled, quiet, register, calls, errors, history: (page: any) => g.since(page), stop: () => loader.apply([]) };
}

test("the plugin solves a test through its domain's judge, on the test's word, and again when its inputs move", async () => {
  const length = new Map([["r1", 1], ["r2", 3]]);
  const s = await setup(length);
  try {
    const p = await s.make("doc", "Guide", { rev: "r1" });
    const r = await s.make("rule", "At least 2", { fn: "min", params: { min: 2 } });
    const t = await s.make("test", "Guide words");
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
    await s.act("items.set", { id: p, fields: { title: "Guide, left" } });
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
  const loaded: Record<string, Plugin> = {};
  for (const id of BASES) loaded[id] = (await import(`../plugins/${id}/index.ts`)).default;
  const tries: string[] = [];
  const probe: Plugin = {
    id: "probe",
    inject: ["checks.domain"],
    apply(ctx) {
      const reg = ctx.get<ChecksDomain>("checks.domain");
      const j = judging({});
      for (const dom of [{ subject: "doc", stamp: "fn" }, { subject: "test", stamp: "rev" }, { subject: "doc", stamp: "rev" }, { subject: "doc", stamp: "rev" }]) {
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
  await loader.apply([...BASES, "checks", "probe"].map((id) => ({ id, plugin: id })));
  await rt.settle();
  assert.deepEqual(tries, ["checks.stamp", "checks.subject", "ok", "checks.subject_taken"]);
  await loader.apply([]);
});

// ---- Recorded reads ----

/** A judge that reads the graph: a subject passes when it has an owner and what it is part_of is open. Records its calls. */
function readingJudge(calls: string[] = []): Judging {
  return {
    async judge({ subject, subjects, fn, read }) {
      calls.push(`${subjects.map((s) => s.id).join("+")}:${fn}`);
      const owner = subject.fields.owner;
      const up = await read!.links(subject.id, { type: "part_of", dir: "out" }, { limit: 5 });
      const parents = await read!.get(up.items.map((l) => l.to));
      const closed = parents.filter((p) => p && (p.fields.status === "done" || p.fields.status === "dropped")).map((p) => p!.id);
      const findings: Json[] = [...(owner ? [] : [{ message: "no owner" }]), ...closed.map((id) => ({ message: `${id} is closed` }))];
      return { passed: !findings.length, findings };
    },
  };
}

/** A graph whose items and links can change, and a write that applies to it. */
function live(items: Item[], links: [string, string, string][]) {
  const g = graph(items, links);
  const writes: Write[] = [];
  const apply = async (w: Write) => {
    writes.push(w);
    const t = g.items.get(w.test)!;
    const fields = { ...t.fields };
    for (const [k, v] of Object.entries(w.fields)) {
      if (v === null) delete fields[k];
      else fields[k] = v;
    }
    g.items.set(w.test, { ...t, fields });
  };
  const set = (id: string, fields: Record<string, Json>) => g.items.set(id, { ...g.items.get(id)!, fields: { ...g.items.get(id)!.fields, ...fields } });
  return { g, links, writes, apply, set };
}

test("recorded reads: the stamp is what the judge read; an unread field moves nothing, a read one or a linked item does", async () => {
  const { g, links, writes, apply, set } = live(
    [item("task", "work", { title: "Do it", owner: "pat" }), item("hub", "work", { status: "open" }), item("r", "rule", { fn: "owned", params: {} }), item("t", "test")],
    [["checks", "t", "task"], ["applies", "t", "r"], ["part_of", "task", "hub"]],
  );
  const calls: string[] = [];
  const dom = () => readingJudge(calls);
  await solve(["t"], g, dom, apply);
  assert.equal(g.items.get("t")!.fields.result, "pass");
  assert.deepEqual(g.items.get("t")!.fields.reads, { items: [["hub", ["status"]], ["task", ["owner"]]], links: [["task", "part_of", "out", 5, null]] });
  assert.equal(calls.length, 1);

  // Nothing it read moved: replayed, not judged, nothing written.
  writes.length = 0;
  set("task", { title: "Do it now" });
  await solve(["t"], g, dom, apply);
  assert.deepEqual([writes.length, calls.length], [0, 1]);

  // What it reached through a link moved: judged again.
  set("hub", { status: "done" });
  await solve(["t"], g, dom, apply);
  assert.equal(g.items.get("t")!.fields.result, "fail");
  assert.deepEqual(g.items.get("t")!.fields.findings, [{ message: "hub is closed" }]);

  // A new link on a page it read: judged again, and what it reads now is kept.
  g.items.set("hub2", item("hub2", "work", { status: "open" }));
  links.push(["part_of", "task", "hub2"]);
  set("hub", { status: "open" });
  await solve(["t"], g, dom, apply);
  assert.equal(calls.length, 3);
  assert.deepEqual(g.items.get("t")!.fields.reads, { items: [["hub", ["status"]], ["hub2", ["status"]], ["task", ["owner"]]], links: [["task", "part_of", "out", 5, null]] });
  assert.equal(g.items.get("t")!.fields.result, "pass");
});

test("recorded reads: any number of subjects, and the stamp covers which ones", async () => {
  const { g, links, apply } = live(
    [item("a", "work", { owner: "x" }), item("b", "work"), item("c", "work"), item("d", "work"), item("r", "rule", { fn: "owned" }), item("t", "test")],
    [["checks", "t", "a"], ["checks", "t", "b"], ["against", "t", "c"], ["applies", "t", "r"]],
  );
  const calls: string[] = [];
  await solve(["t"], g, () => readingJudge(calls), apply);
  assert.deepEqual(calls, ["a+b+c:owned"]);
  const v = g.items.get("t")!.fields.version;
  // Pointing one of them elsewhere moves the stamp, though the judge read nothing of it.
  links[1] = ["checks", "t", "d"];
  await solve(["t"], g, () => readingJudge(calls), apply);
  assert.equal(calls.at(-1), "a+d+c:owned");
  assert.notEqual(g.items.get("t")!.fields.version, v);
});

test("recorded reads: the day is a read; reads are bounded; a domain judges by function, whatever the subject", async () => {
  const { g, apply } = live([item("s", "work", { due: "2026-01-10" }), item("r", "rule", { fn: "late", params: { grace: 2 } }), item("t", "test")], [["checks", "t", "s"], ["applies", "t", "r"]]);
  let day = "2026-01-11";
  const late: Judging = {
    async judge({ subject, params, read }) {
      const over = (Date.parse(read!.today()) - Date.parse(subject.fields.due as string)) / 864e5;
      return { passed: over <= (params as { grace: number }).grace, findings: [] };
    },
  };
  const byFn = (_type: string, fn?: string) => (fn === "late" ? late : undefined);
  await solve(["t"], g, byFn, apply, { today: () => day });
  assert.equal(g.items.get("t")!.fields.result, "pass");
  const idx = new ReadsIndex();
  idx.set("t", readsOf(g.items.get("t")!.fields.reads));
  assert.deepEqual(idx.today(), ["t"]);
  day = "2026-01-14";
  await solve(idx.today(), g, byFn, apply, { today: () => day });
  assert.equal(g.items.get("t")!.fields.result, "fail");

  // A read over the bound is an error, not a hang.
  const greedy: Judging = { judge: async ({ read }) => (await read!.get(Array.from({ length: LIMIT_MAX + 1 }, (_, i) => `x${i}`)), { passed: true, findings: [] }) };
  const h = live([item("s", "work"), item("r", "rule", { fn: "greedy" }), item("t", "test")], [["checks", "t", "s"], ["applies", "t", "r"]]);
  await solve(["t"], h.g, () => greedy, h.apply);
  assert.equal(h.g.items.get("t")!.fields.result, "error");
  assert.match(JSON.stringify(h.g.items.get("t")!.fields.findings), /at most 500 ids/);
});

test("recorded reads: the index seeds a test from an item it read, or a link at one", () => {
  const idx = new ReadsIndex();
  idx.set("t", { items: [["a", ["owner"]]], links: [["a", "part_of", "out", 5, null]] });
  assert.deepEqual(idx.seeds([["+", "a", "title", "x"]]), ["t"]);
  assert.deepEqual(idx.seeds([["+", "l1", "type", "part_of"], ["+", "l1", "from", "a"], ["+", "l1", "to", "b"]]), ["t"]);
  assert.deepEqual(idx.seeds([["+", "b", "title", "x"]]), []);
  idx.set("t", null);
  assert.deepEqual(idx.seeds([["+", "a", "title", "x"]]), []);
});

test("the plugin: a domain that judges by function reads the graph, and a change to what it read solves the test again", async () => {
  const calls: string[] = [];
  const s = await setup(new Map());
  try {
    const p = await s.make("work", "Task");
    const hub = await s.make("work", "Hub");
    await s.link("part_of", p, hub);
    const r = await s.make("rule", "Owned", { fn: "owned", params: {} });
    const t = await s.make("test", "Task owned");
    await s.link("checks", t, p);
    await s.link("applies", t, r);
    await s.quiet();
    assert.equal(calls.length, 0); // nothing judges `owned` yet

    s.register({ fns: ["owned"], ...readingJudge(calls) });
    await s.quiet();
    let [x] = await s.settled([t]);
    assert.deepEqual([x.fields.result, x.fields.findings], ["fail", [{ message: "no owner" }]]);

    await s.act("items.set", { id: p, fields: { title: "Task, renamed" } });
    await s.quiet();
    assert.equal(calls.length, 1);
    await s.act("items.set", { id: hub, fields: { status: "done" } });
    await s.quiet();
    [x] = await s.settled([t]);
    assert.deepEqual(x.fields.findings, [{ message: "no owner" }, { message: `${hub} is closed` }]);
    assert.equal(calls.length, 2);

    assert.throws(() => s.register({ fns: ["owned"], ...readingJudge() }), /fn_taken|already judged/);
    assert.throws(() => s.register({ fns: ["other"], stamp: "rev", ...readingJudge() }), /declares no stamp/);
    assert.deepEqual(s.errors, []);
  } finally {
    await s.stop();
  }
});

// ---- Preview ----

test("preview: which tests a rule change would flip, judged only where the stamp moves, nothing written", async () => {
  const { g, writes, apply } = live(
    [
      item("a", "doc", { rev: "ra" }),
      item("b", "doc", { rev: "rb" }),
      item("c", "doc", { rev: "rc" }),
      item("words", "rule", { fn: "min", params: { min: 2 } }),
      item("other", "rule", { fn: "min", params: { min: 0 } }),
      item("ta", "test", { title: "A words" }),
      item("tb", "test", { title: "B words" }),
      item("tc", "test", { title: "C other" }),
      item("ready", "test", { title: "A ready" }),
    ],
    [
      ["checks", "ta", "a"], ["applies", "ta", "words"],
      ["checks", "tb", "b"], ["applies", "tb", "words"],
      ["checks", "tc", "c"], ["applies", "tc", "other"],
      ["checks", "ready", "a"], ["applies", "ready", "other"], ["needs", "ready", "ta"],
    ],
  );
  const calls: string[] = [];
  const dom = () => judging({ ra: 1.5, rb: 3, rc: 1 }, calls);
  await solve(["ta", "tb", "tc", "ready"], g, dom, apply);
  assert.deepEqual(["ta", "tb", "tc", "ready"].map((id) => g.items.get(id)!.fields.result), ["fail", "pass", "pass", "blocked"]);
  const snapshot = JSON.stringify([...g.items]);
  writes.length = 0;
  calls.length = 0;

  const p = await preview("words", { min: 1 }, g, dom);
  assert.equal(writes.length, 0);
  assert.equal(JSON.stringify([...g.items]), snapshot);
  // Both words tests move (their params did), and `ready` with them; `tc` doesn't.
  assert.deepEqual(p.tests.map((t) => [t.test, t.before.result, t.after.result, t.flips]), [
    ["ta", "fail", "pass", true],
    ["tb", "pass", "pass", false],
    ["ready", "blocked", "pass", true],
  ]);
  assert.deepEqual(calls.sort(), ["ra:min", "ra:min", "rb:min"]);
  assert.deepEqual([p.flips, p.judged, p.held_back], [2, 3, 0]);

  // judge: 0 judges nothing, and says what would be judged.
  calls.length = 0;
  const q = await preview("words", { min: 1 }, g, dom, { judge: 0 });
  assert.deepEqual(calls, []);
  assert.deepEqual(q.tests.map((t) => [t.test, t.after.result, t.judged]), [["ta", "pending", false], ["tb", "pending", false], ["ready", "pending", false]]);
  assert.equal(q.held_back, 3);
  await assert.rejects(preview("ta", {}, g, dom), /not a rule/);
});

test("the plugin: checks.preview writes nothing to the map", async () => {
  const s = await setup(new Map([["r1", 1]]));
  try {
    const p = await s.make("doc", "Guide", { rev: "r1" });
    const r = await s.make("rule", "At least 2", { fn: "min", params: { min: 2 } });
    const t = await s.make("test", "Guide words");
    await s.link("checks", t, p);
    await s.link("applies", t, r);
    await s.settled([t]);
    await s.quiet();
    const before = (await s.history({ limit: 500 })).items.length;
    const out = await s.act("checks.preview", { rule: r, params: { min: 0.5 } });
    assert.deepEqual(out.tests.map((x: any) => [x.test, x.before.result, x.after.result, x.flips]), [[t, "fail", "pass", true]]);
    await s.quiet();
    assert.equal((await s.history({ limit: 500 })).items.length, before);
    assert.equal((await s.get(t)).fields.result, "fail");
    assert.deepEqual((await s.get(r)).fields.params, { min: 2 });
  } finally {
    await s.stop();
  }
});

// ---- Decisions per finding ----

/** A judge whose findings are the sections of its subject shorter than the limit, named by section. */
function sections(finding = true): Judging {
  return {
    stamp: "rev",
    async judge({ subject, params }) {
      const words = JSON.parse(subject.fields.rev as string) as Record<string, number>;
      const min = (params as { min: number }).min;
      const findings = Object.entries(words).filter(([, n]) => n < min).map(([section, n]) => ({ section, measured: n }));
      return { passed: !findings.length, findings };
    },
    ...(finding ? { finding: (f: Json) => ((f as { section?: string }).section ?? undefined) } : {}),
  };
}

test("decisions per finding: kept while every finding decided on is still found, cleared when one goes or the result turns", async () => {
  const { g, apply, set } = live([item("s", "doc", { rev: JSON.stringify({ f1: 1, f2: 1.5, f3: 3 }) }), item("r", "rule", { fn: "min", params: { min: 2 } }), item("t", "test")], [["checks", "t", "s"], ["applies", "t", "r"]]);
  const dom = () => sections();
  const decide = () => {
    const f = g.items.get("t")!.fields;
    set("t", { decision: "rejected", decided_version: f.version!, decided_findings: identities(f.findings!, sections().finding!) as string[] });
  };
  await solve(["t"], g, dom, apply);
  decide();
  assert.deepEqual(g.items.get("t")!.fields.decided_findings, ["f1", "f2"]);

  // The document changed, its counts with it, but f1 and f2 are still found (and f4 is new): kept, at the new version.
  set("s", { rev: JSON.stringify({ f1: 1.2, f2: 1.4, f3: 3, f4: 0.5 }) });
  await solve(["t"], g, dom, apply);
  let f = g.items.get("t")!.fields;
  assert.equal(f.result, "fail");
  assert.deepEqual([f.decision, f.decided_version === f.version], ["rejected", true]);

  // f2 is gone: cleared.
  set("s", { rev: JSON.stringify({ f1: 1.2, f2: 2.5, f3: 3, f4: 0.5 }) });
  await solve(["t"], g, dom, apply);
  f = g.items.get("t")!.fields;
  assert.deepEqual([f.decision, f.decided_version, f.decided_findings], [undefined, undefined, undefined]);

  // A decided pass is carried while it passes, and cleared when it fails.
  set("s", { rev: JSON.stringify({ f1: 3 }) });
  await solve(["t"], g, dom, apply);
  decide();
  set("s", { rev: JSON.stringify({ f1: 4 }) });
  await solve(["t"], g, dom, apply);
  assert.equal(g.items.get("t")!.fields.decision, "rejected");
  set("s", { rev: JSON.stringify({ f1: 1 }) });
  await solve(["t"], g, dom, apply);
  assert.equal(g.items.get("t")!.fields.decision, undefined);
});

test("decisions per finding: without the hook a decision is cleared whenever the version moves, as before", async () => {
  const { g, apply, set } = live([item("s", "doc", { rev: JSON.stringify({ f1: 1 }) }), item("r", "rule", { fn: "min", params: { min: 2 } }), item("t", "test")], [["checks", "t", "s"], ["applies", "t", "r"]]);
  await solve(["t"], g, () => sections(false), apply);
  set("t", { decision: "rejected", decided_version: g.items.get("t")!.fields.version! });
  set("s", { rev: JSON.stringify({ f1: 1.1 }) });
  await solve(["t"], g, () => sections(false), apply);
  assert.equal(g.items.get("t")!.fields.decision, undefined);
  assert.deepEqual(carried({ decision: "rejected", decided_version: "a", result: "fail" }, "fail", [], "b", sections(false)), {});
});

test("the plugin: checks.decide keeps the findings' identities when the domain names them, and the checker carries it", async () => {
  const s = await setup(new Map());
  try {
    const { stamp: _, ...byNote } = sections();
    s.register({ fns: ["sections"], ...byNote, judge: (call) => sections().judge({ ...call, subject: { ...call.subject, fields: { rev: call.subject.fields.note! } } }) });
    const r = await s.make("rule", "At least 2", { fn: "sections", params: { min: 2 } });
    const p = await s.make("work", "Notes", { note: JSON.stringify({ f1: 1 }) });
    const t = await s.make("test", "Notes words");
    await s.link("applies", t, r);
    await s.link("checks", t, p);
    await s.quiet();
    await s.settled([t]);
    const out = await s.act("checks.decide", { test: t, decision: "rejected" });
    assert.deepEqual(out.findings, ["f1"]);
    assert.deepEqual((await s.get(t)).fields.decided_findings, ["f1"]);

    await s.act("items.set", { id: p, fields: { note: JSON.stringify({ f1: 1.2 }) } });
    await s.quiet();
    let [x] = await s.settled([t]);
    assert.deepEqual([x.fields.result, x.fields.decision, x.fields.decided_version === x.fields.version], ["fail", "rejected", true]);

    await s.act("items.set", { id: p, fields: { note: JSON.stringify({ f2: 1 }) } });
    await s.quiet();
    [x] = await s.settled([t]);
    assert.deepEqual([x.fields.result, x.fields.decision, x.fields.decided_findings], ["fail", undefined, undefined]);
    assert.deepEqual(s.errors, []);
  } finally {
    await s.stop();
  }
});

test("a judge is told the test it solves and the version it solves it at, either way of stamping", async () => {
  const seen: [string, string][] = [];
  const spy = (stamp?: string): Judging => ({ ...(stamp ? { stamp } : {}), judge: async (c) => (seen.push([c.test, c.version]), { passed: true, findings: [] }) });
  for (const s of ["rev", undefined]) {
    seen.length = 0;
    const { g, writes, apply } = live([item("p", "doc", { rev: "r1" }), item("r", "rule", { fn: "min" }), item("t", "test")], [["checks", "t", "p"], ["applies", "t", "r"]]);
    await solve(["t"], g, () => spy(s), apply);
    assert.deepEqual(seen, [["t", writes[0]!.version]]);
  }
});
