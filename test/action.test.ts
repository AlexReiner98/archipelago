import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionAttest, ActionInvoke } from "../spec/action.ts";
import { attested } from "../spec/action.ts";
import type { GraphRead } from "../spec/graph.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import action from "../packs/action/index.ts";
import graph from "../packs/graph/index.ts";
import items from "../packs/items/index.ts";
import links from "../packs/links/index.ts";
import types from "../packs/types/index.ts";
import work from "../packs/work/index.ts";

const BASE = "mem:/packs/";
const probe: Pack = { id: "probe", inject: ["action.invoke", "action.attest", "graph.read"], apply() {} };
const modules: Record<string, Pack> = { graph, action, types, work, links, items, probe };
const TREE: Entry[] = ["graph", "action", "types", "work", "links", "items", "probe"].map((id) => ({ id, pack: `${id}.ts` }));

async function setup() {
  const rt = new Runtime();
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length, -3)] }) });
  await loader.apply(TREE);
  await rt.settle();
  const ctx = loader.fiber("probe")!.ctx;
  return {
    invoke: ctx.get<ActionInvoke>("action.invoke"),
    attest: ctx.get<ActionAttest>("action.attest"),
    read: ctx.get<GraphRead>("graph.read"),
    stop: () => loader.apply([]),
  };
}

test("a change on a test's word is the test's, at its version, and reads back as such", async () => {
  const s = await setup();
  try {
    const made = await s.invoke.invoke({ action: "items.create", input: { type: "work", title: "Lines at most 80 characters" }, authority: { of: "agent", basis: "a test" }, reason: "make a test item" });
    assert.ok(made.ok && made.committed);
    assert.equal(attested(made.committed!.header), undefined);
    const id = (made.output as { id: string }).id;

    const out = await s.attest.invoke({ action: "items.set", input: { id, fields: { note: "fails at faces 3 and 7" } }, attest: { test: id, version: "s1a2b3" }, reason: "The test's result" });
    assert.ok(out.ok, JSON.stringify(out));
    const h = out.committed!.header;
    assert.deepEqual(h.actor, { id: `test:${id}`, kind: "agent" });
    assert.deepEqual(h.authority, { of: "agent", basis: `test ${id} at s1a2b3` });
    assert.deepEqual(attested(h), { test: id, version: "s1a2b3" });
    assert.equal((await s.read.get([id]))[0]?.fields.note, "fails at faces 3 and 7");

    // An agent saying the same words is not a test.
    assert.equal(attested({ actor: { id: "agent:a", kind: "agent" }, authority: { of: "agent", basis: `test ${id} at s1a2b3` } }), undefined);
  } finally {
    await s.stop();
  }
});

test("an attestation is refused without a test on the graph or a version", async () => {
  const s = await setup();
  try {
    const set = (attest: { test: string; version: string }) => s.attest.invoke({ action: "items.set", input: { id: "x", fields: { note: "n" } }, attest, reason: "r" });
    const codes = await Promise.all([set({ test: "nope", version: "v1" }), set({ test: "", version: "v1" }), set({ test: "nope", version: "" }), set({ test: "a b", version: "v1" })]);
    for (const o of codes) {
      assert.equal(o.ok, false);
      if (!o.ok) assert.equal(o.refused.code, "action.attest");
    }
  } finally {
    await s.stop();
  }
});
