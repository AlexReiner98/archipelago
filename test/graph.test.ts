import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Committed, Header, Proposed } from "../spec/changeset.ts";
import { inverse } from "../spec/changeset.ts";
import { Refused } from "../spec/common.ts";
import type { GraphCommit, GraphRead, GraphStage, GraphWatch } from "../spec/graph.ts";
import { LIMIT_MAX } from "../spec/graph.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader } from "../runtime/loader.ts";
import graph from "../packs/graph/index.ts";
import { Store } from "../packs/graph/store.ts";
import { exportSets, fromLines, importSets, setsOf, toLines } from "../packs/graph/interchange.ts";

const header: Header = {
  actor: { id: "person:test", kind: "person" },
  authority: { of: "agent" },
  pack: { id: "test" },
  action: "test.write",
  reason: "a test",
  time: "2026-11-20T00:00:00.000Z",
};
const set = (...facts: Proposed["facts"]): Proposed => ({ header, facts });

async function start(db?: string, stages: Pack[] = []) {
  const probe: Pack = { id: "probe", inject: ["graph.read", "graph.watch", "graph.commit", "graph.stage"], apply() {} };
  const modules: Record<string, Pack> = { "graph.ts": graph, "probe.ts": probe };
  for (const s of stages) modules[`${s.id}.ts`] = s;
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const loader = new Loader(rt, { base: "mem:/", import: async (url) => ({ default: modules[url.slice(5)]! }) });
  await loader.apply([
    { id: "graph", pack: "graph.ts", config: db ? { db } : {} },
    ...stages.map((s) => ({ id: s.id, pack: `${s.id}.ts` })),
    { id: "probe", pack: "probe.ts" },
  ]);
  const ctx = loader.fiber("probe")!.ctx;
  return {
    loader,
    errors,
    read: ctx.get<GraphRead>("graph.read"),
    watch: ctx.get<GraphWatch>("graph.watch"),
    commit: (c: Proposed) => ctx.get<GraphCommit>("graph.commit").commit(c),
    stop: () => loader.apply([]),
  };
}

test("items, links and types: bounded reads in a stable order, links by end and type", async () => {
  const g = await start();
  try {
    await g.commit(set(["+", "a", "type", "task"], ["+", "a", "title", "A"], ["+", "b", "type", "task"], ["+", "c", "type", "note"]));
    await g.commit(set(["+", "l1", "type", "depends_on"], ["+", "l1", "from", "a"], ["+", "l1", "to", "b"]));
    await g.commit(set(["+", "l2", "type", "about"], ["+", "l2", "from", "c"], ["+", "l2", "to", "a"]));
    assert.deepEqual(await g.read.get(["b", "zz", "a"]), [
      { id: "b", type: "task", fields: {} },
      null,
      { id: "a", type: "task", fields: { title: "A" } },
    ]);
    assert.deepEqual((await g.read.of("task")).items.map((i) => i.id), ["a", "b"]);
    const out = await g.read.links("a", { dir: "out" });
    assert.deepEqual(out.items, [{ id: "l1", type: "depends_on", fields: { from: "a", to: "b" }, from: "a", to: "b" }]);
    assert.deepEqual((await g.read.links("a", { dir: "in" })).items.map((l) => l.id), ["l2"]);
    assert.deepEqual((await g.read.links("a", { dir: "both" })).items.map((l) => l.id), ["l1", "l2"]);
    assert.deepEqual((await g.read.links("a", { dir: "both", type: "about" })).items.map((l) => l.id), ["l2"]);
    // Changing a field keeps an item's place; a link's ends move with its fields.
    await g.commit(set(["-", "a", "title", "A"], ["+", "a", "title", "A2"], ["-", "l1", "to", "b"], ["+", "l1", "to", "c"]));
    assert.deepEqual((await g.read.of("task")).items.map((i) => i.id), ["a", "b"]);
    assert.deepEqual((await g.read.links("c", { dir: "in" })).items.map((l) => l.id), ["l1"]);
    assert.deepEqual((await g.read.links("b", { dir: "in" })).items, []);
  } finally {
    await g.stop();
  }
});

test("no read returns more than a page: of, links and since page on, never the whole graph", async () => {
  const g = await start();
  try {
    const facts: Proposed["facts"] = [];
    for (let i = 0; i < LIMIT_MAX + 20; i++) facts.push(["+", `n${i}`, "type", "node"], ["+", `e${i}`, "type", "ref"], ["+", `e${i}`, "from", "hub"], ["+", `e${i}`, "to", `n${i}`]);
    await g.commit(set(...facts));
    const big = await g.read.of("node", { limit: 10_000 });
    assert.equal(big.items.length, LIMIT_MAX);
    assert.ok(big.next);
    const rest = await g.read.of("node", { limit: 10_000, after: big.next });
    assert.equal(rest.items.length, 20);
    assert.equal(rest.next, undefined);
    assert.equal(rest.items[0]!.id, `n${LIMIT_MAX}`);
    let seen = 0;
    for (let p = await g.read.links("hub", { dir: "out" }, { limit: 7 }); ; p = await g.read.links("hub", { dir: "out" }, { limit: 7, after: p.next })) {
      assert.ok(p.items.length <= 7);
      seen += p.items.length;
      if (!p.next) break;
    }
    assert.equal(seen, LIMIT_MAX + 20);
    assert.equal((await g.read.get(Array.from({ length: LIMIT_MAX + 5 }, (_, i) => `n${i}`))).length, LIMIT_MAX);
    for (let i = 0; i < 5; i++) await g.commit(set(["+", `x${i}`, "type", "x"]));
    const s = await g.read.since({ limit: 2 });
    assert.deepEqual(s.items.map((c) => c.seq), [1, 2]);
    const s2 = await g.read.since({ limit: 100, after: s.next });
    assert.deepEqual(s2.items.map((c) => c.seq), [3, 4, 5, 6]);
    assert.equal(s2.next, undefined);
  } finally {
    await g.stop();
  }
});

test("a set applies whole or not at all: a conflict refuses it and changes nothing", async () => {
  const g = await start();
  try {
    await g.commit(set(["+", "a", "type", "task"], ["+", "a", "status", "todo"]));
    const before = await g.read.now();
    await assert.rejects(
      g.commit(set(["+", "b", "type", "task"], ["-", "a", "status", "doing"])),
      (e: unknown) => e instanceof Refused && e.refusal.code === "graph.conflict",
    );
    await assert.rejects(g.commit(set(["+", "a", "status", "done"])), Refused);
    assert.deepEqual(await g.read.get(["a", "b"]), [{ id: "a", type: "task", fields: { status: "todo" } }, null]);
    assert.equal(await g.read.now(), before);
    // The inverse undoes it exactly: the item is gone.
    const c = await g.commit(set(["+", "z", "type", "task"], ["+", "z", "title", "Z"]));
    await g.commit(set(...inverse(c.facts)));
    assert.deepEqual(await g.read.get(["z"]), [null]);
  } finally {
    await g.stop();
  }
});

test("watch is live and narrowed by ids, types and fields; a watcher by type hears of a removal", async () => {
  const g = await start();
  try {
    const heard: Record<string, number[]> = { all: [], task: [], title: [], b: [] };
    g.watch.watch({}, (c) => heard.all!.push(c.seq));
    g.watch.watch({ types: ["task"] }, (c) => heard.task!.push(c.seq));
    g.watch.watch({ fields: ["title"] }, (c) => heard.title!.push(c.seq));
    const off = g.watch.watch({ ids: ["b"] }, (c) => heard.b!.push(c.seq));
    await g.commit(set(["+", "a", "type", "task"], ["+", "a", "title", "A"])); // 1
    await g.commit(set(["+", "b", "type", "note"])); // 2
    await g.commit(set(["-", "a", "title", "A"], ["-", "a", "type", "task"])); // 3: a removal
    await off();
    await g.commit(set(["+", "b", "title", "B"])); // 4
    assert.deepEqual(heard, { all: [1, 2, 3, 4], task: [1, 3], title: [1, 3, 4], b: [2] });
  } finally {
    await g.stop();
  }
});

test("the store outlives a restart: items, the cursor, and a watcher resuming after it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "graph-"));
  const db = join(dir, "graph.sqlite");
  try {
    let g = await start(db);
    await g.commit(set(["+", "a", "type", "task"]));
    const cursor = await g.read.now();
    await g.commit(set(["+", "b", "type", "task"]));
    await g.stop();

    g = await start(db);
    assert.deepEqual((await g.read.of("task")).items.map((i) => i.id), ["a", "b"]);
    assert.equal(await g.read.now(), "2");
    const heard: number[] = [];
    g.watch.watch({ after: cursor }, (c) => heard.push(c.seq));
    assert.deepEqual(heard, [2], "caught up from the cursor");
    const c = await g.commit(set(["+", "c", "type", "task"]));
    assert.equal(c.id, "c3", "ids go on from where they were");
    assert.deepEqual(heard, [2, 3]);
    await g.stop();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the write chain: stages in config order, a check refuses before the store, a record sees only what applied", async () => {
  const order: string[] = [];
  const recorded: Committed[] = [];
  const check: Pack = {
    id: "check",
    inject: ["graph.stage"],
    apply(ctx) {
      ctx.get<GraphStage>("graph.stage").stage(async (c, next) => {
        order.push("check");
        if (c.facts.some(([, , f]) => f === "forbidden")) throw new Refused({ code: "check.no", message: "no", by: { pack: "check" } });
        return next(c);
      });
    },
  };
  const record: Pack = {
    id: "record",
    inject: ["graph.stage"],
    apply(ctx) {
      ctx.get<GraphStage>("graph.stage").stage(async (c, next) => {
        order.push("record");
        const done = await next(c);
        recorded.push(done);
        return done;
      });
    },
  };
  const g = await start(undefined, [check, record]);
  try {
    await g.commit(set(["+", "a", "type", "task"]));
    await assert.rejects(g.commit(set(["+", "a", "forbidden", true])), Refused);
    await assert.rejects(g.commit(set(["+", "a", "type", "other"])), Refused);
    assert.deepEqual(order, ["check", "record", "check", "check", "record"]);
    assert.deepEqual(recorded.map((c) => c.id), ["c1"]);
  } finally {
    await g.stop();
  }
});

test("the interchange format: a graph exported as change sets imports into another store as it was", () => {
  const a = new Store();
  const b = new Store();
  try {
    const items: [string, Record<string, import("../spec/common.ts").Json>][] = [];
    for (let i = 0; i < 1203; i++) items.push([`i${i}`, { type: i % 3 ? "node" : "loaded", title: `item ${i}`, props: { n: i, tags: ["x"] } }]);
    items.push(["l1", { type: "ref", from: "i1", to: "i2" }]);
    importSets(a, setsOf(items, header));
    const lines = toLines(exportSets(a, header));
    const sets = [...fromLines(lines)];
    assert.equal(sets.length, Math.ceil(1204 / LIMIT_MAX));
    assert.deepEqual(importSets(b, sets), { sets: sets.length, facts: 1203 * 3 + 3 });
    assert.deepEqual(b.counts(), a.counts());
    assert.deepEqual(b.counts(), { items: 1204, types: { loaded: 401, node: 802, ref: 1 } });
    for (let after: string | undefined, pa = a.all(), pb = b.all(); ; ) {
      assert.deepEqual(pb.items, pa.items);
      after = pa.next;
      if (!after) break;
      pa = a.all({ after });
      pb = b.all({ after: pb.next });
    }
    assert.deepEqual(b.links("i1", { dir: "out" }).items.map((l) => l.id), ["l1"]);
  } finally {
    a.close();
    b.close();
  }
});
