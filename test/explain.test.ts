import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionInvoke } from "../spec/action.ts";
import type { AgentNode, NodeDef } from "../spec/agent.ts";
import type { ExchangeRead } from "../spec/exchange.ts";
import type { GraphRead } from "../spec/graph.ts";
import { Runtime, type Plugin } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import action from "../plugins/action/index.ts";
import actor from "../plugins/actor/index.ts";
import agent from "../plugins/agent/index.ts";
import call from "../plugins/call/index.ts";
import exchange from "../plugins/exchange/index.ts";
import graph from "../plugins/graph/index.ts";
import history from "../plugins/history/index.ts";
import items from "../plugins/items/index.ts";
import links from "../plugins/links/index.ts";
import question from "../plugins/question/index.ts";
import record from "../plugins/record/index.ts";
import schema from "../plugins/schema/index.ts";
import typed from "../plugins/typed/index.ts";
import { scripted, type Model } from "../plugins/typed/model.ts";
import types from "../plugins/types/index.ts";
import work from "../plugins/work/index.ts";
import game from "../plugins/game/index.ts";
import explain, { PLACE, promptOf } from "../plugins/game/explain.ts";
import { analyze, versionOf } from "../plugins/game/analysis.ts";

/** A node at game:explain: the map's say in the explanation's voice. */
const voice: Plugin = {
  id: "voice",
  inject: ["agent.node"],
  apply(ctx) {
    const def: NodeDef = { name: "plain", kind: "rule", title: "plain", at: [PLACE], speak: () => ({ say: "Write for a shop owner, not an economist." }) };
    ctx.get<AgentNode>("agent.node").node(def);
  },
};
const probe: Plugin = { id: "probe", inject: ["action.invoke", "graph.read", "exchange.read"], apply() {} };

async function map(model: Model | undefined, more: { models?: Record<string, Model>; env?: Record<string, string> } = {}) {
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const modules: Record<string, Plugin> = { graph, action, types, work, question, record, actor, links, items, schema, history, exchange, agent, call, typed, game, explain, voice, probe };
  const BASE = "mem:/plugins/";
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length)] }) });
  const tree: Entry[] = Object.keys(modules).map((id) => ({ id, plugin: id, ...(id === "typed" ? { config: { models: { ...(model ? { default: model } : {}), ...(more.models ?? {}) }, ...(model ? { model: "default" } : {}), env: more.env ?? {} } } : {}) }));
  await loader.apply(tree);
  await rt.settle();
  const ctx = loader.fiber("probe")!.ctx.intercept({ actor: { id: "person:me", kind: "person" } });
  const invoke = ctx.get<ActionInvoke>("action.invoke");
  const read = ctx.get<GraphRead>("graph.read");
  const call_ = (name: string, input: unknown) => invoke.invoke<any>({ action: name, input: input as never, authority: { of: "human", basis: "test" }, reason: "test" });
  const ok = async (name: string, input: unknown) => {
    const out = await call_(name, input);
    if (!out.ok) assert.fail(`${name} refused: ${out.refused.code} ${out.refused.message}`);
    return out as { ok: true; output: any; change?: string };
  };
  const as = (actor: { id: string; kind: "agent" | "person" }, run: string) => loader.fiber("probe")!.ctx.intercept({ actor, run }).get<ActionInvoke>("action.invoke");
  return { call: call_, ok, read, as, exchange: ctx.get<ExchangeRead>("exchange.read"), errors, item: async (id: string) => (await read.get([id]))[0]!, done: () => loader.apply([]) };
}

const STANDOFF = {
  title: "Pricing standoff",
  note: "Two firms, one market, one season.",
  players: [{ name: "North", strategies: ["High", "Low"] }, { name: "South", strategies: ["High", "Low"] }],
  payoffs: [
    { profile: ["High", "High"], payoff: [10, 10] },
    { profile: ["High", "Low"], payoff: [2, 12] },
    { profile: ["Low", "High"], payoff: [12, 2] },
    { profile: ["Low", "Low"], payoff: [5, 5] },
  ],
};

test("the prompt holds the situation, who plays, the outcomes and the analysis", () => {
  const g = { players: STANDOFF.players, payoffs: STANDOFF.payoffs };
  const p = promptOf("Pricing standoff", "Two firms.", g, analyze(g), { North: "North Ltd" });
  assert.match(p, /The situation: Pricing standoff\nTwo firms\./);
  assert.match(p, /- North \(on the map: North Ltd\): can High or Low/);
  assert.match(p, /- North Low, South High → North 12, South 2/);
  assert.match(p, /- Pure equilibria: \(Low, Low\) paying 5, 5\./);
  assert.equal(versionOf(g), versionOf(JSON.parse(JSON.stringify(g))));
  assert.notEqual(versionOf(g), versionOf({ ...g, payoffs: g.payoffs.slice(1) }));
});

test("explain.game: the model's words kept about the game, the call recorded, a person's decision judging it", async () => {
  const model = scripted([
    { items: [{ ref: "e", title: "Both firms will cut, though both would rather not", note: "Each fears being undercut, so each cuts first." }] },
    { items: [{ ref: "e", title: "Holding high now pays", note: "Loyal customers change the sums." }] },
  ]);
  const m = await map(model);
  const g = (await m.ok("game.create", STANDOFF)).output.id;
  const out = await m.ok("explain.game", { game: g });
  assert.equal(out.output.title, "Both firms will cut, though both would rather not");

  // What the model was told: the built-in voice, the node at game:explain, and the game.
  assert.match(model.asked[0]!.system, /not game theorists/);
  assert.match(model.asked[0]!.system, /Write for a shop owner, not an economist\./);
  assert.match(model.asked[0]!.messages[0]!.content, /Pure equilibria: \(Low, Low\)/);

  const e = await m.item(out.output.id);
  assert.equal(e.type, "explanation");
  assert.equal(e.fields.status, "current");
  assert.equal(e.fields.version, out.output.version);
  const about = await m.read.links(g, { type: "about", dir: "in" });
  assert.deepEqual(about.items.map((l) => l.from), [e.id]);

  // A person accepts it: recorded at its version, and the call's run hears the decision.
  await m.ok("explain.decide", { explanation: e.id, decision: "accepted" });
  assert.equal((await m.item(e.id)).fields.decided_version, out.output.version);
  let acts: string[] = [];
  for (let i = 0; i < 50 && !acts.includes("decision"); i++) {
    await new Promise((r) => setTimeout(r, 10));
    acts = (await m.exchange.events(out.output.run)).items.map((ev) => ev.act?.kind ?? "");
  }
  assert.ok(acts.includes("decision"), `the call heard the decision: ${acts.join(",")}`);

  // The game changes; explaining again supersedes the old explanation, and undo brings it back.
  await m.ok("game.payoff", { game: g, cells: [{ profile: ["High", "Low"], payoff: [6, 12] }] });
  const next = await m.ok("explain.game", { game: g });
  assert.notEqual(next.output.version, out.output.version);
  assert.deepEqual(next.output.superseded, [e.id]);
  assert.equal((await m.item(e.id)).fields.status, "superseded");
  await m.ok("history.undo", { change: next.change });
  assert.equal((await m.item(e.id)).fields.status, "current");
  assert.equal(await m.item(next.output.id), null);
  assert.deepEqual(m.errors, []);
  await m.done();
});

test("refused plainly: an incomplete game, no model, a wrong decision", async () => {
  const m = await map(undefined);
  const g = (await m.ok("game.create", { ...STANDOFF, payoffs: STANDOFF.payoffs.slice(0, 2) })).output.id;
  const r1 = await m.call("explain.game", { game: g });
  assert.equal(r1.ok, false);
  assert.equal(r1.refused.code, "explain.incomplete");
  await m.ok("game.payoff", { game: g, cells: STANDOFF.payoffs.slice(2) });
  const r2 = await m.call("explain.game", { game: g });
  assert.equal(r2.ok, false);
  assert.equal(r2.refused.code, "typed.no_model");
  const r3 = await m.call("explain.decide", { explanation: g, decision: "accepted" });
  assert.equal(r3.ok ? "" : r3.refused.code, "explain.not_a_explanation");
  await m.done();
});

test("a call chooses its model by spec through typed.ask: used, recorded, refused when it can't be had", async () => {
  const cheap = scripted([{ items: [{ ref: "e", title: "Short", note: "Both cut." }] }], "cheap");
  const fallback = scripted([], "fallback");
  const m = await map(fallback, { models: { "anthropic:claude-haiku-5-5": cheap }, env: { ANTHROPIC_API_KEY: "test-key" } });
  const g = (await m.ok("game.create", STANDOFF)).output.id;
  const out = await m.ok("explain.game", { game: g, model: "anthropic:claude-haiku-5-5" });
  assert.equal(out.output.model, "anthropic:claude-haiku-5-5");
  assert.equal(cheap.asked.length, 1);
  assert.equal(fallback.asked.length, 0);
  assert.equal((await m.item(out.output.id)).fields.model, "anthropic:claude-haiku-5-5");
  const run = (await m.exchange.runs()).items.find((r) => r.run === out.output.run)!;
  assert.equal(run.facts?.model, "cheap", "the call's run names the model it asked");

  const bad = await m.call("explain.game", { game: g, model: "nope:x" });
  assert.equal(bad.ok ? "" : bad.refused.code, "typed.model");
  assert.match(bad.ok ? "" : bad.refused.message, /No model nope:x/);

  // What is offered, and whether each key is there: never the key.
  const list = await m.ok("typed.models", {});
  assert.equal(list.output.default, "fallback");
  assert.deepEqual(list.output.choices.map((c: any) => [c.spec, c.ready]), [
    ["anthropic:claude-haiku-5-5", true], ["anthropic:claude-sonnet-5-5", true], ["anthropic:claude-opus-5-5", true], ["claude", true],
  ]);
  assert.ok(!JSON.stringify(list.output).includes("test-key"));
  await m.done();

  // No key on the server: offered, not ready, and refused naming the variable.
  const n = await map(undefined);
  const g2 = (await n.ok("game.create", STANDOFF)).output.id;
  const none = (await n.ok("typed.models", {})).output;
  assert.deepEqual([none.default, none.choices[0].ready, none.choices[0].key], [null, false, "ANTHROPIC_API_KEY"]);
  const r = await n.call("explain.game", { game: g2, model: "anthropic:claude-haiku-5-5" });
  assert.match(r.ok ? "" : r.refused.message, /set ANTHROPIC_API_KEY/);
  await n.done();
});

test("the agent's own call: under its run, who asked recorded, and a misfit refused with what a fix needs", async () => {
  const bad = scripted([{ wrong: true }, { still: "wrong" }], "bad");
  const m = await map(bad);
  const g = (await m.ok("game.create", STANDOFF)).output.id;
  // As an agent in its run, the way act calls it.
  const asAgent = m.as({ id: "claude-code", kind: "agent" }, "run-7");
  const out = await asAgent.invoke<any>({ action: "explain.game", input: { game: g }, authority: { of: "agent", basis: "test" }, reason: "test" });
  assert.equal(out.ok, false);
  const r = out.ok ? undefined : out.refused;
  assert.equal(r!.code, "explain.misfit");
  const detail = r!.detail as { run: string; attempts: number };
  assert.equal(detail.attempts, 2);
  assert.match(r!.message, /didn't fit the map after 2 attempts/);
  assert.match(r!.message, new RegExp(`act typed\.get \{ "run": "${detail.run}" \}`));
  assert.match(r!.message, /Fixes: .*itemsOf.*game:explain/);
  const run = (await m.exchange.runs()).items.find((x) => x.run === detail.run)!;
  assert.deepEqual([run.facts?.parent, run.facts?.asked_by, run.facts?.asked_kind, run.facts?.about], ["run-7", "claude-code", "agent", g]);

  // A person's call names the session they work with as its parent.
  const asPerson = await m.call("explain.game", { game: g, parent: "run-7" });
  assert.equal(asPerson.ok, false);
  const pr = (await m.exchange.runs()).items.find((x) => x.run === (asPerson.ok ? "" : (asPerson.refused.detail as any).run))!;
  assert.deepEqual([pr.facts?.parent, pr.facts?.asked_kind], ["run-7", "person"]);
  await m.done();
});
