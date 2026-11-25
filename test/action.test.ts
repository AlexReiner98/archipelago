import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionAttest, ActionInvoke } from "../spec/action.ts";
import { attested } from "../spec/action.ts";
import type { Json } from "../spec/common.ts";
import type { GraphRead } from "../spec/graph.ts";
import { Runtime, type Plugin } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import action from "../plugins/action/index.ts";
import { check, fixIn, fixLine, message } from "../plugins/action/input.ts";
import graph from "../plugins/graph/index.ts";
import items from "../plugins/items/index.ts";
import links from "../plugins/links/index.ts";
import types from "../plugins/types/index.ts";
import work from "../plugins/work/index.ts";

const BASE = "mem:/plugins/";
const probe: Plugin = { id: "probe", inject: ["action.invoke", "action.attest", "graph.read"], apply() {} };
const modules: Record<string, Plugin> = { graph, action, types, work, links, items, probe };
const TREE: Entry[] = ["graph", "action", "types", "work", "links", "items", "probe"].map((id) => ({ id, plugin: `${id}.ts` }));

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

test("an input that doesn't fit its schema is refused with how to fix it, and the input fixed", async () => {
  const s = await setup();
  try {
    const owner = { of: "agent" as const, basis: "a test" };
    const bad = await s.invoke.invoke({ action: "items.create", input: { type: "work", title: 42 }, authority: owner, reason: "a number for a title" });
    assert.ok(!bad.ok);
    assert.equal(bad.refused.code, "action.input");
    assert.equal(bad.refused.message, "items.create: /title wants a string.");
    assert.deepEqual(bad.refused.detail, { fix: [{ path: "/title", expected: "a string", example: "42" }], input: { type: "work", title: "42" } });

    const none = await s.invoke.invoke({ action: "items.create", input: { type: "work" }, authority: owner, reason: "no title" });
    assert.ok(!none.ok);
    assert.deepEqual(none.refused.detail, { fix: [{ path: "/title", expected: "a string: it is required", example: "<title>" }], input: { type: "work", title: "<title>" } });

    // The input fixed is what passes.
    const again = await s.invoke.invoke({ action: "items.create", input: (bad.refused.detail as { input: Json }).input, authority: owner, reason: "sent the fix" });
    assert.ok(again.ok);
  } finally {
    await s.stop();
  }
});

test("check: kinds, enums, lists, unknown keys and nesting each give a fix at their path", () => {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: {
      id: { type: "string" },
      status: { type: "string", enum: ["todo", "done"] },
      at: { type: "array", items: { type: "string" } },
      count: { type: "integer" },
      on: { type: "boolean" },
      to: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
    },
  };
  assert.equal(check(schema, { id: "x", status: "todo", at: ["a"] }), undefined, "an input that fits passes");
  const r = check(schema, { id: "x", status: "built", at: "file:a", count: "3", on: "true", to: {}, colour: "red" })!;
  assert.deepEqual(r.fix, [
    { path: "/status", expected: "one of todo, done", example: "todo" },
    { path: "/at", expected: "a list, each a string", example: ["file:a"] },
    { path: "/count", expected: "a whole number", example: 3 },
    { path: "/on", expected: "true or false", example: true },
    { path: "/to/id", expected: "a string: it is required", example: "<id>" },
    { path: "/colour", expected: "not here: it takes id, status, at, count, on, to", example: null },
  ]);
  assert.deepEqual(r.input, { id: "x", status: "todo", at: ["file:a"], count: 3, on: true, to: { id: "<id>" } });
  assert.deepEqual(check(schema, [1])!.fix, [{ path: "", expected: "an object", example: { id: "<id>" } }]);
  assert.deepEqual(check({ type: "object", properties: { at: { type: "array", items: { type: "string" } } } }, { at: ["a", 2] })!.fix, [{ path: "/at/1", expected: "a string", example: "2" }]);
  assert.equal(message("x.y", r).startsWith("x.y: /status wants one of todo, done; /at wants"), true);
  // Written after a refusal's words, and read back by the harness.
  assert.deepEqual(fixIn(`Refused (action.input): ${message("x.y", r)}\n${fixLine(r)}`), r);
  assert.equal(fixIn("Refused (items.set): no"), undefined);
});
