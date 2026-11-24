import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionContext, ActionInvoke, ActionRegister } from "../spec/action.ts";
import type { AgentNode, NodeDef } from "../spec/agent.ts";
import type { Fact } from "../spec/changeset.ts";
import type { ExchangeEvent, ExchangeRead } from "../spec/exchange.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import action from "../packs/action/index.ts";
import agent from "../packs/agent/index.ts";
import call, { callFacts, decisionOf, type CallAsk } from "../packs/call/index.ts";
import context from "../packs/context/index.ts";
import exchange from "../packs/exchange/index.ts";
import graph from "../packs/graph/index.ts";
import verdict, { type VerdictRead } from "../packs/verdict/index.ts";
import { judgeRun, listeningOf } from "../packs/verdict/judge.ts";

// ---------- apart from the runtime ----------

test("a call's facts: its own, then harness and parent, then the item it follows", () => {
  assert.deepEqual(callFacts({ title: "wall", places: ["check:wall"], facts: { fn: "wall", harness: "x" }, follow: { item: "t1", version: "v1" } }, "p"), { fn: "wall", harness: "call", parent: "p", item: "t1", version: "v1" });
});

test("a decision counts only at the call's version", () => {
  assert.equal(decisionOf({ decision: "rejected", decided_version: "v1" }, "v1"), "rejected");
  assert.equal(decisionOf({ decision: "rejected", decided_version: "v0" }, "v1"), null);
  assert.equal(decisionOf({ decided_version: "v1" }, "v1"), null);
});

const T = (s: number) => `2026-11-24T10:00:${String(s).padStart(2, "0")}.000Z`;
const ev = (seq: number, e: Partial<ExchangeEvent>): ExchangeEvent => ({ id: `c:${seq}`, run: "c", seq, time: T(seq), direction: "to_agent", kind: "say", ...e }) as ExchangeEvent;
const decision = (seq: number, ok: boolean) => ev(seq, { kind: "act", direction: "from_agent", place: "reply_end", act: { kind: "decision", by: "person", ok } });

test("verdict: a rejected answer fails every node said to it, an accepted one holds them, the last decision wins", () => {
  const listening = listeningOf([{ id: "w/hint", at: ["check:*"] }, { id: "w/finding", at: ["finding"] }]);
  const said = [ev(1, { node: "w/hint", place: "check:wall" }), ev(2, { node: "w/finding", place: "finding" }), ev(3, { kind: "act", direction: "from_agent", place: "reply_end", act: { kind: "reply", by: "agent", ok: true } })];
  assert.deepEqual(judgeRun("c", said, listening).map((v) => v.verdict), ["quiet", "quiet"]);
  assert.deepEqual(judgeRun("c", [...said, decision(4, false)], listening).map((v) => [v.verdict, v.failed_by]), [["failed", [4]], ["failed", [4]]]);
  assert.deepEqual(judgeRun("c", [...said, decision(4, true)], listening).map((v) => v.verdict), ["held", "held"]);
  assert.deepEqual(judgeRun("c", [...said, decision(4, false), decision(5, true)], listening).map((v) => v.verdict), ["held", "held"]);
  // A tool decision (Claude Code's allow or deny) stays as it was: a miss only where it is covered.
  const deny = ev(4, { kind: "act", direction: "from_agent", place: "tool:Bash", act: { kind: "decision", by: "person", ok: false } });
  assert.deepEqual(judgeRun("c", [...said, deny], listening).map((v) => v.verdict), ["quiet", "quiet"]);
});

// ---------- through the runtime ----------

const nodes: Pack = {
  id: "nodes",
  inject: ["agent.node"],
  apply(ctx) {
    const reg = ctx.get<AgentNode>("agent.node");
    const def = (name: string, at: string[], say: string): NodeDef => ({ name, kind: "reflex", title: name, at, speak: () => ({ say }) });
    reg.node(def("wall", ["check:wall_thickness"], "Name the face and the measured wall."));
    reg.node(def("finding", ["finding"], "Say what to change, in one line."));
    reg.node(def("other", ["check:draft"], "Not for walls."));
  },
};

/** A domain: its judge asks through call.ask. */
const domain: Pack = { id: "domain", inject: ["call.ask"], apply() {} };
const probe: Pack = { id: "probe", inject: ["exchange.read", "verdict.read", "action.invoke"], apply() {} };
const seed: Pack = {
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
  const modules: Record<string, Pack> = { graph, action, exchange, agent, nodes, call, verdict, context, domain, probe, seed };
  const BASE = "mem:/packs/";
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length)]! }) });
  const tree: Entry[] = ["graph", "action", "exchange", "agent", "nodes", "call", "verdict", "context", "domain", "probe", "seed"].map((id) => ({ id, pack: id }));
  await loader.apply(tree);
  await rt.settle();
  const ask = loader.fiber("domain")!.ctx.get<CallAsk>("call.ask");
  const p = loader.fiber("probe")!.ctx;
  const read = p.get<ExchangeRead>("exchange.read");
  const verdicts = p.get<VerdictRead>("verdict.read");
  const invoke = p.get<ActionInvoke>("action.invoke");
  const act = (name: string, input: unknown) => invoke.invoke({ action: name, input: input as never, authority: { of: "human", basis: "test" }, reason: "test" });
  return { rt, errors, ask, read, verdicts, act };
}

test("a call is a run under its parent: begun, said to at its places, answered, ended", async () => {
  const { rt, errors, ask, read } = await setup();
  let heard: string[] = [];
  const out = await ask.ask({ title: "wall_thickness", places: ["check:wall_thickness", "finding"], parent: "checker", facts: { fn: "wall_thickness" } }, async ({ said }) => {
    heard = said.map((s) => s.node);
    return { text: "Face 14 is 0.8 mm; make it 1.2 mm.", subject: { type: "part geometry", tokens: 900 }, usage: { input: 1200, output: 40 } };
  });
  assert.deepEqual(heard, ["nodes/wall", "nodes/finding"]);
  const run = (await read.runs()).items.find((r) => r.run === out.run)!;
  assert.equal(run.facts?.harness, "call");
  assert.equal(run.facts?.parent, "checker");
  assert.equal(run.title, "wall_thickness");
  assert.ok(run.ended);
  const evs = (await read.events(out.run)).items;
  assert.deepEqual(evs.map((e) => [e.kind, e.place ?? ""]), [["begin", ""], ["say", "check:wall_thickness"], ["say", "finding"], ["act", "reply_end"], ["end", ""]]);
  const reply = evs[3]!.act!;
  assert.deepEqual(reply.input, { subject: { type: "part geometry", tokens: 900 } }, "the subject by its type and size only");
  assert.equal((reply.output as { text: string }).text, "Face 14 is 0.8 mm; make it 1.2 mm.");
  await rt.settle();
  assert.deepEqual(errors, []);
});

test("the window of a call: the map's words, the subject by its size, the answer; the model's own count as the total", async () => {
  const { errors, ask, act } = await setup();
  const out = await ask.ask({ title: "wall_thickness", places: ["check:wall_thickness", "finding"], parent: "checker" }, async () => ({ text: "ok", subject: { type: "part geometry", tokens: 900 }, usage: { input: 1200, output: 40 } }));
  const w = await act("context.window", { run: out.run });
  assert.ok(w.ok, JSON.stringify(w));
  const win = w.output as { total: { tokens: number; from: string }; sources: Record<string, number>; parts: { id: string; source: string; tokens: number }[] };
  assert.deepEqual(win.total, { tokens: 1240, from: "usage" });
  assert.equal(win.sources.subject, 900);
  assert.ok((win.sources.map ?? 0) > 0);
  assert.deepEqual(win.parts.find((p) => p.source === "subject"), { id: "subject:part geometry", title: "part geometry", source: "subject", channel: "context", state: "said", tokens: 900, count: 1, fitted: 0 });
  assert.deepEqual(errors, []);
});

test("without a parent, a pack's calls go under its own run of calls", async () => {
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

test("a person's decision on the item a call follows becomes the verdict of the nodes said to it", async () => {
  const { rt, errors, ask, read, verdicts, act } = await setup();
  await act("seed.raw", { facts: [["+", "t1", "type", "test"], ["+", "t1", "version", "v1"]] });
  const out = await ask.ask({ title: "wall_thickness", places: ["check:wall_thickness", "finding"], parent: "checker", follow: { item: "t1", version: "v1" } }, async () => ({ text: "thin wall" }));
  assert.deepEqual((await verdicts.run(out.run)).map((v) => [v.node, v.verdict]), [["nodes/wall", "quiet"], ["nodes/finding", "quiet"]]);

  await act("seed.raw", { facts: [["+", "t1", "decision", "rejected"], ["+", "t1", "decided_version", "v1"]] });
  await rt.settle();
  await new Promise((r) => setTimeout(r, 20));
  const evs = (await read.events(out.run)).items;
  const d = evs.find((e) => e.kind === "act" && e.act?.kind === "decision")!;
  assert.deepEqual([d.place, d.act!.by, d.act!.ok], ["reply_end", "person", false]);
  assert.deepEqual((await verdicts.run(out.run)).map((v) => v.verdict), ["failed", "failed"]);
  const run = (await read.runs()).items.find((r) => r.run === out.run)!;
  assert.ok(run.ended && run.started < run.ended, "begun again for the decision, then ended; its start kept");

  // A change of mind: accepted at the same version.
  await act("seed.raw", { facts: [["-", "t1", "decision", "rejected"], ["+", "t1", "decision", "accepted"]] });
  await rt.settle();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual((await verdicts.run(out.run)).map((v) => v.verdict), ["held", "held"]);

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
