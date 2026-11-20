import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionInvoke, ActionRegister } from "../spec/action.ts";
import type { AgentRun, AgentTree } from "../spec/agent.ts";
import type { Fact } from "../spec/changeset.ts";
import type { Json } from "../spec/common.ts";
import type { ExchangeRead } from "../spec/exchange.ts";
import type { GraphRead } from "../spec/graph.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import action from "../packs/action/index.ts";
import agent from "../packs/agent/index.ts";
import exchange from "../packs/exchange/index.ts";
import graph from "../packs/graph/index.ts";
import keep, { overlap, standing, wordsProblems, type Review } from "../packs/keep/index.ts";
import verdict from "../packs/verdict/index.ts";
import words from "../packs/words/index.ts";

const T = "2026-11-20T16:00:00.000Z";
const rec = (runs: number, held: number, failed: number) => ({ said: runs * 3, runs, held, failed, quiet: runs - held - failed });
const n = { id: "n_b", at: ["tool:Bash"], words: "Check res.status before JSON.parse and back off on 429." };

test("standing: promote on held runs, retire when failing, idle or a duplicate, else stay on trial", () => {
  assert.equal(standing(n, undefined, []).state, "trial");
  assert.deepEqual([standing(n, rec(4, 3, 0), []).state, standing(n, rec(4, 3, 0), []).rule], ["promote", "held"]);
  assert.equal(standing(n, rec(5, 3, 2), []).state, "trial", "failures above a third of the held runs block a promotion");
  assert.deepEqual([standing(n, rec(3, 0, 2), []).state, standing(n, rec(3, 0, 2), []).rule], ["retire", "failing"]);
  assert.deepEqual([standing(n, rec(12, 0, 0), []).state, standing(n, rec(12, 0, 0), []).rule], ["retire", "idle"]);
  assert.equal(standing(n, rec(11, 0, 0), []).state, "trial");
  assert.match(standing(n, rec(2, 1, 0), []).why, /2 more held runs to promote/);
  const peer = { id: "n_a", title: "Back off on 429", at: ["tool:Bash"], words: "On 429, back off; check res.status before JSON.parse.", kept: false };
  assert.ok(overlap(n.words, peer.words) >= 0.6);
  const dup = standing(n, rec(1, 0, 0), [peer]);
  assert.deepEqual([dup.state, dup.rule, dup.of], ["retire", "duplicate", "n_a"]);
  assert.equal(standing({ ...peer, id: "n_a" }, rec(1, 0, 0), [{ ...n, title: "b", kept: false }]).state, "trial", "the older of two trials stays");
  assert.equal(standing(n, rec(1, 0, 0), [{ ...peer, at: ["tool:Edit"] }]).state, "trial", "a duplicate shares a place");
});

test("words checks: empty, too long, a home folder, a secret, the trial mark", () => {
  assert.deepEqual(wordsProblems("Use Read, not cat."), []);
  assert.deepEqual(wordsProblems("Spawn node without shell; its path has C:\\Program Files in it."), []);
  assert.match(wordsProblems("")[0]!, /no words/);
  assert.match(wordsProblems("x".repeat(1300))[0]!, /1300 characters/);
  assert.match(wordsProblems("Run C:\\Users\\someone\\x.mjs")[0]!, /home folder/);
  assert.match(wordsProblems("see /home/someone/x")[0]!, /home folder/);
  assert.match(wordsProblems("token ghp_abcdefghijklmnopqrstuvwxyz0123")[0]!, /secret/);
  assert.match(wordsProblems("(Trial) hi", "(Trial)")[0]!, /trial mark/);
});

// --- Through the agent, on the map ---

const probe: Pack = {
  id: "probe",
  inject: ["agent.run", "agent.tree", "action.invoke", "action.register", "graph.read", "exchange.read"],
  apply(ctx) {
    // Stands in for grow.trial's fields, and for the schema pack's quarantine.
    ctx.get<ActionRegister>("action.register").register({
      name: "probe.write",
      title: "write facts",
      input: { type: "object" },
      async run(input: { facts: Fact[] }, call) {
        call.write(input.facts);
        return {};
      },
    });
  },
};

async function setup(config: Record<string, unknown> = {}, extra: Pack[] = []) {
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const modules: Record<string, Pack> = { graph, action, exchange, agent, verdict, words: words as Pack, keep: keep as Pack, probe };
  for (const p of extra) modules[p.id] = p;
  const BASE = "mem:/packs/";
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length)] }) });
  const tree: Entry[] = ["graph", "action", "exchange", "agent", "verdict", "words", ...extra.map((p) => p.id), "probe", "keep"].map((id) => ({ id, pack: id, ...(id === "keep" ? { config } : {}) }));
  await loader.apply(tree);
  await rt.settle();
  assert.deepEqual(errors, []);
  const ctx = (run?: string) => loader.fiber("probe")!.ctx.intercept(run ? { actor: { id: "e_agent", kind: "agent" }, run } : { actor: { id: "person:owner", kind: "person" } });
  const invoke = (a: string, input: Record<string, unknown>, run?: string): Promise<any> =>
    ctx(run).get<ActionInvoke>("action.invoke").invoke<any>({ action: a, input: input as Json, authority: { of: "human", basis: "test" }, reason: "test" });
  const trial = async (words_: string, misses: string) => {
    const out = await invoke("words.add", { title: words_.slice(0, 30), at: ["tool:Bash"], words: words_ });
    assert.ok(out.ok, JSON.stringify(out));
    const id = out.output.node as string;
    assert.ok((await invoke("probe.write", { facts: [["+", id, "status", "trial"], ["+", id, "misses", misses]] })).ok);
    await rt.settle();
    return id;
  };
  /** A run that hears the Bash nodes, then makes one Bash call: failed with `out`, or worked. */
  const runOnce = async (run: string, out: string, ok: boolean) => {
    const r = ctx(run).get<AgentRun>("agent.run");
    await r.begin({ run, agent: { id: "e_agent", kind: "agent" }, harness: "test", reaches: [] });
    const said = await r.reach({ run, places: ["tool:Bash"], time: T });
    await r.act({ run, place: "tool:Bash", time: T, kind: "tool", by: "agent", input: { command: "curl x" }, output: out, ok });
    return said;
  };
  const item = async (id: string) => (await ctx().get<GraphRead>("graph.read").get([id]))[0]!;
  const settle = async () => {
    await new Promise((r) => setTimeout(r, 700));
    await rt.settle();
  };
  return { rt, loader, errors, ctx, invoke, trial, runOnce, item, settle, tree: ctx().get<AgentTree>("agent.tree") };
}

test("a trial whose miss keeps coming is retired by its record, with why; one that holds is promoted", async () => {
  const { errors, invoke, trial, runOnce, item, settle } = await setup({ promote: 2, fail: 2 });
  const bad = await trial("Retry the server call.", "server answered 429 empty body");
  const good = await trial("Check for a lock file first.", "database is locked by another process");
  for (const run of ["r1", "r2"]) await runOnce(run, "server answered 429 empty body", false);
  // The lock situation comes up and goes right: a near miss, held.
  for (const run of ["r3", "r4"]) await runOnce(run, "Database is locked by another process; waited 2s, opened.", true);
  await settle();
  const b = await item(bad);
  assert.equal(b.fields.status, "retired");
  assert.equal((b.fields.decided as any).rule, "failing");
  assert.equal((b.fields.decided as any).by, "pack:keep");
  assert.equal((b.fields.decided as any).record.failed, 2);
  const g = await item(good);
  assert.equal(g.fields.status, undefined, "promoted: said as kept");
  assert.equal((g.fields.decided as any).rule, "held");
  const review = (await invoke("keep.review", {})).output as Review;
  assert.deepEqual(review.nodes.map((x) => [x.item, x.status, x.decided?.state]).sort(), [[bad, "retired", "retire"], [good, "kept", "promote"]].sort());
  assert.equal(review.thresholds.promote, 2);
  assert.deepEqual(errors, []);
});

test("apply: false shows the standing and changes nothing", async () => {
  const { invoke, trial, runOnce, item, settle } = await setup({ apply: false, fail: 1 });
  const bad = await trial("Retry the server call.", "server answered 429 empty body");
  await runOnce("r1", "server answered 429 empty body", false);
  await settle();
  assert.equal((await item(bad)).fields.status, "trial");
  const r = (await invoke("keep.review", { node: bad })).output as Review;
  assert.equal(r.apply, false);
  assert.deepEqual([r.nodes[0]!.standing?.state, r.nodes[0]!.record?.failed], ["retire", 1]);
});

test("a run can't rewrite, promote or retire a node that failed in it; another run, or a person, can", async () => {
  const { invoke, trial, runOnce, item } = await setup({ apply: false });
  const id = await trial("Retry the server call.", "server answered 429 empty body");
  await runOnce("r1", "server answered 429 empty body", false);
  for (const [a, input] of [["words.set", { node: id, words: "Never mind." }], ["words.retire", { node: id }], ["keep.apply", { node: id, state: "promote" }]] as const) {
    const out = await invoke(a, input, "r1");
    assert.equal(out.ok, false, a);
    assert.equal(out.refused.code, "keep.self_edit", a);
  }
  assert.equal((await item(id)).fields.words, "Retry the server call.");
  await runOnce("r2", "all fine", true);
  assert.ok((await invoke("words.set", { node: id, words: "Back off on 429." }, "r2")).ok, "a run it didn't fail in may");
  assert.ok((await invoke("keep.apply", { node: id, state: "retire", why: "test" })).ok, "a person may");
  assert.equal((await item(id)).fields.status, "retired");
});

test("a quarantined node, or one whose words fail their check, never reaches a run; the gate says why", async () => {
  let heldId = "";
  const schemaStub: Pack = {
    id: "schema",
    inject: ["action.register"],
    apply(ctx) {
      ctx.get<ActionRegister>("action.register").register({
        name: "schema.quarantined",
        title: "held",
        input: { type: "object" },
        async run() {
          return { items: heldId ? [{ id: "q1", change: { facts: [["+", heldId, "kind", 7]] }, problems: [{ message: "kind is text." }] }] : [] } as unknown as Json;
        },
      });
    },
  };
  const { ctx, invoke, item } = await setup({ apply: false }, [schemaStub]);
  const add = async (w: string) => (await invoke("words.add", { title: w.slice(0, 20), at: ["tool:Bash"], words: w })).output.node as string;
  const fine = await add("Prefer Read.");
  const local = await add("Run C:\\Users\\someone\\scratch\\x.mjs first.");
  heldId = await add("Held one.");
  const r = ctx("g1").get<AgentRun>("agent.run");
  await r.begin({ run: "g1", agent: { id: "e_agent", kind: "agent" }, harness: "test", reaches: [] });
  const said = await r.reach({ run: "g1", places: ["tool:Bash"], time: T });
  assert.deepEqual(said.said.map((s) => s.text), ["Prefer Read."]);
  const events = (await ctx().get<ExchangeRead>("exchange.read").events("g1", { limit: 100 })).items.filter((e) => e.kind === "gated");
  assert.equal(events.length, 2);
  assert.ok(events.some((e) => /home folder/.test(e.text ?? "")));
  assert.ok(events.some((e) => /quarantined as q1/.test(e.text ?? "")));
  const review = (await invoke("keep.review", { node: local })).output as Review;
  assert.match(review.nodes[0]!.checks[0]!, /home folder/);
  assert.equal((await item(fine)).fields.status, undefined);
});
