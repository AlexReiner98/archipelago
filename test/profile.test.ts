import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionContext, ActionInvoke, ActionRegister } from "../spec/action.ts";
import type { Fact } from "../spec/changeset.ts";
import type { Json } from "../spec/common.ts";
import type { AgentRun, AgentTree, NodeInfo } from "../spec/agent.ts";
import type { ExchangeRead } from "../spec/exchange.ts";
import type { GraphRead } from "../spec/graph.ts";
import type { ProfileRead } from "../spec/profile.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import action from "../packs/action/index.ts";
import agent from "../packs/agent/index.ts";
import exchange from "../packs/exchange/index.ts";
import graph from "../packs/graph/index.ts";
import types from "../packs/types/index.ts";
import record from "../packs/record/index.ts";
import links from "../packs/links/index.ts";
import items from "../packs/items/index.ts";
import words, { TRIAL_MARK } from "../packs/words/index.ts";
import profile from "../packs/profile/index.ts";
import { hearing, matchFacts, matchNode, placing, runProfiles, type Model, type Profile } from "../packs/profile/model.ts";

const T = "2026-11-20T14:00:00.000Z";

// --- The rules, pure ---

const node = (id: string, at: string[], source?: string, kind = "instruction"): NodeInfo => ({ id, name: id, kind, title: id, at, pack: "words", ...(source ? { source } : {}) });
const prof = (p: Partial<Profile> & { id: string }): Profile => ({ title: p.id, state: "on", parts: [], places: [], holds: [], drops: [], ...p });
const modelOf = (...ps: Profile[]): Model => ({ profiles: new Map(ps.map((p) => [p.id, p])) });

test("match lines read facts by name, globbed; members read a node's places, kind and title", () => {
  const facts = { remote: "github.com/example/Studio", branch: "main", hub: ["e_1", "e_2"] };
  assert.ok(matchFacts("remote:github.com/example/studio", facts));
  assert.ok(matchFacts("remote:*/Studio* branch:main", facts));
  assert.ok(matchFacts("hub:e_2", facts));
  assert.ok(!matchFacts("remote:*/archipelago*", facts));
  assert.ok(!matchFacts("", facts), "an empty match matches nothing");
  const ui = node("words/ui", ["file:packs/map/**", "file:packs/harness/**"]);
  assert.ok(matchNode("at:file:packs/**", ui));
  assert.ok(matchNode("at:file:spec/** at:file:packs/**", ui), "same key: any");
  assert.ok(!matchNode("at:file:packs/** kind:skill", ui), "different keys: all");
  assert.ok(matchNode("at:skill:rhino*", node("words/r", ["skill:rhinocommon"], undefined, "skill")));
  assert.ok(!matchNode("", ui));
});

test("a run is in the profiles its facts name through uses links, or said; parts come too; dropped and off ones don't", () => {
  const m = modelOf(
    prof({ id: "everyone" }),
    prof({ id: "csharp", parts: ["everyone"] }),
    prof({ id: "studio", places: ["r_studio"], parts: ["csharp"] }),
    prof({ id: "business", state: "off", places: ["r_studio"] }),
    prof({ id: "arch", places: ["r_arch"] }),
  );
  const ids = (facts: Record<string, string | string[]>) => runProfiles(m, facts).map((p) => `${p.id}:${p.by}`);
  assert.deepEqual(ids({ repo: "r_studio" }), ["studio:match", "csharp:part", "everyone:part"]);
  assert.deepEqual(ids({ repo: "r_other" }), []);
  assert.deepEqual(ids({ repo: "r_other", profiles: ["arch"] }), ["arch:match"]);
  assert.deepEqual(ids({ repo: "r_studio", profiles_drop: "csharp" }), ["studio:match"]);
});

test("a run nothing places is in the fallback profile and what it is part of; a placed run isn't; a dropped or off fallback isn't a fallback", () => {
  const m = modelOf(
    prof({ id: "public" }),
    prof({ id: "arch", fallback: true, parts: ["public"] }),
    prof({ id: "studio", places: ["r_studio"], parts: ["public"] }),
  );
  const ids = (facts: Record<string, string | string[]>) => runProfiles(m, facts).map((p) => `${p.id}:${p.by}`);
  assert.deepEqual(ids({ cwd: "C:/somewhere" }), ["arch:match", "public:part"], "nothing placed it: the fallback");
  assert.deepEqual(ids({ repo: "r_studio" }), ["studio:match", "public:part"], "placed: the fallback doesn't add itself");
  assert.deepEqual(ids({ cwd: "C:/somewhere", profiles_drop: "arch" }), [], "dropped: no fallback, fail open");
  const off = modelOf(prof({ id: "arch", fallback: true, state: "off" }));
  assert.deepEqual(runProfiles(off, {}).map((p) => p.id), [], "an off profile is no fallback");
  // A run that only the fallback places hears what it holds, and not a node another profile holds.
  const held = modelOf(prof({ id: "arch", fallback: true, state: "on", holds: ["n_ui"] }), prof({ id: "studio", state: "on", places: ["r_studio"], holds: ["n_rhino"] }));
  assert.deepEqual(hearing(held, {}, node("words/n_rhino", ["tool:Bash"], "n_rhino")), { hears: false, why: "For studio; this run is in arch." });
  assert.deepEqual(hearing(held, {}, node("words/n_ui", ["tool:Bash"], "n_ui")), { hears: true });
});

test("hearing: a node in no profile, or a run in no profile, hears; an exclusion wins; a shadow only records", () => {
  const m = modelOf(prof({ id: "studio", title: "Studio", places: ["r_ap"], holds: ["n_rhino"] }), prof({ id: "arch", title: "Archipelago", places: ["r_arch"], members: "at:file:packs/**", drops: ["n_pills"] }), prof({ id: "biz", title: "Business", state: "shadow", holds: ["n_art"] }));
  const rhino = node("words/n_rhino", ["skill:rhinocommon"], "n_rhino");
  const ui = node("words/n_ui", ["file:packs/map/**"], "n_ui");
  const pills = node("words/n_pills", ["file:packs/map/**"], "n_pills");
  const art = node("words/n_art", ["session_start"], "n_art");
  const plain = node("words/n_plain", ["session_start"], "n_plain");
  const inArch = { repo: "r_arch" };
  assert.deepEqual(hearing(m, inArch, rhino), { hears: false, why: "For Studio; this run is in Archipelago." });
  assert.deepEqual(hearing(m, inArch, ui), { hears: true });
  assert.deepEqual(hearing(m, inArch, plain), { hears: true }, "a node in no profile is global");
  assert.deepEqual(hearing(m, { repo: "r_new" }, rhino), { hears: true }, "fail open: a run in no profile hears everything");
  assert.deepEqual(hearing(m, { repo: "r_ap" }, pills), { hears: true }, "out of Archipelago is no profile's for Studio: global there");
  assert.deepEqual(hearing(m, inArch, pills), { hears: false, why: "Taken out of Archipelago." });
  assert.deepEqual(hearing(m, inArch, art), { hears: true, shadow: "For Business; this run is in Archipelago." });
});

test("placing a run in one profile names it and drops every other it matches, earlier drops kept", () => {
  const m = modelOf(prof({ id: "public" }), prof({ id: "arch", fallback: true, parts: ["public"] }), prof({ id: "studio", places: ["r_studio"], parts: ["public"] }), prof({ id: "biz" }));
  assert.deepEqual(placing(m, { repo: "r_studio", profiles_drop: "biz" }, "arch"), { profiles: ["arch"], profiles_drop: ["biz", "studio"] });
  assert.deepEqual(placing(m, { cwd: "C:/x" }, "studio"), { profiles: ["studio"], profiles_drop: ["arch"] }, "out of the fallback");
  assert.deepEqual(placing(m, { profiles_drop: ["arch"] }, "arch"), { profiles: ["arch"], profiles_drop: [] }, "a drop of the target is let go");
  const placed = { repo: "r_studio", ...placing(m, { repo: "r_studio" }, "biz") };
  assert.deepEqual(runProfiles(m, placed).map((p) => p.id), ["biz"]);
});

// --- On the map, through the agent ---

const probe: Pack = { id: "probe", inject: ["agent.run", "agent.tree", "action.invoke", "graph.read", "exchange.read", "profile.read"], apply() {} };

/** Writes facts as they are, before the profile pack loads: what the map held before umwelt. */
const seeding = (facts: Fact[]): Pack => ({
  id: "seed",
  inject: ["action.register", "action.invoke"],
  async apply(ctx) {
    ctx.get<ActionRegister>("action.register").register({ name: "seed.raw", title: "Seed", input: { type: "object" }, async run(_i: Json, call: ActionContext) { call.write(facts); return {}; } });
    const out = await ctx.get<ActionInvoke>("action.invoke").invoke({ action: "seed.raw", input: {}, authority: { of: "human", basis: "test" }, reason: "test" });
    assert.ok(out.ok, JSON.stringify(out));
  },
});

async function setup(seed?: Fact[]) {
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const modules: Record<string, Pack> = { graph, action, types, record, links, items, exchange, agent, words: words as Pack, profile, probe, seed: seeding(seed ?? []) } as Record<string, Pack>;
  const BASE = "mem:/packs/";
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length)] }) });
  const tree: Entry[] = ["graph", "action", "types", "record", "links", "items", "exchange", "agent", "words", ...(seed ? ["seed"] : []), "profile", "probe"].map((id) => ({ id, pack: id }));
  // Packs load side by side: what was on the map is written first, as on a server that starts with it.
  if (seed) await loader.apply(tree.filter((e) => e.id !== "profile" && e.id !== "probe"));
  await loader.apply(tree);
  await rt.settle();
  const ctx = (run: string) => loader.fiber("probe")!.ctx.intercept({ actor: { id: "e_agent", kind: "agent" }, run });
  const p = ctx("r1");
  const act = async (a: string, input: Record<string, unknown>) => {
    const out = await p.get<ActionInvoke>("action.invoke").invoke<{ id: string; node: string }>({ action: a, input: input as never, authority: { of: "human", basis: "test" }, reason: "test" });
    assert.ok(out.ok, JSON.stringify(out));
    return out.ok ? out.output : (undefined as never);
  };
  return { rt, loader, errors, ctx, act, read: p.get<ProfileRead>("profile.read"), tree: p.get<AgentTree>("agent.tree"), graph: p.get<GraphRead>("graph.read") };
}

const start = (run: string, facts: Record<string, string>) => ({ run, agent: { id: "e_agent", kind: "agent" as const }, harness: "test", reaches: [], facts });

test("profiles on the map hold a node back from runs outside them; shadow records, on holds; a miss where it listens is told", async () => {
  const { rt, errors, ctx, act, read, tree, graph } = await setup();
  const rhino = (await act("words.add", { title: "RhinoCommon", kind: "skill", at: ["tool:Bash"], words: "Use RhinoCommon." })).node;
  const plain = (await act("words.add", { title: "Plain", at: ["tool:Bash"], words: "Plain." })).node;
  const apRepo = (await act("items.create", { type: "record", title: "Studio repo" })).id;
  const archRepo = (await act("items.create", { type: "record", title: "Archipelago repo" })).id;
  const studio = (await act("items.create", { type: "umwelt", title: "Studio" })).id;
  const arch = (await act("items.create", { type: "umwelt", title: "Archipelago" })).id;
  await act("items.link", { type: "in_umwelt", from: rhino, to: studio });
  await act("items.link", { type: "uses", from: apRepo, to: studio });
  await act("items.link", { type: "uses", from: archRepo, to: arch });
  const [p] = await graph.get([studio]);
  assert.equal(p?.fields.status, "shadow", "a profile starts in shadow");

  const inArch = ctx("r1").get<AgentRun>("agent.run");
  const info = await inArch.begin(start("r1", { repo: archRepo }));
  assert.deepEqual((await read.of(info)).map((x) => [x.title, x.by, x.holding]), [["Archipelago", "match", false]]);
  const shadowed = await inArch.reach({ run: "r1", places: ["tool:Bash"], time: T });
  assert.deepEqual(shadowed.said.map((s) => s.text), ["Use RhinoCommon.", "Plain."], "a shadow holds nothing");

  await act("items.set", { id: studio, fields: { status: "on" } });
  await act("items.set", { id: arch, fields: { status: "on" } });
  const r2 = ctx("r2").get<AgentRun>("agent.run");
  await r2.begin(start("r2", { repo: archRepo }));
  const held = await r2.reach({ run: "r2", places: ["tool:Bash"], time: T });
  assert.deepEqual(held.said.map((s) => s.text), ["Plain."]);
  const inAp = ctx("r3").get<AgentRun>("agent.run");
  await inAp.begin(start("r3", { repo: apRepo }));
  assert.deepEqual((await inAp.reach({ run: "r3", places: ["tool:Bash"], time: T })).said.map((s) => s.text), ["Use RhinoCommon.", "Plain."]);

  const events = (await ctx("r1").get<ExchangeRead>("exchange.read").events("r2")).items;
  const gated = events.filter((e) => e.kind === "gated");
  assert.deepEqual(gated.map((e) => [e.node, e.text]), [[`words/${rhino}`, "For Studio; this run is in Archipelago."]]);
  const r1events = (await ctx("r1").get<ExchangeRead>("exchange.read").events("r1")).items;
  assert.deepEqual(r1events.filter((e) => e.kind === "gated").map((e) => (e.detail as { trial?: boolean }).trial), [true]);

  // A failed Bash call in r2, where the held node listens: told on Studio.
  await r2.act({ run: "r2", place: "tool:Bash", time: T, kind: "tool", by: "agent", ok: false, output: "error" });
  await rt.settle();
  await new Promise((r) => setTimeout(r, 20));
  const about = (await graph.links(studio, { type: "about", dir: "in" })).items;
  assert.equal(about.length, 1);
  const [finding] = await graph.get([about[0]!.from]);
  assert.match(String(finding?.fields.title), /^Held back words\/.*, then a miss at tool:Bash$/);

  assert.deepEqual((await read.nodes(studio)).in, [`words/${rhino}`]);
  assert.ok(tree.nodes().some((n) => n.source === plain));
  assert.deepEqual(errors, []);
});

test("profile.place moves a live run into one profile: begun again, out of the one it matched", async () => {
  const { errors, ctx, act, read } = await setup();
  const repo = (await act("items.create", { type: "record", title: "Studio repo" })).id;
  const studio = (await act("items.create", { type: "umwelt", title: "Studio" })).id;
  const biz = (await act("items.create", { type: "umwelt", title: "Business" })).id;
  await act("items.link", { type: "uses", from: repo, to: studio });
  const run = ctx("r9").get<AgentRun>("agent.run");
  await run.begin({ ...start("r9", { repo }), title: "A session" });
  const out = (await act("profile.place", { run: "r9", profile: biz })) as unknown as { was: string[]; now: string[] };
  assert.deepEqual(out.was, [studio]);
  assert.deepEqual(out.now, [biz]);
  const exchange = ctx("r9").get<ExchangeRead>("exchange.read");
  const info = (await exchange.runs({ limit: 10 })).items.find((r) => r.run === "r9")!;
  assert.equal(info.title, "A session", "the run keeps what it was");
  assert.deepEqual((await read.of(info)).map((p) => p.title), ["Business"]);
  const refused = await ctx("r9").get<ActionInvoke>("action.invoke").invoke({ action: "profile.place", input: { run: "nope", profile: biz }, authority: { of: "human", basis: "test" }, reason: "test" });
  assert.ok(!refused.ok && refused.refused.code === "profile.no_run");
  assert.deepEqual(errors, []);
});

test("any item an umwelt link gives places is said there, as a node, to that umwelt's runs only", async () => {
  const { errors, ctx, act, tree, graph } = await setup();
  const rule = (await act("items.create", { type: "record", title: "Layers by trade", fields: { note: "Name layers by trade." } })).id;
  const apRepo = (await act("items.create", { type: "record", title: "Studio repo" })).id;
  const archRepo = (await act("items.create", { type: "record", title: "Archipelago repo" })).id;
  const studio = (await act("items.create", { type: "umwelt", title: "Studio", fields: { status: "on" } })).id;
  const arch = (await act("items.create", { type: "umwelt", title: "Archipelago", fields: { status: "on" } })).id;
  await act("items.link", { type: "uses", from: apRepo, to: studio });
  await act("items.link", { type: "uses", from: archRepo, to: arch });
  const plain = (await act("items.link", { type: "in_umwelt", from: rule, to: arch })).id;
  assert.ok(!tree.nodes().some((n) => n.source === plain || n.source === rule), "a link without places says nothing");
  const link = (await act("items.link", { type: "in_umwelt", from: rule, to: studio, fields: { at: ["tool:Bash"] } })).id;
  const node = tree.nodes().find((n) => n.source === link);
  assert.deepEqual(node && [node.id, node.kind, node.title, node.at], [`words/${link}`, "record", "Layers by trade", ["tool:Bash"]]);

  let n = 0;
  const said = async (repo: string) => {
    const run = `u${++n}`;
    const r = ctx(run).get<AgentRun>("agent.run");
    await r.begin(start(run, { repo }));
    return (await r.reach({ run, places: ["tool:Bash"], time: T })).said.map((s) => s.text);
  };
  assert.deepEqual(await said(apRepo), ["Name layers by trade."]);
  assert.deepEqual(await said(archRepo), [], "held back where only the plain link holds it");

  await act("items.set", { id: rule, fields: { note: "Name layers by trade, then phase." } });
  assert.deepEqual(await said(apRepo), ["Name layers by trade, then phase."], "the item's words, read at each say");
  await act("items.set", { id: rule, fields: { title: "Layers" } });
  assert.equal(tree.nodes().find((n) => n.source === link)?.title, "Layers", "a new title registers it again");
  await act("items.set", { id: link, fields: { trial: true } });
  assert.deepEqual(await said(apRepo), [`${TRIAL_MARK} Name layers by trade, then phase.`]);
  await act("items.set", { id: link, fields: { trial: null, retired: true } });
  assert.deepEqual(await said(apRepo), []);
  assert.ok(!tree.nodes().some((n) => n.source === link), "a retired link is no node");
  const [item] = await graph.get([rule]);
  assert.equal(item?.type, "record", "the item stays what it is");
  assert.deepEqual(errors, []);
});

test("profiles and their links from before umwelt are renamed on load, as one change", async () => {
  const seed: Fact[] = [
    ["+", "p1", "type", "profile"],
    ["+", "p1", "title", "Studio"],
    ["+", "p1", "status", "on"],
    ["+", "n1", "type", "node"],
    ["+", "n1", "title", "Rhino"],
    ["+", "n1", "at", ["tool:Bash"]],
    ["+", "n1", "words", "Use RhinoCommon."],
    ["+", "l1", "type", "in_profile"],
    ["+", "l1", "from", "n1"],
    ["+", "l1", "to", "p1"],
    ["+", "l2", "type", "out_of_profile"],
    ["+", "l2", "from", "n1"],
    ["+", "l2", "to", "p1"],
  ];
  const { errors, graph, read } = await setup(seed);
  const got = await graph.get(["p1", "l1", "l2"]);
  assert.deepEqual(got.map((i) => i?.type), ["umwelt", "in_umwelt", "out_of_umwelt"]);
  assert.deepEqual((await read.nodes("p1")).out, ["words/n1"]);
  assert.deepEqual(errors, []);
});
