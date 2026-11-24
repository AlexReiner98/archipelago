import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ActionInvoke, ActionList, ActionRegister } from "../spec/action.ts";
import type { AgentRun, AgentTree } from "../spec/agent.ts";
import type { ExchangeRead } from "../spec/exchange.ts";
import type { GraphRead, GraphWatch } from "../spec/graph.ts";
import type { Committed } from "../spec/changeset.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import action from "../packs/action/index.ts";
import agent from "../packs/agent/index.ts";
import exchange from "../packs/exchange/index.ts";
import graph from "../packs/graph/index.ts";
import words from "../packs/words/index.ts";
import wordsTool from "../packs/words/tool.ts";
import type { McpHost, ToolDef } from "../packs/mcp/host.ts";
import type { Context } from "../runtime/core.ts";

const BASE = "mem:/packs/";
const T = "2026-11-20T14:00:00.000Z";

const probe: Pack = {
  id: "probe",
  inject: ["agent.run", "agent.tree", "action.invoke", "action.list", "action.register", "graph.read", "graph.watch", "exchange.read"],
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
      exchange: ctx.get<ExchangeRead>("exchange.read"),
    };
  };
  return { rt, loader, errors, as };
}

const tree = (file?: string, seed = [{ title: "Spec", kind: "reflex", at: ["file:spec/**"], words: "Ask Owner first." }]): Entry[] => [
  { id: "graph", pack: "graph.ts", config: { db: file } },
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
  const [node] = p.tree.nodes().filter((n) => n.source);
  assert.equal(node?.title, "Spec");
  assert.ok(node?.source && node.id === `words/${node.source}`);

  const first = await p.run.reach({ run: "r1", places: ["tool:Edit", "file:spec/agent.ts"], time: T });
  assert.deepEqual(first.said.map((s) => s.text), ["Ask Owner first."]);

  const person = as({ id: "person:owner", kind: "person" });
  const out = await person.invoke.invoke({ action: "words.set", input: { node: node.source, words: "spec/ is Owner's." }, authority: { of: "human", basis: "test" }, reason: "edit" });
  assert.ok(out.ok);
  assert.ok(out.ok && out.committed);
  if (out.ok) {
    assert.deepEqual(out.committed!.header.actor, { id: "person:owner", kind: "person" });
    assert.equal(out.committed!.header.pack.id, "words");
    assert.equal(out.committed!.header.action, "words.set");
    assert.deepEqual(out.committed!.facts, [["-", node.source, "words", "Ask Owner first."], ["+", node.source, "words", "spec/ is Owner's."]]);
  }

  const next = await p.run.reach({ run: "r1", places: ["file:spec/agent.ts"], time: T });
  assert.deepEqual(next.said.map((s) => s.text), ["spec/ is Owner's."]);
  await loader.apply([]);
});

test("words.title renames a node: one change set, and the tree shows the new name; empty or not a node is refused", async () => {
  const { rt, loader, errors, as } = setup();
  await loader.apply(tree());
  await rt.settle();
  const person = as({ id: "person:owner", kind: "person" });
  const [node] = person.tree.nodes().filter((n) => n.source);
  const act = (input: Record<string, unknown>) => person.invoke.invoke({ action: "words.title", input: input as never, authority: { of: "human", basis: "test" }, reason: "rename" });
  const out = await act({ node: node!.source, title: "The spec is the contract" });
  assert.ok(out.ok && out.committed);
  if (out.ok) assert.deepEqual(out.committed!.facts, [["-", node!.source, "title", "Spec"], ["+", node!.source, "title", "The spec is the contract"]]);
  await rt.settle();
  assert.equal(person.tree.nodes().filter((n) => n.source)[0]?.title, "The spec is the contract");
  const empty = await act({ node: node!.source, title: "  " });
  assert.ok(!empty.ok && empty.refused.code === "words.title");
  const none = await act({ node: "n_none", title: "X" });
  assert.ok(!none.ok && none.refused.code === "words.not_a_node");
  assert.deepEqual(errors, []);
  await loader.apply([]);
});

test("a refusing node refuses; changing its places re-registers it", async () => {
  const { rt, loader, as } = setup();
  await loader.apply(tree(undefined, [{ title: "No .env", kind: "rule", at: ["file:.env"], words: "Secrets.", refuse: true } as never]));
  await rt.settle();
  const p = as({ id: "e_agent", kind: "agent" });
  const [node] = p.tree.nodes().filter((n) => n.source);
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
  assert.deepEqual(p.tree.nodes().filter((n) => n.source)[0]?.at, ["file:secrets/**"]);
  assert.equal((await p.run.reach({ run: "r1", places: ["file:.env"], time: T })).refused, undefined);
  await loader.apply([]);
});

test("the graph refuses a retraction of a value it doesn't hold, whole", async () => {
  const { rt, loader, as } = setup();
  await loader.apply(tree());
  await rt.settle();
  const p = as();
  const [node] = p.tree.nodes().filter((n) => n.source);
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
  const file = join(dir, "graph.sqlite");
  try {
    const one = setup();
    await one.loader.apply(tree(file));
    await one.rt.settle();
    const p = one.as();
    const heard: Committed[] = [];
    p.watch.watch({ types: ["node"] }, (c) => heard.push(c));
    const [node] = p.tree.nodes().filter((n) => n.source);
    await p.invoke.invoke({ action: "words.set", input: { node: node!.source!, words: "kept" }, authority: { of: "agent" }, reason: "c" });
    assert.equal(heard.length, 1);
    await one.loader.apply([]);

    const two = setup();
    await two.loader.apply(tree(file));
    await two.rt.settle();
    const q = two.as();
    assert.equal(q.tree.nodes().filter((n) => n.source).length, 1, "not seeded again");
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

const STANDING = { title: "Ask first", kind: "instruction", at: ["session_start", "file:spec/**"], words: "Ask Owner before the spec changes." };
const owner = { of: "human" as const, basis: "test" };

test("words.say listed: one line at session_start, the whole words at its other places; default whole", async () => {
  const { rt, loader, errors, as } = setup();
  await loader.apply(tree(undefined, [STANDING]));
  await rt.settle();
  const p = as({ id: "e_agent", kind: "agent" });
  const [node] = p.tree.nodes().filter((n) => n.source);
  const start = await p.run.reach({ run: "r1", places: ["session_start"], time: T });
  assert.deepEqual(start.said.map((s) => s.text), ["Ask Owner before the spec changes."], "whole by default");

  const out = await p.invoke.invoke({ action: "words.say", input: { node: node!.source!, say: "listed" }, authority: owner, reason: "list it" });
  assert.ok(out.ok && out.committed);
  if (out.ok) assert.deepEqual(out.committed!.facts, [["+", node!.source, "say", "listed"]]);
  const bad = await p.invoke.invoke({ action: "words.say", input: { node: node!.source!, say: "loud" }, authority: owner, reason: "x" });
  assert.ok(!bad.ok && bad.refused.code === "words.say");

  const line = await p.run.reach({ run: "r2", places: ["session_start"], time: T });
  assert.deepEqual(line.said.map((s) => s.text), [`Ask first: said in full at file:spec/**; its words from the words tool, node ${node!.source}.`]);
  const full = await p.run.reach({ run: "r2", places: ["tool:Edit", "file:spec/agent.ts"], time: T });
  assert.deepEqual(full.said.map((s) => s.text), ["Ask Owner before the spec changes."]);

  const back = await p.invoke.invoke({ action: "words.say", input: { node: node!.source!, say: "whole" }, authority: owner, reason: "whole" });
  if (back.ok) assert.deepEqual(back.committed!.facts, [["-", node!.source, "say", "listed"]]);
  assert.deepEqual(errors, []);
  await loader.apply([]);
});

test("a node a run heard is told as the change at its next prompt: reworded, its new words; retired, one line; once", async () => {
  const { rt, loader, errors, as } = setup();
  await loader.apply(
    tree(undefined, [STANDING, { title: "Bash", kind: "reflex", at: ["session_start"], words: "Prefer Read." }, { title: "Unheard", kind: "reflex", at: ["tool:Bash"], words: "Careful." }]),
  );
  await rt.settle();
  const p = as({ id: "e_agent", kind: "agent" });
  const [ask, bash, unheard] = p.tree.nodes().filter((n) => n.source);
  await p.run.reach({ run: "r1", places: ["session_start"], time: T });
  // Nothing changed: the change node is quiet.
  assert.deepEqual((await p.run.reach({ run: "r1", places: ["prompt"], time: T })).said, []);

  await p.invoke.invoke({ action: "words.set", input: { node: ask!.source!, words: "The spec is Owner's." }, authority: owner, reason: "reword" });
  await p.invoke.invoke({ action: "words.retire", input: { node: bash!.source! }, authority: owner, reason: "retire" });
  await p.invoke.invoke({ action: "words.retire", input: { node: unheard!.source! }, authority: owner, reason: "never heard" });
  await rt.settle();
  const told = await p.run.reach({ run: "r1", places: ["prompt"], time: T });
  assert.deepEqual(told.said, [
    { node: "words/changed", text: 'Changed on the map since you heard them:\n- "Ask first" now says: The spec is Owner\'s.\n- "Bash" no longer applies: it was retired on the map.' },
  ]);
  // Told once; and at its own place the node doesn't say the same new words again.
  assert.deepEqual((await p.run.reach({ run: "r1", places: ["prompt"], time: T })).said, []);
  assert.deepEqual((await p.run.reach({ run: "r1", places: ["file:spec/agent.ts"], time: T })).said, []);
  // A run that heard nothing is told nothing.
  assert.deepEqual((await p.run.reach({ run: "r2", places: ["prompt"], time: T })).said, []);
  assert.deepEqual(errors, []);
  await loader.apply([]);
});

test("reworded where the run hears it before a prompt: the node's new words, recorded as reworded; a compact forgets", async () => {
  const { rt, loader, errors, as } = setup();
  await loader.apply(tree());
  await rt.settle();
  const p = as({ id: "e_agent", kind: "agent" });
  const [node] = p.tree.nodes().filter((n) => n.source);
  await p.run.reach({ run: "r1", places: ["file:spec/agent.ts"], time: T });
  await p.invoke.invoke({ action: "words.set", input: { node: node!.source!, words: "spec/ is Owner's." }, authority: owner, reason: "reword" });
  const again = await p.run.reach({ run: "r1", places: ["file:spec/x.ts"], time: T });
  assert.deepEqual(again.said.map((s) => s.text), ["spec/ is Owner's."]);
  // Heard at its place: nothing left to tell at the prompt.
  assert.deepEqual((await p.run.reach({ run: "r1", places: ["prompt"], time: T })).said, []);

  // After a compact nothing is in the context: a change is not told, the node says its words as new.
  await p.invoke.invoke({ action: "words.set", input: { node: node!.source!, words: "Third." }, authority: owner, reason: "reword" });
  await p.run.reach({ run: "r1", places: ["compact"], time: T });
  assert.deepEqual((await p.run.reach({ run: "r1", places: ["prompt"], time: T })).said, []);

  const says = (await p.exchange.events("r1")).items.filter((e) => e.kind === "say");
  assert.deepEqual(says.map((e) => [e.text, (e.detail as { reworded?: boolean } | undefined)?.reworded ?? false]), [
    ["Ask Owner first.", false],
    ["spec/ is Owner's.", true],
  ]);
  assert.deepEqual(errors, []);
  await loader.apply([]);
});

test("the words tool: a node's whole words by id or title, the listed ones without input; the run then counts as having heard them", async () => {
  const served = new Map<string, ToolDef>();
  const host: Pack = {
    id: "host",
    apply(ctx: Context) {
      ctx.provide<McpHost>("mcp.host", (_c, from) => ({
        harness: "test",
        place: (t) => `tool:mcp__archipelago__${t}`,
        add: (def) => from.effect(() => (served.set(def.name, def), () => void served.delete(def.name))),
      }));
    },
  };
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const modules: Record<string, Pack> = { "graph.ts": graph, "action.ts": action, "exchange.ts": exchange, "agent.ts": agent, "words.ts": words, "host.ts": host, "tool.ts": wordsTool, "probe.ts": probe };
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length)] }) });
  await loader.apply([
    ...tree(undefined, [{ ...STANDING, say: "listed" } as never, { title: "Bash", kind: "reflex", at: ["tool:Bash"], words: "Prefer Read." }]),
    { id: "host", pack: "host.ts" },
    { id: "words-tool", pack: "tool.ts" },
  ]);
  await rt.settle();
  const ctx = loader.fiber("probe")!.ctx.intercept({ actor: { id: "e_agent", kind: "agent" }, run: "r1" });
  const agentRun = ctx.get<AgentRun>("agent.run");
  const invoke = ctx.get<ActionInvoke>("action.invoke");
  const tool = served.get("words")!;
  assert.ok(tool, "served as words");
  const [ask] = ctx.get<AgentTree>("agent.tree").nodes().filter((n) => n.source);
  const call = (args: object) => tool.call(args as never, { run: "r1", actor: { id: "e_agent", kind: "agent" }, agent: agentRun, invoke });

  assert.equal((await call({})).text, `Ask first: said in full at file:spec/**; its words from the words tool, node ${ask!.source}.`);
  assert.equal((await call({ node: ask!.source })).text, "Ask first\n\nAsk Owner before the spec changes.");
  assert.equal((await call({ node: "bash" })).text, "Bash\n\nPrefer Read.");
  assert.ok((await call({ node: "nothing" })).isError);

  // Handed whole by the tool: a rewording is told at the next prompt.
  await invoke.invoke({ action: "words.set", input: { node: ask!.source!, words: "Owner's." }, authority: owner, reason: "reword" });
  const told = await agentRun.reach({ run: "r1", places: ["prompt"], time: T });
  assert.deepEqual(told.said.map((s) => s.text), [`Changed on the map since you heard them:\n- "Ask first" now says: Owner's.`]);
  assert.deepEqual(errors, []);
  await loader.apply([]);
});

test("a node heard while the change node was reading (said at the same moment) is not told as retired", async () => {
  const { changes } = await import("../packs/words/heard.ts");
  const heard = new Map([
    ["n_a", { text: "Old words.", title: "A", listed: false }],
    ["n_b", { text: "Just said.", title: "B", listed: false }],
  ]);
  // The change node read only n_a; n_b was heard after (another node at the same prompt).
  const now = new Map([["n_a", { id: "n_a", type: "node", fields: { title: "A", words: "Old words." } }]]);
  assert.deepEqual(changes(heard, now as never, "TRIAL"), [], "nothing changed, nothing retired");
  assert.ok(heard.has("n_b"), "and it stays heard, to be checked next time");
  const gone = new Map([["n_a", null], ["n_b", null]]);
  assert.deepEqual(changes(heard, gone as never, "TRIAL"), ['"A" no longer applies: it was retired on the map.', '"B" no longer applies: it was retired on the map.'], "read and gone: retired");
});
