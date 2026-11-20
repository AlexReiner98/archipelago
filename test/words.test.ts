import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ActionInvoke, ActionList, ActionRegister } from "../spec/action.ts";
import type { AgentRun, AgentTree } from "../spec/agent.ts";
import type { GraphRead, GraphWatch } from "../spec/graph.ts";
import type { Committed } from "../spec/changeset.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import action from "../packs/action/index.ts";
import agent from "../packs/agent/index.ts";
import exchange from "../packs/exchange/index.ts";
import graph from "../packs/graph/index.ts";
import words from "../packs/words/index.ts";

const BASE = "mem:/packs/";
const T = "2026-11-20T14:00:00.000Z";

const probe: Pack = {
  id: "probe",
  inject: ["agent.run", "agent.tree", "action.invoke", "action.list", "action.register", "graph.read", "graph.watch"],
  apply() {},
};

function setup() {
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const modules: Record<string, Pack> = { "graph.ts": graph, "action.ts": action, "exchange.ts": exchange, "agent.ts": agent, "words.ts": words, "probe.ts": probe };
  const loader = new Loader(rt, {
    base: BASE,
    import: async (url) => ({ default: modules[url.slice(BASE.length)] }),
  });
  const as = (actor?: { id: string; kind: "person" | "agent" }) => {
    const base = loader.fiber("probe")!.ctx;
    const ctx = actor ? base.intercept({ actor, run: "r1" }) : base;
    return {
      run: ctx.get<AgentRun>("agent.run"),
      tree: ctx.get<AgentTree>("agent.tree"),
      invoke: ctx.get<ActionInvoke>("action.invoke"),
      list: ctx.get<ActionList>("action.list"),
      register: ctx.get<ActionRegister>("action.register"),
      read: ctx.get<GraphRead>("graph.read"),
      watch: ctx.get<GraphWatch>("graph.watch"),
    };
  };
  return { rt, loader, errors, as };
}

const tree = (file?: string, seed = [{ title: "Spec", kind: "reflex", at: ["file:spec/**"], words: "Ask Alex first." }]): Entry[] => [
  { id: "graph", pack: "graph.ts", config: { file } },
  { id: "action", pack: "action.ts" },
  { id: "exchange", pack: "exchange.ts" },
  { id: "agent", pack: "agent.ts" },
  { id: "words", pack: "words.ts", config: { seed } },
  { id: "probe", pack: "probe.ts" },
];

test("a seeded node speaks its words; an edit through words.set is what the next say uses", async () => {
  const { rt, loader, errors, as } = setup();
  await loader.apply(tree());
  await rt.settle();
  assert.deepEqual(errors, []);
  const p = as({ id: "e_agent", kind: "agent" });
  const [node] = p.tree.nodes();
  assert.equal(node?.title, "Spec");
  assert.ok(node?.source && node.id === `words/${node.source}`);

  const first = await p.run.reach({ run: "r1", places: ["tool:Edit", "file:spec/agent.ts"], time: T });
  assert.deepEqual(first.said.map((s) => s.text), ["Ask Alex first."]);

  const person = as({ id: "person:alex", kind: "person" });
  const out = await person.invoke.invoke({ action: "words.set", input: { node: node.source, words: "spec/ is Alex's." }, authority: { of: "human", basis: "test" }, reason: "edit" });
  assert.ok(out.ok);
  assert.ok(out.ok && out.committed);
  if (out.ok) {
    assert.deepEqual(out.committed!.header.actor, { id: "person:alex", kind: "person" });
    assert.equal(out.committed!.header.pack.id, "words");
    assert.equal(out.committed!.header.action, "words.set");
    assert.deepEqual(out.committed!.facts, [["-", node.source, "words", "Ask Alex first."], ["+", node.source, "words", "spec/ is Alex's."]]);
  }

  const next = await p.run.reach({ run: "r1", places: ["file:spec/agent.ts"], time: T });
  assert.deepEqual(next.said.map((s) => s.text), ["spec/ is Alex's."]);
  await loader.apply([]);
});

test("a refusing node refuses; changing its places re-registers it", async () => {
  const { rt, loader, as } = setup();
  await loader.apply(tree(undefined, [{ title: "No .env", kind: "rule", at: ["file:.env"], words: "Secrets.", refuse: true } as never]));
  await rt.settle();
  const p = as({ id: "e_agent", kind: "agent" });
  const [node] = p.tree.nodes();
  const a = await p.run.reach({ run: "r1", places: ["tool:Read", "file:.env"], time: T });
  assert.equal(a.refused?.text, "Secrets.");

  // A change to `at`, through an action of the probe's own, moves where it listens.
  p.register.register({
    name: "probe.move",
    title: "move",
    input: {},
    async run(_i, call) {
      call.write([["-", node!.source!, "at", ["file:.env"]], ["+", node!.source!, "at", ["file:secrets/**"]]]);
      return null;
    },
  });
  assert.ok((await p.invoke.invoke({ action: "probe.move", input: {}, authority: { of: "agent" }, reason: "move" })).ok);
  await rt.settle();
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(p.tree.nodes()[0]?.at, ["file:secrets/**"]);
  assert.equal((await p.run.reach({ run: "r1", places: ["file:.env"], time: T })).refused, undefined);
  await loader.apply([]);
});

test("the graph refuses a retraction of a value it doesn't hold, whole", async () => {
  const { rt, loader, as } = setup();
  await loader.apply(tree());
  await rt.settle();
  const p = as();
  const [node] = p.tree.nodes();
  const out = await p.invoke.invoke({ action: "words.set", input: { node: node!.source!, words: "x" }, authority: { of: "agent" }, reason: "a" });
  assert.ok(out.ok);
  p.register.register({
    name: "probe.stale",
    title: "stale",
    input: {},
    async run(_i, call) {
      call.write([["+", "e_new", "type", "thing"], ["-", node!.source!, "words", "not what it holds"]]);
      return null;
    },
  });
  const bad = await p.invoke.invoke({ action: "probe.stale", input: {}, authority: { of: "agent" }, reason: "b" });
  assert.equal(bad.ok, false);
  assert.equal(!bad.ok && bad.refused.code, "graph.conflict");
  assert.deepEqual(await p.read.get(["e_new"]), [null]);
  // An action named outside the caller's pack is refused.
  assert.throws(() => p.register.register({ name: "words.fake", title: "", input: {}, run: async () => null }), /only register actions named probe/);
  await loader.apply([]);
});

test("the graph is kept on disk and read back; watchers hear each change set", async () => {
  const dir = await mkdtemp(join(tmpdir(), "graph-"));
  const file = join(dir, "graph.json");
  try {
    const one = setup();
    await one.loader.apply(tree(file));
    await one.rt.settle();
    const p = one.as();
    const heard: Committed[] = [];
    p.watch.watch({ types: ["node"] }, (c) => heard.push(c));
    const [node] = p.tree.nodes();
    await p.invoke.invoke({ action: "words.set", input: { node: node!.source!, words: "kept" }, authority: { of: "agent" }, reason: "c" });
    assert.equal(heard.length, 1);
    await one.loader.apply([]);

    const two = setup();
    await two.loader.apply(tree(file));
    await two.rt.settle();
    const q = two.as();
    assert.equal(q.tree.nodes().length, 1, "not seeded again");
    const [item] = await q.read.get([node!.source!]);
    assert.equal(item?.fields.words, "kept");
    await two.loader.apply([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("unloading the words pack takes its nodes and actions", async () => {
  const { rt, loader, as } = setup();
  await loader.apply(tree());
  await rt.settle();
  const p = as();
  assert.ok(p.list.list().some((a) => a.name === "words.set"));
  await loader.edit((t) => (t.find((e) => e.id === "words")!.disabled = true, t));
  await rt.settle();
  assert.equal(p.tree.nodes().length, 0);
  assert.ok(!p.list.list().some((a) => a.name.startsWith("words.")));
  await loader.apply([]);
});
