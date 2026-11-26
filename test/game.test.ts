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
import game from "../plugins/game/index.ts";
import { analyze, profiles, readGame, type Game } from "../plugins/game/analysis.ts";
import { parsePayoff } from "../plugins/game/view.ts";

// ---- the reasoning, pure ----

const two = (a: [string, string[]], b: [string, string[]], cells: [string, string, number, number][]): Game => ({
  players: [{ name: a[0], strategies: a[1] }, { name: b[0], strategies: b[1] }],
  payoffs: cells.map(([x, y, u, v]) => ({ profile: [x, y], payoff: [u, v] })),
});

const PD = two(["Ann", ["Quiet", "Talk"]], ["Bo", ["Quiet", "Talk"]], [
  ["Quiet", "Quiet", -1, -1],
  ["Quiet", "Talk", -3, 0],
  ["Talk", "Quiet", 0, -3],
  ["Talk", "Talk", -2, -2],
]);

test("prisoner's dilemma: one equilibrium, both talk, and it is a dilemma", () => {
  const a = analyze(PD);
  assert.equal(a.complete, true);
  assert.deepEqual(a.nash, [{ profile: ["Talk", "Talk"], payoff: [-2, -2], pareto_dominated_by: ["Quiet", "Quiet"] }]);
  assert.deepEqual(a.dominated, [
    { player: "Ann", strategy: "Quiet", by: "Talk", strictly: true },
    { player: "Bo", strategy: "Quiet", by: "Talk", strictly: true },
  ]);
  assert.deepEqual(a.survives, { Ann: ["Talk"], Bo: ["Talk"] });
  assert.deepEqual(a.pareto, [["Quiet", "Quiet"], ["Quiet", "Talk"], ["Talk", "Quiet"]]);
  assert.equal(a.mixed, null);
  assert.deepEqual(a.best_responses.filter((b) => b.player === "Ann"), [
    { player: "Ann", against: [null, "Quiet"], best: ["Talk"] },
    { player: "Ann", against: [null, "Talk"], best: ["Talk"] },
  ]);
  assert.ok(a.summary.some((l) => l.includes("a dilemma")));
});

test("matching pennies: no pure equilibrium, each mixes half and half", () => {
  const a = analyze(two(["Row", ["H", "T"]], ["Col", ["H", "T"]], [
    ["H", "H", 1, -1],
    ["H", "T", -1, 1],
    ["T", "H", -1, 1],
    ["T", "T", 1, -1],
  ]));
  assert.deepEqual(a.nash, []);
  assert.deepEqual(a.mixed, { mix: [{ H: 0.5, T: 0.5 }, { H: 0.5, T: 0.5 }], expected: [0, 0] });
  assert.match(a.summary[0]!, /No pure-strategy equilibrium/);
});

test("a coordination game: two pure equilibria and a mixed one between them", () => {
  const a = analyze(two(["Ann", ["Opera", "Match"]], ["Bo", ["Opera", "Match"]], [
    ["Opera", "Opera", 2, 1],
    ["Opera", "Match", 0, 0],
    ["Match", "Opera", 0, 0],
    ["Match", "Match", 1, 2],
  ]));
  assert.deepEqual(a.nash.map((e) => e.profile), [["Opera", "Opera"], ["Match", "Match"]]);
  // Ann makes Bo indifferent: Opera 2/3; Bo makes Ann indifferent: Opera 1/3.
  assert.deepEqual(a.mixed, { mix: [{ Opera: 0.6667, Match: 0.3333 }, { Opera: 0.3333, Match: 0.6667 }], expected: [0.6667, 0.6667] });
  assert.deepEqual(a.dominated, []);
});

test("weak dominance, and iterated removal that needs more than one round", () => {
  // Col's R is strictly dominated by M; once it goes, Row's D is strictly dominated by U.
  const a = analyze(two(["Row", ["U", "D"]], ["Col", ["L", "M", "R"]], [
    ["U", "L", 1, 0], ["U", "M", 1, 2], ["U", "R", 0, 1],
    ["D", "L", 0, 3], ["D", "M", 0, 1], ["D", "R", 2, 0],
  ]));
  assert.deepEqual(a.survives, { Row: ["U"], Col: ["M"] });
  assert.deepEqual(a.nash.map((e) => e.profile), [["U", "M"]]);
  assert.equal(a.mixed, undefined, "only a 2×2 game is solved for a mixed equilibrium");
  const w = analyze(two(["A", ["x", "y"]], ["B", ["l", "r"]], [["x", "l", 1, 0], ["x", "r", 1, 0], ["y", "l", 1, 0], ["y", "r", 0, 0]]));
  assert.deepEqual(w.dominated, [{ player: "A", strategy: "y", by: "x", strictly: false }]);
  assert.deepEqual(w.survives, { A: ["x", "y"], B: ["l", "r"] });
});

test("three players: every profile, and an equilibrium found by deviations", () => {
  const players = ["A", "B", "C"].map((name) => ({ name, strategies: ["in", "out"] }));
  assert.equal(profiles(players).length, 8);
  // Each gets 1 for matching the majority: everyone in, or everyone out, holds.
  const payoffs = profiles(players).map((p) => {
    const ins = p.filter((s) => s === "in").length;
    const major = ins >= 2 ? "in" : "out";
    return { profile: p, payoff: p.map((s) => (s === major ? 1 : 0)) };
  });
  const a = analyze({ players, payoffs });
  assert.deepEqual(a.nash.map((e) => e.profile), [["in", "in", "in"], ["out", "out", "out"]]);
});

test("missing payoffs: only what is missing is said", () => {
  const a = analyze({ ...PD, payoffs: PD.payoffs.slice(0, 3) });
  assert.equal(a.complete, false);
  assert.deepEqual(a.missing, [["Talk", "Talk"]]);
  assert.deepEqual(a.nash, []);
  assert.match(a.summary[0]!, /1 of 4 outcomes have no payoff/);
  assert.match(analyze({ players: [{ name: "Solo", strategies: ["x"] }], payoffs: [] }).summary[0]!, /two players/);
});

test("readGame says what doesn't fit rather than throwing", () => {
  const r = readGame({
    players: [{ name: "A", strategies: ["x", "x", "y"] }, { name: "A" }, { nope: 1 }, { name: "B", strategies: ["l"] }],
    payoffs: [{ profile: ["x", "l"], payoff: [1, 2] }, { profile: ["z", "l"], payoff: [1, 2] }, { profile: ["x", "l"], payoff: [3, 4] }, { profile: ["y"], payoff: [1] }],
  });
  assert.deepEqual(r.players, [{ name: "A", strategies: ["x", "y"] }, { name: "B", strategies: ["l"] }]);
  assert.deepEqual(r.payoffs, [{ profile: ["x", "l"], payoff: [1, 2] }]);
  assert.equal(r.problems.length, 5);
  assert.deepEqual(readGame({}), { players: [], payoffs: [], problems: [] });
});

// ---- the actions, on a map ----

const probe: Plugin = { id: "probe", inject: ["action.invoke", "graph.read"], apply() {} };

async function map() {
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const modules: Record<string, Plugin> = { graph, action, types, work, question, record, actor, links, items, schema, history, game, probe };
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

test("an agent models a pricing standoff step by step, reasons it out, and the finding is kept", async () => {
  const m = await map();
  const firm = (await m.ok("items.create", { type: "actor", title: "North Ltd" })).output.id;
  const made = await m.ok("game.create", { title: "Pricing standoff", players: [{ name: "North", strategies: ["High"], actor: firm }] });
  const g = made.output.id;
  await m.ok("game.player", { game: g, name: "South", strategies: ["High", "Low"] });
  await m.ok("game.strategy", { game: g, player: "North", strategies: ["Low"] });
  const set = await m.ok("game.payoff", {
    game: g,
    cells: [
      { profile: ["High", "High"], payoff: [10, 10] },
      { profile: { North: "High", South: "Low" }, payoff: { North: 2, South: 12 } },
      { profile: ["Low", "High"], payoff: [12, 2] },
    ],
  });
  assert.equal(set.output.missing, 1);
  await m.ok("game.payoff", { game: g, cells: [{ profile: ["Low", "Low"], payoff: [5, 5] }] });

  const it = await m.item(g);
  assert.equal(it.type, "game");
  assert.equal(it.fields.status, "open");
  assert.deepEqual(it.fields.players, [{ name: "North", strategies: ["High", "Low"] }, { name: "South", strategies: ["High", "Low"] }]);
  const plays = await m.read.links(g, { type: "plays", dir: "in" });
  assert.deepEqual(plays.items.map((l) => [l.from, l.fields.as]), [[firm, "North"]]);

  const a = await m.ok("game.analyze", { game: g });
  assert.deepEqual(a.output.nash.map((e: any) => e.profile), [["Low", "Low"]]);
  const rec = await m.item(a.output.recorded);
  assert.equal(rec.type, "record");
  assert.equal(rec.fields.kind, "finding");
  assert.equal(rec.fields.title, "Pricing standoff: equilibria (Low, Low)");
  assert.match(String(rec.fields.note), /a dilemma/);
  const about = await m.read.links(g, { type: "about", dir: "in" });
  assert.deepEqual(about.items.map((l) => l.from), [rec.id]);

  // The same analysis again writes nothing; a changed game supersedes the old finding.
  const again = await m.ok("game.analyze", { game: g });
  assert.equal(again.output.recorded, rec.id);
  assert.equal(again.change, undefined);
  await m.ok("game.payoff", { game: g, cells: [{ profile: ["Low", "Low"], payoff: [3, 3] }, { profile: ["High", "High"], payoff: [13, 13] }] });
  const next = await m.ok("game.analyze", { game: g });
  assert.deepEqual(next.output.superseded, [rec.id]);
  assert.equal((await m.item(rec.id)).fields.status, "superseded");
  assert.deepEqual(next.output.nash.map((e: any) => e.profile), [["High", "High"], ["Low", "Low"]]);

  // Only answering records nothing.
  const quiet = await m.ok("game.analyze", { game: g, record: false });
  assert.equal(quiet.output.recorded, null);
  assert.equal(quiet.change, undefined);

  // Undo takes the finding back and brings the old one back current.
  await m.ok("history.undo", { change: next.change });
  assert.equal((await m.item(rec.id)).fields.status, "current");
  assert.equal(await m.item(next.output.recorded), null);
  assert.deepEqual(m.errors, []);
  await m.done();
});

test("refusals say how to fix the call", async () => {
  const m = await map();
  const g = (await m.ok("game.create", {
    title: "Pennies",
    players: [{ name: "Row", strategies: ["H", "T"] }, { name: "Col", strategies: ["H", "T"] }],
    payoffs: [{ profile: ["H", "H"], payoff: [1, -1] }],
  })).output.id;
  const code = async (name: string, input: unknown) => {
    const out = await m.call(name, input);
    assert.equal(out.ok, false, `${name} should be refused`);
    return out.ok ? "" : `${out.refused.code}: ${out.refused.message}`;
  };
  assert.match(await code("game.payoff", { game: g, cells: [{ profile: ["H", "X"], payoff: [1, 1] }] }), /^game\.strategy_unknown: Col has no strategy X/);
  assert.match(await code("game.payoff", { game: g, cells: [{ profile: { Row: "H", Dee: "T" }, payoff: [1, 1] }] }), /^game\.player_unknown/);
  assert.match(await code("game.payoff", { game: g, cells: [{ profile: ["H", "T"], payoff: [1] }] }), /^game\.cell: A payoff has one entry per player/);
  assert.match(await code("game.player", { game: g, name: "Third" }), /^game\.shape: .*clear: true/);
  assert.match(await code("game.player", { game: g, name: "Row" }), /^game\.taken/);
  assert.match(await code("game.strategy", { game: g, player: "Row", strategies: ["H"] }), /^game\.taken/);
  const task = (await m.ok("items.create", { type: "work", title: "Not a game" })).output.id;
  assert.match(await code("game.analyze", { game: task }), /^game\.not_a_game/);
  assert.match(await code("game.create", { title: "x", players: [{ name: "A", actor: task }] }), /^game\.actor/);
  assert.match(await code("game.strategy", { game: g, player: "Row", strategies: Array.from({ length: 30 }, (_, i) => `s${i}`) }), /^game\.too_big/);

  // An incomplete game is answered with what is missing, and nothing recorded.
  const a = await m.ok("game.analyze", { game: g });
  assert.equal(a.output.complete, false);
  assert.equal(a.output.recorded, null);
  assert.equal(a.output.missing.length, 3);

  // Taking a strategy out takes its payoffs; a player, with clear, takes its plays link.
  await m.ok("game.remove", { game: g, player: "Col", strategy: "H" });
  assert.deepEqual((await m.item(g)).fields.payoffs, []);
  const firm = (await m.ok("items.create", { type: "actor", title: "Someone" })).output.id;
  await m.ok("game.player", { game: g, name: "Third", strategies: ["x"], actor: firm });
  assert.equal((await m.read.links(g, { type: "plays", dir: "in" })).items.length, 1);
  await m.ok("game.remove", { game: g, player: "Third" });
  assert.equal((await m.read.links(g, { type: "plays", dir: "in" })).items.length, 0);
  assert.deepEqual(((await m.item(g)).fields.players as any[]).map((p) => p.name), ["Row", "Col"]);
  assert.deepEqual(m.errors, []);
  await m.done();
});

test("game.rename: a strategy or a player gets a new name, its payoffs and plays links kept; undo takes it back", async () => {
  const m = await map();
  const firm = (await m.ok("items.create", { type: "actor", title: "North Ltd" })).output.id;
  const g = (
    await m.ok("game.create", {
      title: "Release",
      players: [
        { name: "Player 1", strategies: ["A", "B"], actor: firm },
        { name: "Player 2", strategies: ["A", "B"] },
      ],
      payoffs: [
        { profile: ["A", "A"], payoff: [2, 2] },
        { profile: ["A", "B"], payoff: [4, 1] },
      ],
    })
  ).output.id;

  // A strategy: in the player's list and in every profile that uses it, for that player only.
  await m.ok("game.rename", { game: g, player: "Player 2", strategy: "A", to: "now" });
  let it = await m.item(g);
  assert.deepEqual(it.fields.players, [{ name: "Player 1", strategies: ["A", "B"] }, { name: "Player 2", strategies: ["now", "B"] }]);
  assert.deepEqual(it.fields.payoffs, [{ profile: ["A", "now"], payoff: [2, 2] }, { profile: ["A", "B"], payoff: [4, 1] }]);

  // A player: its name, and the plays link that says who it is.
  const renamed = await m.ok("game.rename", { game: g, player: "Player 1", to: "Us" });
  it = await m.item(g);
  assert.deepEqual((it.fields.players as any[]).map((p) => p.name), ["Us", "Player 2"]);
  assert.deepEqual((await m.read.links(g, { type: "plays", dir: "in" })).items.map((l) => [l.from, l.fields.as]), [[firm, "Us"]]);
  assert.equal((await m.ok("game.analyze", { game: g, record: false })).output.complete, false, "the payoffs are the same two, under the new names");

  // The same name again changes nothing; a name taken, or one not there, is refused with what there is.
  assert.equal((await m.ok("game.rename", { game: g, player: "Us", to: "Us" })).change, undefined);
  const taken = await m.call("game.rename", { game: g, player: "Us", to: "Player 2" });
  assert.ok(!taken.ok && taken.refused.code === "game.taken", JSON.stringify(taken));
  const twice = await m.call("game.rename", { game: g, player: "Player 2", strategy: "B", to: "now" });
  assert.ok(!twice.ok && twice.refused.code === "game.taken");
  const none = await m.call("game.rename", { game: g, player: "Us", strategy: "C", to: "D" });
  assert.ok(!none.ok && none.refused.code === "game.strategy_unknown" && /It has: A, B/.test(none.refused.message));

  // Undo, like any change.
  await m.ok("history.undo", { change: renamed.change });
  assert.deepEqual(((await m.item(g)).fields.players as any[]).map((p) => p.name), ["Player 1", "Player 2"]);
  assert.deepEqual((await m.read.links(g, { type: "plays", dir: "in" })).items.map((l) => l.fields.as), ["Player 1"]);
  assert.deepEqual(m.errors, []);
  await m.done();
});

test("a payoff typed into a cell: one number per player, apart by commas or spaces", () => {
  assert.deepEqual(parsePayoff("3, 3", 2), [3, 3]);
  assert.deepEqual(parsePayoff(" -1  2.5 ", 2), [-1, 2.5]);
  assert.deepEqual(parsePayoff("1;2;3", 3), [1, 2, 3]);
  assert.deepEqual(parsePayoff("3", 2), { error: "2 numbers, one per player, in player order" });
  assert.deepEqual(parsePayoff("3, three", 2), { error: "numbers only, such as 3, 0" });
});
