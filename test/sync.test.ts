import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionInvoke } from "../spec/action.ts";
import type { Actor, Json } from "../spec/common.ts";
import type { Fact } from "../spec/changeset.ts";
import type { GraphRead } from "../spec/graph.ts";
import { Runtime, type Context, type Plugin } from "../runtime/core.ts";
import { Loader } from "../runtime/loader.ts";
import { META } from "../spec/common.ts";
import action from "../plugins/action/index.ts";
import graph from "../plugins/graph/index.ts";
import history from "../plugins/history/index.ts";
import interchange from "../plugins/interchange/index.ts";
import sync from "../plugins/sync/index.ts";
import types from "../plugins/types/index.ts";
import work from "../plugins/work/index.ts";
import schema from "../plugins/schema/index.ts";
import { factsFor, plan } from "../plugins/sync/merge.ts";
import { syncMaps, type End } from "../plugins/sync/run.ts";
import { lineOf, runOf } from "../plugins/sync/view.ts";

const BASE = "mem:/plugins/";
const OWNER: Actor = { id: "person:owner", kind: "person" };
const tick = () => new Promise((r) => setTimeout(r, 3));

/** A map in memory: graph, actions, history, interchange and sync; an End onto it, and helpers to change it as a person. */
async function map(name: string, opts: { keep?: number; fold?: number; history?: boolean; graphKeep?: number; schema?: boolean } = {}) {
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  let probe!: Context;
  const p: Plugin = { id: "probe", inject: ["graph.read", "action.invoke"], apply(ctx) { probe = ctx; } };
  const modules: Record<string, Plugin> = { "graph.ts": graph, "action.ts": action, "history.ts": history, "interchange.ts": interchange, "sync.ts": sync, "probe.ts": p, "types.ts": types, "work.ts": work, "schema.ts": schema };
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length)] }) });
  const tree = (withHistory: boolean) => [
    { id: "graph", plugin: "graph.ts", ...(opts.graphKeep ? { config: { keep: opts.graphKeep } } : {}) },
    { id: "action", plugin: "action.ts" },
    ...(opts.schema ? [{ id: "types", plugin: "types.ts" }, { id: "work", plugin: "work.ts" }, { id: "schema", plugin: "schema.ts" }] : []),
    ...(withHistory ? [{ id: "history", plugin: "history.ts", config: { ...(opts.keep ? { keep: opts.keep } : {}), ...(opts.fold ? { fold: opts.fold } : {}) } }] : []),
    { id: "interchange", plugin: "interchange.ts" },
    { id: "sync", plugin: "sync.ts", config: { name } },
    { id: "probe", plugin: "probe.ts" },
  ];
  await loader.apply(tree(opts.history !== false));
  await rt.settle();
  assert.deepEqual(errors, []);
  const as = (who: Actor) => probe.intercept({ [META.actor]: who });
  const end: End = {
    async call<T>(key: string, method: string, args: unknown[], who?: Actor): Promise<T> {
      const cap = as(who ?? OWNER).get<Record<string, (...a: unknown[]) => unknown>>(key);
      return (await cap[method]!(...args)) as T;
    },
  };
  const read = probe.get<GraphRead>("graph.read");
  const invoke = (a: string, input: Json, who: Actor = OWNER) => as(who).get<ActionInvoke>("action.invoke").invoke({ action: a, input, authority: { of: "human", basis: "test" }, reason: `${name}: ${a}` });
  const write = async (facts: Fact[], who: Actor = OWNER) => {
    const r = await invoke("interchange.import", { facts: facts as unknown as Json }, who);
    assert.ok(r.ok, JSON.stringify(r));
    await tick();
    return r.ok ? r.change! : "";
  };
  const fields = async (id: string) => {
    const [it] = await read.get([id]);
    return it ? ({ type: it.type, ...it.fields } as Record<string, Json>) : null;
  };
  /** Sets a field, retracting what it holds. */
  const set = async (id: string, field: string, value: Json) => {
    const cur = (await fields(id))?.[field];
    return write([...(cur !== undefined ? ([["-", id, field, cur]] as Fact[]) : []), ["+", id, field, value]]);
  };
  const remove = async (id: string) => {
    const f = (await fields(id))!;
    return write(Object.entries(f).map(([k, v]) => ["-", id, k, v] as Fact));
  };
  /** Loads the history plugin now, on a map that ran without it. */
  const addHistory = async () => {
    await loader.apply(tree(true));
    await rt.settle();
  };
  return { end, read, invoke, write, fields, set, remove, addHistory, stop: () => loader.apply([]) };
}

const make = (id: string, title: string): Fact[] => [["+", id, "type", "work"], ["+", id, "title", title], ["+", id, "status", "todo"]];

test("the first run joins: each map gets what the other made; a second run sends nothing back", async () => {
  const a = await map("local"), b = await map("hosted");
  await a.write(make("x", "Made on local"));
  await b.write(make("y", "Made on hosted"));
  const r = await syncMaps(a.end, b.end);
  assert.deepEqual([r.a.sent, r.b.sent, r.conflicts.length, r.refused.length], [1, 1, 0, 0]);
  assert.equal((await b.fields("x"))?.title, "Made on local");
  assert.equal((await a.fields("y"))?.title, "Made on hosted");

  const again = await syncMaps(a.end, b.end);
  assert.deepEqual([again.a.read, again.b.read, again.a.sent, again.b.sent], [1, 1, 0, 0], "each reads only the other's copy, and leaves it out");
  const third = await syncMaps(a.end, b.end);
  assert.deepEqual([third.a.read, third.b.read], [0, 0]);

  // After the join, a copy is journaled on the map that took it, as the sync from the other, on the first set's authority.
  await a.write(make("z", "Later on local"));
  await syncMaps(a.end, b.end);
  const page = await b.read.since({ limit: 20 });
  const copies = page.items.filter((c) => c.header.action === "sync.apply");
  assert.match(copies[0]!.header.reason, /^Joined with local: the first sync, local's kept/);
  const copy = copies.at(-1)!;
  assert.match(copy.header.actor.id, /^agent:sync\//);
  assert.deepEqual(copy.header.authority, { of: "human", basis: "test" });
  assert.equal(copy.header.reason, "From local: local: interchange.import");
  await a.stop();
  await b.stop();
});

test("both changed a field: the later change wins on both maps, and the run says so; other fields both stay", async () => {
  const a = await map("local"), b = await map("hosted");
  await a.write(make("x", "First"));
  await syncMaps(a.end, b.end);
  await a.set("x", "title", "Local's title");
  await a.set("x", "note", "Local's note");
  await b.set("x", "title", "Hosted's title, later");
  await b.set("x", "status", "doing");
  const r = await syncMaps(a.end, b.end);
  for (const m of [a, b]) {
    const x = await m.fields("x");
    assert.deepEqual([x?.title, x?.note, x?.status], ["Hosted's title, later", "Local's note", "doing"]);
  }
  assert.equal(r.conflicts.length, 1);
  assert.deepEqual([r.conflicts[0]!.field, r.conflicts[0]!.won, r.conflicts[0]!.a.value, r.conflicts[0]!.title], ["title", "b", "Local's title", "Hosted's title, later"]);

  // The other way round: local's change is the later one.
  await b.set("x", "title", "Hosted again");
  await a.set("x", "title", "Local, last");
  const r2 = await syncMaps(a.end, b.end);
  assert.equal((await b.fields("x"))?.title, "Local, last");
  assert.equal((await a.fields("x"))?.title, "Local, last");
  assert.equal(r2.conflicts[0]?.won, "a");
  await a.stop();
  await b.stop();
});

test("taken away on one map, changed on the other: the later one stands", async () => {
  const a = await map("local"), b = await map("hosted");
  await a.write(make("x", "X"));
  await a.write(make("y", "Y"));
  await syncMaps(a.end, b.end);

  // x: removed on local, then changed on hosted: it comes back whole on local.
  await a.remove("x");
  await b.set("x", "note", "Changed after");
  // y: changed on hosted, then removed on local: it goes on both.
  await b.set("y", "note", "Changed before");
  await a.remove("y");
  const r = await syncMaps(a.end, b.end);
  assert.deepEqual(await a.fields("x"), { type: "work", title: "X", status: "todo", note: "Changed after" });
  assert.equal(await a.fields("y"), null);
  assert.equal(await b.fields("y"), null);
  const byId = Object.fromEntries(r.conflicts.map((c) => [c.id, c]));
  assert.deepEqual([byId.x?.won, byId.x?.a.gone, byId.y?.won, byId.y?.a.gone], ["b", true, "a", true]);
  await a.stop();
  await b.stop();
});

test("an undo is a change like any other: it syncs", async () => {
  const a = await map("local"), b = await map("hosted");
  await a.write(make("x", "X"));
  await syncMaps(a.end, b.end);
  const change = await a.set("x", "title", "Renamed");
  await syncMaps(a.end, b.end);
  assert.equal((await b.fields("x"))?.title, "Renamed");
  const u = await a.invoke("history.undo", { change });
  assert.ok(u.ok, JSON.stringify(u));
  await syncMaps(a.end, b.end);
  assert.equal((await b.fields("x"))?.title, "X");
  await a.stop();
  await b.stop();
});

test("a dry run plans and reports, and writes nothing", async () => {
  const a = await map("local"), b = await map("hosted");
  await a.write(make("x", "X"));
  const dry = await syncMaps(a.end, b.end, { dry: true });
  assert.deepEqual([dry.dry, dry.a.read, dry.b.sent], [true, 1, 0]);
  assert.equal(await b.fields("x"), null);
  const real = await syncMaps(a.end, b.end);
  assert.equal(real.a.sent, 1, "the cursors didn't move");
  await a.stop();
  await b.stop();
});

test("factsFor retracts what the map holds now, not what the sender saw; a field already so writes nothing", () => {
  const now = new Map([["x", { type: "work", title: "Here", status: "todo" }]]);
  assert.deepEqual(factsFor([{ id: "x", field: "title", value: "There" }, { id: "x", field: "status", value: "todo" }], now), [
    ["-", "x", "title", "Here"],
    ["+", "x", "title", "There"],
  ]);
  assert.deepEqual(factsFor([{ id: "n", field: "title", value: "New" }, { id: "n", field: "type", value: "work" }], new Map([["n", null]])), [
    ["+", "n", "type", "work"],
    ["+", "n", "title", "New"],
  ]);
  assert.deepEqual(factsFor([{ id: "x", remove: true }], now), [["-", "x", "title", "Here"], ["-", "x", "status", "todo"], ["-", "x", "type", "work"]]);
});

test("plan: a set whose every field lost is idle, and both writing the same value is no conflict", () => {
  const set = (id: string, side: string, committed: string, facts: Fact[]) => ({ id, seq: 1, committed, header: { actor: OWNER, authority: { of: "human", basis: "t" }, plugin: { id: "t" }, action: "t", reason: side, time: committed }, facts }) as never;
  const p = plan(
    [set("a1", "a", "2026-11-27T10:00:00.000Z", [["+", "x", "title", "A"]]), set("a2", "a", "2026-11-27T10:00:01.000Z", [["+", "x", "note", "same"]])],
    [set("b1", "b", "2026-11-27T10:00:02.000Z", [["+", "x", "title", "B"], ["+", "x", "note", "same"]])],
  );
  assert.deepEqual([p.toB.length, p.toA.length, p.idle.a, p.conflicts.length], [0, 1, 2, 1]);
  assert.deepEqual(p.toA[0]!.writes, [{ id: "x", field: "title", value: "B" }, { id: "x", field: "note", value: "same" }]);
});

test("the header line: the map last synced with, how long ago, and how many fields both changed; nothing before a first sync", async () => {
  const a = await map("local"), b = await map("hosted");
  const status = async () => {
    const r = await a.invoke("sync.status", {});
    assert.ok(r.ok);
    return r.ok ? (r.output as never) : undefined;
  };
  assert.equal(lineOf(await status(), Date.now()), undefined);
  await a.write(make("x", "X"));
  await syncMaps(a.end, b.end);
  await a.set("x", "title", "Local");
  await b.set("x", "title", "Hosted");
  await syncMaps(a.end, b.end);
  const s = (await status())!;
  assert.equal(lineOf(s, Date.now()), "⇄ hosted · just now · 1 conflict");
  assert.deepEqual(runOf((s as { peers: never[] }).peers[0]!), { got: 1, gave: 0, conflicts: [{ what: "Hosted · title", kept: `hosted's: "Hosted"` }] });
  await a.stop();
  await b.stop();
});

const PLUGIN: Actor = { id: "plugin:words", kind: "agent" };

test("the first run joins two maps that grew apart: the same thing, by type and title, is one; local's fields kept where they differ", async () => {
  const a = await map("local"), b = await map("hosted");
  await a.write([...make("fa", "Archipelago"), ["+", "fa", "match", "remote:*/archipelago"]]);
  await b.write([...make("fb", "Archipelago"), ["+", "fb", "match", "remote:*/old"]]);
  await a.write(make("na", "A rule"));
  await b.write(make("nb", "A rule"));
  await a.write([["+", "la", "type", "part_of"], ["+", "la", "from", "na"], ["+", "la", "to", "fa"]]);
  await b.write([["+", "lb", "type", "part_of"], ["+", "lb", "from", "nb"], ["+", "lb", "to", "fb"]]);
  await b.write(make("d1", "Twice"));
  await b.write(make("d2", "Twice"));
  await a.write(make("d3", "Twice"));
  const r = await syncMaps(a.end, b.end);
  assert.deepEqual(r.joined, { same: 3, differed: 1, kept: "a", copied: { toA: 2, toB: 1 }, ambiguous: 1 });
  assert.equal((await b.fields("fb"))?.match, "remote:*/archipelago", "local's kept");
  assert.equal(await b.fields("fa"), null, "no second Archipelago");
  assert.equal(await b.fields("la"), null, "the link is paired by its ends");

  // From then on, a change to the paired item on local lands on hosted's.
  await a.set("na", "note", "Said on local");
  await syncMaps(a.end, b.end);
  assert.equal((await b.fields("nb"))?.note, "Said on local");
  await b.set("fb", "title", "Archipelago, renamed on hosted");
  await syncMaps(a.end, b.end);
  assert.equal((await a.fields("fa"))?.title, "Archipelago, renamed on hosted");
  await a.stop();
  await b.stop();
});

test("a map's plugins do their own work: their sets aren't copied, what they make is paired with the other map's own, or copied where it has none", async () => {
  const a = await map("local"), b = await map("hosted");
  await syncMaps(a.end, b.end);
  // Each map's words plugin makes its own "The act tool"; only local's makes "A new refusal".
  await a.write([["+", "ta", "type", "node"], ["+", "ta", "title", "The act tool"], ["+", "ta", "words", "Act."]], PLUGIN);
  await b.write([["+", "tb", "type", "node"], ["+", "tb", "title", "The act tool"], ["+", "tb", "words", "Act."]], PLUGIN);
  await a.write([["+", "ra", "type", "node"], ["+", "ra", "title", "A new refusal"], ["+", "ra", "words", "No."]], PLUGIN);
  const r = await syncMaps(a.end, b.end);
  assert.deepEqual(r.plugins, { paired: 1, copied: 1 });
  assert.equal(await b.fields("ta"), null, "not a second act tool");
  assert.equal((await b.fields("ra"))?.words, "No.");

  // A plugin's later upkeep stays on its map; a person's edit of the paired node reaches the other's.
  await a.set("ta", "words", "Act, as reworded by a person.");
  await a.write([["-", "ta", "words", "Act, as reworded by a person."], ["+", "ta", "words", "Act, by the words plugin."]], PLUGIN);
  await syncMaps(a.end, b.end);
  assert.equal((await b.fields("tb"))?.words, "Act, as reworded by a person.", "the person's edit, not the plugin's");
  await a.stop();
  await b.stop();
});

test("a log with a hole is refused, never synced around; a log begun late is read from its checkpoint", async () => {
  const a = await map("local", { keep: 1, fold: 1 }), b = await map("hosted");
  await syncMaps(a.end, b.end);
  for (const t of ["one", "two", "three", "four"]) await a.write(make(`w_${t}`, t));
  await assert.rejects(syncMaps(a.end, b.end), /local's log jumps from \d+ to \d+/);

  // The journal came after two sets, and the graph keeps only the last: the first is in no log.
  const c = await map("late", { history: false, graphKeep: 1 }), d = await map("other");
  await c.write(make("early", "Before the journal"));
  await c.write(make("second", "Kept by the graph"));
  await c.addHistory();
  await c.write(make("after", "After it"));
  const r = await syncMaps(c.end, d.end);
  assert.deepEqual(r.joined?.copied, { toA: 0, toB: 3 }, "the checkpoint's two items and the one made after");
  assert.equal((await d.fields("early"))?.title, "Before the journal");
  assert.equal((await d.fields("after"))?.title, "After it");
  for (const m of [a, b, c, d]) await m.stop();
});

test("history.verify: the log rebuilds the tables; a log begun late rebuilds them from the checkpoint made on load", async () => {
  const a = await map("local");
  await a.write(make("x", "X"));
  await a.set("x", "title", "X, renamed");
  await a.remove("x");
  await a.write(make("y", "Y"));
  const v = await a.invoke("history.verify", {});
  assert.ok(v.ok);
  if (v.ok) assert.deepEqual(v.output, { complete: true, begins: 1, now: 4, sets: 4, items: 1, differ: 0, examples: [] });

  const c = await map("late", { history: false, graphKeep: 1 });
  await c.write(make("early", "Before the journal"));
  await c.write(make("second", "Kept by the graph, taken into the log"));
  await c.addHistory();
  await c.set("early", "title", "Renamed after");
  const w = await c.invoke("history.verify", {});
  assert.ok(w.ok);
  if (w.ok) {
    const o = w.output as { complete: boolean; begins: number; from: number; differ: number; items: number };
    assert.deepEqual([o.complete, o.begins, o.from, o.differ, o.items], [true, 2, 2, 0, 2], "the checkpoint at 2 holds what the journal never saw made");
  }
  await a.stop();
  await c.stop();
});

test("sets made before the journal was on the chain are taken into the log from the graph's recent sets", async () => {
  const c = await map("late", { history: false });
  await c.write(make("early", "Before the journal"));
  await c.addHistory();
  const v = await c.invoke("history.verify", {});
  assert.ok(v.ok);
  if (v.ok) assert.deepEqual(v.output, { complete: true, begins: 1, now: 1, sets: 1, items: 1, differ: 0, examples: [] });
  await c.stop();
});

test("an item the other map's schema doesn't take is held there alone; the rest of the set lands", async () => {
  const a = await map("local"), b = await map("hosted", { schema: true });
  await a.write(make("ok1", "Fits"));
  await a.write([...make("bad", "Has an old field"), ["+", "bad", "packs", ["x"]]]);
  await a.write(make("ok2", "Fits too"));
  const r = await syncMaps(a.end, b.end);
  assert.deepEqual(r.refused.map((f) => [f.item, f.code]), [["bad", "schema.quarantined"]]);
  assert.equal((await b.fields("ok1"))?.title, "Fits");
  assert.equal((await b.fields("ok2"))?.title, "Fits too");
  assert.equal(await b.fields("bad"), null);
  const held = await b.invoke("schema.quarantined", { state: "held" });
  assert.ok(held.ok);
  if (held.ok) assert.equal((held.output as { items: unknown[] }).items.length, 1, "the whole set was dropped, only the misfit is held");
  assert.equal(r.a.sent, 1, "the rest went again as one set; the misfit alone, held");
  await a.stop();
  await b.stop();
});

test("a map that names itself nothing is called by where it was reached", async () => {
  const a = await map("local");
  const b = await map("hosted");
  const unnamed = { ...b.end, label: "app.example/sync", async call<T>(key: string, method: string, args: unknown[], who?: Actor): Promise<T> {
    const out = await b.end.call<T>(key, method, args, who);
    if (key === "action.invoke" && (args[0] as { action: string }).action === "sync.status") delete (out as { output: { name?: string } }).output.name;
    return out;
  } };
  const r = await syncMaps(a.end, unnamed, { dry: true });
  assert.equal(r.b.name, "app.example/sync");
  await a.stop();
  await b.stop();
});
