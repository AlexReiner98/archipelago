import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ActionContext, ActionInvoke, ActionRegister, Outcome } from "../spec/action.ts";
import type { Fact } from "../spec/changeset.ts";
import type { Json, Page } from "../spec/common.ts";
import type { GraphRead } from "../spec/graph.ts";
import { Runtime, type Plugin } from "../runtime/core.ts";
import { Loader, type Entry as TreeEntry } from "../runtime/loader.ts";
import action from "../plugins/action/index.ts";
import graph from "../plugins/graph/index.ts";
import history, { netFacts } from "../plugins/history/index.ts";
import { Journal, type Entry, type Snapshot } from "../plugins/history/journal.ts";

const BASE = "mem:/plugins/";

/** A plugin with one action that writes whatever facts it is given. */
const probe: Plugin = {
  id: "probe",
  inject: ["action.invoke", "action.register", "graph.read"],
  apply(ctx) {
    ctx.get<ActionRegister>("action.register").register({
      name: "probe.write",
      title: "Write facts",
      input: { type: "object", required: ["facts"] },
      async run(input: { facts: Fact[] }, call: ActionContext) {
        call.write(input.facts);
        return null;
      },
    });
  },
};

async function setup(opts: { db?: string; keep?: number; fold?: number } = {}) {
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const modules: Record<string, Plugin> = { "graph.ts": graph, "action.ts": action, "history.ts": history, "probe.ts": probe };
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length)] }) });
  const tree: TreeEntry[] = [
    { id: "graph", plugin: "graph.ts" },
    { id: "action", plugin: "action.ts" },
    { id: "history", plugin: "history.ts", config: { db: opts.db, keep: opts.keep, fold: opts.fold } },
    { id: "probe", plugin: "probe.ts" },
  ];
  await loader.apply(tree);
  const ctx = loader.fiber("probe")!.ctx.intercept({ actor: { id: "agent:test", kind: "agent" }, run: "r1" });
  const invoke = ctx.get<ActionInvoke>("action.invoke");
  const read = ctx.get<GraphRead>("graph.read");
  const call = <O extends Json = Json>(name: string, input: Json, reason = "a test"): Promise<Outcome<O>> =>
    invoke.invoke<O>({ action: name, input, authority: { of: "agent", basis: "test" }, reason });
  const write = (...facts: Fact[]) => call("probe.write", { facts } as unknown as Json);
  const ok = async <O extends Json>(p: Promise<Outcome<O>>) => {
    const o = await p;
    if (!o.ok) assert.fail(`refused: ${o.refused.code} ${o.refused.message}`);
    return o;
  };
  return { loader, errors, call, write, ok, read, stop: () => loader.apply([]) };
}

test("each committed set is journalled in full, with its inverse; a refused one is not", async () => {
  const h = await setup();
  try {
    const a = await h.ok(h.write(["+", "e1", "type", "task"], ["+", "e1", "status", "todo"]));
    const b = await h.ok(h.write(["-", "e1", "status", "todo"], ["+", "e1", "status", "doing"]));
    const refused = await h.write(["-", "e1", "status", "todo"]);
    assert.equal(refused.ok, false);
    const got = (await h.ok(h.call<Json>("history.get", { change: b.change! }))).output as unknown as Entry;
    assert.equal(got.header.actor.id, "agent:test");
    assert.deepEqual(got.header.authority, { of: "agent", basis: "test" });
    assert.equal(got.header.plugin.id, "probe");
    assert.equal(got.header.action, "probe.write");
    assert.equal(got.header.reason, "a test");
    assert.equal(got.header.run, "r1");
    assert.deepEqual(got.facts, [["-", "e1", "status", "todo"], ["+", "e1", "status", "doing"]]);
    assert.deepEqual(got.inverse, [["-", "e1", "status", "doing"], ["+", "e1", "status", "todo"]]);
    const list = (await h.ok(h.call<Json>("history.list", {}))).output as unknown as Page<Entry>;
    assert.deepEqual(list.items.map((e) => e.id), [b.change, a.change]);
    const byRun = (await h.ok(h.call<Json>("history.list", { run: "nope" }))).output as unknown as Page<Entry>;
    assert.equal(byRun.items.length, 0);
    assert.deepEqual(h.errors, []);
  } finally {
    await h.stop();
  }
});

test("undo applies the inverse as a new set marked undoes; undoing the undo redoes", async () => {
  const h = await setup();
  try {
    await h.ok(h.write(["+", "e1", "type", "task"], ["+", "e1", "status", "todo"]));
    const b = await h.ok(h.write(["-", "e1", "status", "todo"], ["+", "e1", "status", "doing"]));
    const u = await h.ok(h.call("history.undo", { change: b.change! }, "wrong status"));
    assert.equal(u.committed!.header.undoes, b.change);
    assert.equal(u.committed!.header.action, "history.undo");
    assert.equal(u.committed!.header.plugin.id, "history");
    assert.equal(u.committed!.header.reason, "wrong status");
    assert.equal((await h.read.get(["e1"]))[0]!.fields.status, "todo");

    const twice = await h.call("history.undo", { change: b.change! });
    assert.equal(twice.ok, false);
    assert.equal(!twice.ok && twice.refused.code, "history.undone");

    const redo = await h.ok(h.call("history.undo", { change: u.change! }, "it was right"));
    assert.equal((await h.read.get(["e1"]))[0]!.fields.status, "doing");
    const original = (await h.ok(h.call<Json>("history.get", { change: b.change! }))).output as unknown as Entry;
    assert.equal(original.undoneBy, undefined, "redone: the original stands again");
    const undo = (await h.ok(h.call<Json>("history.get", { change: u.change! }))).output as unknown as Entry;
    assert.equal(undo.undoneBy, redo.change);
  } finally {
    await h.stop();
  }
});

test("an undo whose field has moved since is refused by the graph, and changes nothing", async () => {
  const h = await setup();
  try {
    const a = await h.ok(h.write(["+", "e1", "type", "task"], ["+", "e1", "status", "todo"]));
    await h.ok(h.write(["-", "e1", "status", "todo"], ["+", "e1", "status", "done"]));
    const out = await h.call("history.undo", { change: a.change! });
    assert.equal(out.ok, false);
    assert.equal(!out.ok && out.refused.code, "graph.conflict");
    assert.deepEqual((await h.read.get(["e1"]))[0], { id: "e1", type: "task", fields: { status: "done" } });
    const unknown = await h.call("history.undo", { change: "c999" });
    assert.equal(!unknown.ok && unknown.refused.code, "history.unknown");
  } finally {
    await h.stop();
  }
});

test("old entries fold into snapshots of their net change; the graph is untouched", async () => {
  const h = await setup({ keep: 3, fold: 2 });
  try {
    const sets: string[] = [];
    sets.push((await h.ok(h.write(["+", "e1", "type", "task"], ["+", "e1", "status", "todo"]))).change!);
    sets.push((await h.ok(h.write(["-", "e1", "status", "todo"], ["+", "e1", "status", "doing"]))).change!);
    sets.push((await h.ok(h.write(["+", "e2", "type", "task"]))).change!);
    sets.push((await h.ok(h.write(["-", "e1", "status", "doing"], ["+", "e1", "status", "done"]))).change!);
    sets.push((await h.ok(h.write(["+", "e3", "type", "note"]))).change!);
    sets.push((await h.ok(h.write(["-", "e3", "type", "note"]))).change!);
    // Six sets, keep 3 + fold 2: the oldest two folded once.
    const list = (await h.ok(h.call<Json>("history.list", {}))).output as unknown as Page<Entry>;
    assert.deepEqual(list.items.map((e) => e.id), sets.slice(2).reverse());
    const snaps = (await h.ok(h.call<Json>("history.snapshots", {}))).output as unknown as Page<Snapshot>;
    assert.equal(snaps.items.length, 1);
    const s = snaps.items[0]!;
    assert.equal(s.count, 2);
    assert.deepEqual([s.first, s.last], [1, 2]);
    assert.deepEqual(s.actors, ["agent:test"]);
    assert.deepEqual(s.facts, [["+", "e1", "type", "task"], ["+", "e1", "status", "doing"]]);
    const gone = await h.call("history.undo", { change: sets[0]! });
    assert.equal(!gone.ok && gone.refused.code, "history.compacted");
    assert.deepEqual((await h.read.get(["e1"]))[0], { id: "e1", type: "task", fields: { status: "done" } });
  } finally {
    await h.stop();
  }
});

test("net facts: a field's value before a run and after it, nothing for what came and went", () => {
  assert.deepEqual(
    netFacts([
      [["+", "a", "type", "task"], ["+", "b", "x", 1]],
      [["-", "b", "x", 1], ["+", "b", "x", 2], ["-", "c", "y", "old"]],
      [["-", "a", "type", "task"], ["+", "c", "y", "new"]],
    ]),
    [["-", "c", "y", "old"], ["+", "b", "x", 2], ["+", "c", "y", "new"]],
  );
});

test("the journal is kept on disk; unloading the plugin takes its stage and actions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "history-"));
  try {
    const db = join(dir, "history.sqlite");
    let h = await setup({ db });
    const a = await h.ok(h.write(["+", "e1", "type", "task"]));
    await h.stop();
    h = await setup({ db });
    const got = (await h.ok(h.call<Json>("history.get", { change: a.change! }))).output as unknown as Entry;
    assert.deepEqual(got.facts, [["+", "e1", "type", "task"]]);
    await h.loader.edit((t) => t.filter((e) => e.id !== "history"));
    const out = await h.call("history.undo", { change: a.change! });
    assert.equal(!out.ok && out.refused.code, "action.unknown");
    await h.ok(h.write(["+", "e2", "type", "task"]));
    await h.stop();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("history.list item: the sets touching one item, a link's included, a page at a time", async () => {
  const h = await setup();
  try {
    const a = await h.ok(h.write(["+", "e1", "type", "task"], ["+", "e1", "status", "todo"]));
    await h.ok(h.write(["+", "e2", "type", "task"]));
    const l = await h.ok(h.write(["+", "l1", "type", "depends_on"], ["+", "l1", "from", "e2"], ["+", "l1", "to", "e1"]));
    const b = await h.ok(h.write(["-", "e1", "status", "todo"], ["+", "e1", "status", "doing"]));
    const list = async (input: Json) => ((await h.ok(h.call<Json>("history.list", input))).output as unknown as Page<Entry>);
    assert.deepEqual((await list({ item: "e1" })).items.map((e) => e.id), [b.change, l.change, a.change]);
    assert.deepEqual((await list({ item: "e2" })).items.length, 2);
    const first = await list({ item: "e1", limit: 2 });
    assert.deepEqual(first.items.map((e) => e.id), [b.change, l.change]);
    const rest = await list({ item: "e1", limit: 2, after: first.next! });
    assert.deepEqual(rest.items.map((e) => e.id), [a.change]);
    assert.equal(rest.next, undefined);
    const u = await h.ok(h.call("history.undo", { change: b.change! }));
    assert.equal((await list({ item: "e1" })).items[0]!.id, u.change, "the undo touches it too");
  } finally {
    await h.stop();
  }
});

test("a journal kept before items were indexed is indexed when it opens", async () => {
  const dir = await mkdtemp(join(tmpdir(), "history-"));
  try {
    const db = join(dir, "history.sqlite");
    let j = new Journal(db);
    j.record({ id: "c1", seq: 1, committed: "t", header: { actor: { id: "a", kind: "agent" }, authority: { of: "agent", basis: "t" }, plugin: { id: "p" }, action: "x", reason: "r", time: "t" }, facts: [["+", "e1", "type", "task"]] });
    j.db.exec("DELETE FROM touches; DELETE FROM meta WHERE key = 'touches'");
    j.close();
    j = new Journal(db);
    assert.deepEqual(j.entries({ item: "e1" }).items.map((e) => e.id), ["c1"]);
    j.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the log is the truth: kept whole unless keep is set, read oldest first by history.since, and it rebuilds the tables (history.verify)", async () => {
  const h = await setup();
  try {
    for (let i = 0; i < 7; i++) await h.ok(h.write(["+", `e${i}`, "type", "task"], ["+", `e${i}`, "title", `T${i}`]));
    await h.ok(h.write(["-", "e3", "title", "T3"], ["+", "e3", "title", "T3, renamed"]));
    const first = (await h.ok(h.call<Json>("history.since", { limit: 3 }))).output as unknown as Page<Entry> & { begins: number };
    assert.deepEqual([first.items.map((e) => e.seq), first.next, first.begins], [[1, 2, 3], "3", 1]);
    const rest = (await h.ok(h.call<Json>("history.since", { after: first.next!, limit: 500 }))).output as unknown as Page<Entry>;
    assert.deepEqual([rest.items.map((e) => e.seq), rest.next], [[4, 5, 6, 7, 8], undefined]);
    const v = (await h.ok(h.call<Json>("history.verify", {}))).output as unknown as { complete: boolean; sets: number; items: number; differ: number };
    assert.deepEqual([v.complete, v.sets, v.items, v.differ], [true, 8, 7, 0]);
  } finally {
    await h.stop();
  }
  // With keep set, the oldest fold; the folded log still rebuilds the tables.
  const f = await setup({ keep: 2, fold: 2 });
  try {
    for (let i = 0; i < 6; i++) await f.ok(f.write(["+", `e${i}`, "type", "task"]));
    const since = (await f.ok(f.call<Json>("history.since", {}))).output as unknown as Page<Entry> & { begins: number };
    assert.ok(since.items[0]!.seq > 1 && since.begins === 1, "entries begin later; the log, in a snapshot, from the start");
    const v = (await f.ok(f.call<Json>("history.verify", {}))).output as unknown as { complete: boolean; differ: number; items: number };
    assert.deepEqual([v.complete, v.differ, v.items], [true, 0, 6]);
  } finally {
    await f.stop();
  }
});
