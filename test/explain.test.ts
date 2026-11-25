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
import { scripted } from "../plugins/typed/model.ts";
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

async function map(model: unknown) {
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const modules: Record<string, Plugin> = { graph, action, types, work, question, record, actor, links, items, schema, history, exchange, agent, call, typed, game, explain, voice, probe };
  const BASE = "mem:/plugins/";
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length)] }) });
  const tree: Entry[] = Object.keys(modules).map((id) => ({ id, plugin: id, ...(id === "explain" && model ? { config: { model } } : {}) }));
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
  return { call: call_, ok, read, exchange: ctx.get<ExchangeRead>("exchange.read"), errors, item: async (id: string) => (await read.get([id]))[0]!, done: () => loader.apply([]) };
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
