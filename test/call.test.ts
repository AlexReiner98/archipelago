import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionContext, ActionInvoke, ActionRegister } from "../spec/action.ts";
import type { AgentNode, NodeDef } from "../spec/agent.ts";
import type { Fact } from "../spec/changeset.ts";
import type { ExchangeEvent, ExchangeRead } from "../spec/exchange.ts";
import { Runtime, type Plugin } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import action from "../plugins/action/index.ts";
import agent from "../plugins/agent/index.ts";
import call, { callFacts, decisionOf, type CallAsk } from "../plugins/call/index.ts";
import exchange from "../plugins/exchange/index.ts";
import graph from "../plugins/graph/index.ts";

// ---------- apart from the runtime ----------

test("a call's facts: its own, then harness and parent, then the item it follows", () => {
  assert.deepEqual(callFacts({ title: "style", places: ["check:style"], facts: { fn: "style", harness: "x" }, follow: { item: "t1", version: "v1" } }, "p"), { fn: "style", harness: "call", parent: "p", item: "t1", version: "v1" });
});

test("a decision counts only at the call's version", () => {
  assert.equal(decisionOf({ decision: "rejected", decided_version: "v1" }, "v1"), "rejected");
  assert.equal(decisionOf({ decision: "rejected", decided_version: "v0" }, "v1"), null);
  assert.equal(decisionOf({ decided_version: "v1" }, "v1"), null);
});

const T = (s: number) => `2026-11-24T10:00:${String(s).padStart(2, "0")}.000Z`;
const ev = (seq: number, e: Partial<ExchangeEvent>): ExchangeEvent => ({ id: `c:${seq}`, run: "c", seq, time: T(seq), direction: "to_agent", kind: "say", ...e }) as ExchangeEvent;
const decision = (seq: number, ok: boolean) => ev(seq, { kind: "act", direction: "from_agent", place: "reply_end", act: { kind: "decision", by: "person", ok } });

// ---------- through the runtime ----------

const nodes: Plugin = {
  id: "nodes",
  inject: ["agent.node"],
  apply(ctx) {
    const reg = ctx.get<AgentNode>("agent.node");
    const def = (name: string, at: string[], say: string): NodeDef => ({ name, kind: "reflex", title: name, at, speak: () => ({ say }) });
    reg.node(def("style", ["check:line_length"], "Name the line and its measured length."));
    reg.node(def("finding", ["finding"], "Say what to change, in one line."));
    reg.node(def("other", ["check:draft"], "Not for lines."));
  },
};

/** A domain: its judge asks through call.ask. */
const domain: Plugin = { id: "domain", inject: ["call.ask"], apply() {} };
const probe: Plugin = { id: "probe", inject: ["exchange.read", "action.invoke"], apply() {} };
const seed: Plugin = {
  id: "seed",
  inject: ["action.register"],
  apply(ctx) {
    ctx.get<ActionRegister>("action.register").register({ name: "seed.raw", title: "Seed", input: { type: "object" }, async run(i: { facts: Fact[] }, c: ActionContext) { c.write(i.facts); return {}; } });
  },
};

async function setup() {
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const modules: Record<string, Plugin> = { graph, action, exchange, agent, nodes, call, domain, probe, seed };
  const BASE = "mem:/plugins/";
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length)]! }) });
  const tree: Entry[] = ["graph", "action", "exchange", "agent", "nodes", "call", "domain", "probe", "seed"].map((id) => ({ id, plugin: id }));
  await loader.apply(tree);
  await rt.settle();
  const ask = loader.fiber("domain")!.ctx.get<CallAsk>("call.ask");
  const p = loader.fiber("probe")!.ctx;
  const read = p.get<ExchangeRead>("exchange.read");
  const invoke = p.get<ActionInvoke>("action.invoke");
  const act = (name: string, input: unknown) => invoke.invoke({ action: name, input: input as never, authority: { of: "human", basis: "test" }, reason: "test" });
  return { rt, errors, ask, read, act };
}

test("a call is a run under its parent: begun, said to at its places, answered, ended", async () => {
  const { rt, errors, ask, read } = await setup();
  let heard: string[] = [];
  const out = await ask.ask({ title: "line_length", places: ["check:line_length", "finding"], parent: "checker", facts: { fn: "line_length" } }, async ({ said }) => {
    heard = said.map((s) => s.node);
    return { text: "Line 14 is 120 characters; wrap it at 80.", subject: { type: "source file", tokens: 900 }, usage: { input: 1200, output: 40 } };
  });
  assert.deepEqual(heard, ["nodes/style", "nodes/finding"]);
  const run = (await read.runs()).items.find((r) => r.run === out.run)!;
  assert.equal(run.facts?.harness, "call");
  assert.equal(run.facts?.parent, "checker");
  assert.equal(run.title, "line_length");
  assert.ok(run.ended);
  const evs = (await read.events(out.run)).items;
  assert.deepEqual(evs.map((e) => [e.kind, e.place ?? ""]), [["begin", ""], ["say", "check:line_length"], ["say", "finding"], ["act", "reply_end"], ["end", ""]]);
  const reply = evs[3]!.act!;
  assert.deepEqual(reply.input, { subject: { type: "source file", tokens: 900 } }, "the subject by its type and size only");
  assert.equal((reply.output as { text: string }).text, "Line 14 is 120 characters; wrap it at 80.");
  await rt.settle();
  assert.deepEqual(errors, []);
});

test("without a parent, a plugin's calls go under its own run of calls", async () => {
  const { ask, read } = await setup();
  const a = await ask.ask({ title: "a", places: ["finding"] }, async () => ({ text: "a" }));
  const b = await ask.ask({ title: "b", places: ["finding"] }, async () => ({ text: "b" }));
  const runs = (await read.runs()).items;
  const pa = runs.find((r) => r.run === a.run)!.facts?.parent;
  assert.ok(typeof pa === "string" && pa.startsWith("calls:domain:"));
  assert.equal(runs.find((r) => r.run === b.run)!.facts?.parent, pa);
  assert.equal(runs.find((r) => r.run === pa)!.title, "domain calls");
});

test("a failed ask is a failed answer, and the run still ends", async () => {
  const { ask, read } = await setup();
  let run = "";
  await assert.rejects(ask.ask({ title: "x", places: ["finding"], parent: "p" }, async (a) => { run = a.run; throw new Error("service down"); }), /service down/);
  const evs = (await read.events(run)).items;
  assert.deepEqual(evs.slice(-2).map((e) => [e.kind, e.act?.ok]), [["act", false], ["end", undefined]]);
});

/** Waits until `ok` holds, or two seconds pass: a watch's write lands when it lands, sooner or later on a slow runner. */
async function until(ok: () => Promise<boolean>, ms = 2000) {
  const end = Date.now() + ms;
  while (!(await ok()) && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
}

// How a decision judges the nodes said to a call is the learning loop's verdict (archipelago-loop, test/verdict-call.test.ts).
test("an answer may name the item it made: the run says so", async () => {
  const { errors, ask, read } = await setup();
  const out = await ask.ask({ title: "made", places: ["check:line_length", "finding"], parent: "checker" }, async () => ({ text: "made t9", follow: { item: "t9", version: "v1" } }));
  const run = (await read.runs()).items.find((r) => r.run === out.run)!;
  assert.deepEqual([run.facts?.harness, run.facts?.item, run.facts?.version], ["call", "t9", "v1"]);
  assert.deepEqual(errors, []);
});

test("a person's decision on the item a call follows is recorded on its run, once per decision at its version", async () => {
  const { rt, errors, ask, read, act } = await setup();
  await act("seed.raw", { facts: [["+", "t1", "type", "test"], ["+", "t1", "version", "v1"]] });
  const out = await ask.ask({ title: "line_length", places: ["check:line_length", "finding"], parent: "checker", follow: { item: "t1", version: "v1" } }, async () => ({ text: "long line" }));

  const startedAt = (await read.runs()).items.find((r) => r.run === out.run)!.started;
  await act("seed.raw", { facts: [["+", "t1", "decision", "rejected"], ["+", "t1", "decided_version", "v1"]] });
  await rt.settle();
  await until(async () => {
    const evs = (await read.events(out.run)).items;
    const at = evs.findIndex((e) => e.kind === "act" && e.act?.kind === "decision");
    return at >= 0 && evs.slice(at).some((e) => e.kind === "end");
  });
  const evs = (await read.events(out.run)).items;
  const d = evs.find((e) => e.kind === "act" && e.act?.kind === "decision")!;
  assert.deepEqual([d.place, d.act!.by, d.act!.ok], ["reply_end", "person", false]);
  const run = (await read.runs()).items.find((r) => r.run === out.run)!;
  // Times are to the millisecond: on a fast runner the ask and the decision may share one, so the start is compared, not ordered.
  assert.ok(run.ended && run.started === startedAt && run.started <= run.ended, "begun again for the decision, then ended; its start kept");

  // A change of mind: accepted at the same version.
  await act("seed.raw", { facts: [["-", "t1", "decision", "rejected"], ["+", "t1", "decision", "accepted"]] });
  await rt.settle();
  await until(async () => (await read.events(out.run)).items.filter((e) => e.act?.kind === "decision").length === 2);
  assert.deepEqual((await read.events(out.run)).items.filter((e) => e.act?.kind === "decision").map((e) => e.act!.ok), [false, true]);

  // A decision at another version isn't this call's.
  const before = (await read.events(out.run)).items.length;
  await act("seed.raw", { facts: [["-", "t1", "decided_version", "v1"], ["+", "t1", "decided_version", "v2"]] });
  await rt.settle();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal((await read.events(out.run)).items.length, before);
  assert.deepEqual(errors, []);
});

test("call.decide records a decision by hand, and refuses a run that isn't a call", async () => {
  const { ask, read, act } = await setup();
  const out = await ask.ask({ title: "x", places: ["finding"], parent: "p" }, async () => ({ text: "x" }));
  const ok = await act("call.decide", { run: out.run, decision: "accepted" });
  assert.ok(ok.ok, JSON.stringify(ok));
  assert.equal((await read.events(out.run)).items.filter((e) => e.act?.kind === "decision").length, 1);
  const no = await act("call.decide", { run: "p", decision: "accepted" });
  assert.equal(no.ok, false);
});
