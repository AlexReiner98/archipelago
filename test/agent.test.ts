import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentNode, AgentRun, AgentTree, Moment, NodeDef } from "../spec/agent.ts";
import type { ExchangeEvent, ExchangeRead, ExchangeWatch } from "../spec/exchange.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import agent, { placeMatches, refusable } from "../packs/agent/index.ts";
import exchange from "../packs/exchange/index.ts";

const BASE = "mem:/packs/";
const T = "2026-11-20T14:00:00.000Z";

/** A node as config: data, since the config tree is data. */
interface NodeSpec {
  name: string;
  kind: string;
  at: string[];
  say?: string;
  refuse?: string;
  throws?: string;
  repeat?: "once" | "every";
}

/** A pack that registers the nodes it is configured with. */
const nodes: Pack<{ nodes: NodeSpec[] }> = {
  id: "nodes",
  inject: ["agent.node"],
  apply(ctx, config) {
    const reg = ctx.get<AgentNode>("agent.node");
    for (const n of config.nodes) {
      const def: NodeDef = {
        name: n.name,
        kind: n.kind,
        title: n.name,
        at: n.at,
        ...(n.repeat ? { repeat: n.repeat } : {}),
        speak: () => {
          if (n.throws) throw new Error(n.throws);
          return n.say ? { say: n.say } : n.refuse ? { refuse: n.refuse } : null;
        },
      };
      reg.node(def);
    }
  },
};

/** The test's own view: the adapter's side and the reads, from one pack. */
const probe: Pack = {
  id: "probe",
  inject: ["agent.run", "agent.tree", "exchange.read", "exchange.watch"],
  apply() {},
};

function setup(extra: Record<string, Pack> = {}) {
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const modules: Record<string, Pack> = { "agent.ts": agent, "exchange.ts": exchange, "nodes.ts": nodes, "probe.ts": probe, ...extra };
  const loader = new Loader(rt, {
    base: BASE,
    import: async (url) => {
      const m = modules[url.slice(BASE.length)];
      if (!m) throw new Error(`no module ${url}`);
      return { default: m };
    },
  });
  /** The probe's context, intercepted as a run's adapter would be. */
  const as = (run = "r1") => {
    const ctx = loader.fiber("probe")!.ctx.intercept({ actor: { id: "e_agent", kind: "agent" }, run });
    return {
      run: ctx.get<AgentRun>("agent.run"),
      tree: ctx.get<AgentTree>("agent.tree"),
      read: ctx.get<ExchangeRead>("exchange.read"),
      watch: ctx.get<ExchangeWatch>("exchange.watch"),
    };
  };
  return { rt, loader, errors, as };
}

const say = (name: string, at: string[], text: string): NodeSpec => ({ name, kind: "instruction", at, say: text });
const refuse = (name: string, at: string[], text: string): NodeSpec => ({ name, kind: "rule", at, refuse: text });
const moment = (places: string[], input?: string): Moment => ({ run: "r1", places, time: T, ...(input ? { input } : {}) });

function tree(...groups: { id: string; nodes: NodeSpec[] }[]): Entry[] {
  return [
    { id: "exchange", pack: "exchange.ts" },
    { id: "agent", pack: "agent.ts" },
    ...groups.map((g) => ({ id: g.id, pack: "nodes.ts", config: { nodes: g.nodes } })),
    { id: "probe", pack: "probe.ts" },
  ];
}

const start = { run: "r1", agent: { id: "e_agent", kind: "agent" as const }, harness: "test", reaches: ["session_start", "tool:*"] };

test("places match by family; * stays within a path segment, ** doesn't", () => {
  assert.ok(placeMatches("tool:*", "tool:Bash"));
  assert.ok(placeMatches("prompt", "prompt"));
  assert.ok(!placeMatches("tool:*", "tool_result:Bash"));
  assert.ok(placeMatches("file:packs/*/page/*.js", "file:packs/surface/page/a.js"));
  assert.ok(!placeMatches("file:packs/*.js", "file:packs/surface/page/a.js"));
  assert.ok(placeMatches("file:packs/**", "file:packs/surface/page/a.js"));
  assert.ok(refusable("tool:Edit") && refusable("prompt") && !refusable("session_start") && !refusable("tool_result:Edit"));
});

test("reach asks the nodes at the places, in config-tree order, and records each saying", async () => {
  const { loader, errors, as } = setup();
  await loader.apply(
    tree(
      { id: "a", nodes: [say("brief", ["session_start"], "Read the brief."), say("trap", ["file:packs/*/page/*.js"], "Restart after adding a page.")] },
      { id: "b", nodes: [say("hello", ["session_start"], "Hello.")] },
    ),
  );
  const { run, read } = as();
  await run.begin(start);
  const first = await run.reach(moment(["session_start"]));
  assert.deepEqual(first.said, [
    { node: "nodes/brief", text: "Read the brief." },
    { node: "nodes/hello", text: "Hello." },
  ]);
  const edit = await run.reach(moment(["tool:Edit", "file:packs/surface/page/x.js"]));
  assert.deepEqual(edit.said.map((s) => s.node), ["nodes/trap"]);
  await run.act({ run: "r1", place: "tool:Edit", time: T, kind: "tool", by: "agent", input: { file: "x.js" }, ok: true });
  await run.end("r1", T);

  const events = (await read.events("r1")).items;
  assert.deepEqual(
    events.map((e) => [e.seq, e.kind, e.place ?? "-", e.direction]),
    [
      [1, "begin", "-", "from_agent"],
      [2, "say", "session_start", "to_agent"],
      [3, "say", "session_start", "to_agent"],
      [4, "say", "file:packs/surface/page/x.js", "to_agent"],
      [5, "act", "tool:Edit", "from_agent"],
      [6, "end", "-", "from_agent"],
    ],
  );
  const runs = (await read.runs()).items;
  assert.equal(runs[0]!.run, "r1");
  assert.equal(runs[0]!.ended, T);
  assert.deepEqual((await read.said("nodes/trap")).items.map((e) => e.text), ["Restart after adding a page."]);
  assert.deepEqual(errors, []);
});

test("after a compact, a node said again is a re-saying; the first saying and a new node aren't", async () => {
  const { loader, errors, as } = setup();
  await loader.apply(tree({ id: "a", nodes: [say("brief", ["session_start"], "Read the brief."), say("bash", ["tool:Bash"], "Careful.")] }));
  const { run, read } = as();
  await run.begin(start);
  await run.reach(moment(["session_start"]));
  await run.reach(moment(["compact"]));
  await run.reach(moment(["session_start"]));
  await run.reach(moment(["session_start"]));
  await run.reach(moment(["tool:Bash"]));
  const says = (await read.events("r1")).items.filter((e) => e.kind === "say");
  assert.deepEqual(says.map((e) => [e.node, (e.detail as { resaid?: boolean } | undefined)?.resaid ?? false]), [
    ["nodes/brief", false],
    ["nodes/brief", true],
    ["nodes/bash", false],
  ]);
  assert.deepEqual(errors, []);
});

test("a node's same words are said once per context, unless it repeats every time or the moment asks again; refusals always", async () => {
  const { loader, errors, as } = setup();
  await loader.apply(
    tree({
      id: "a",
      nodes: [
        say("once", ["tool:Bash"], "Prefer Read."),
        { ...say("every", ["tool:Bash"], "Careful."), repeat: "every" },
        refuse("no", ["tool:Bash"], "Not that."),
      ],
    }),
  );
  const { run } = as();
  await run.begin(start);
  const first = await run.reach(moment(["tool:Bash"]));
  const second = await run.reach(moment(["tool:Bash"]));
  const asked = await run.reach({ ...moment(["tool:Bash"]), again: true });
  assert.deepEqual(first.said.map((s) => s.node), ["nodes/once", "nodes/every"]);
  assert.deepEqual(second.said.map((s) => s.node), ["nodes/every"]);
  assert.deepEqual(asked.said.map((s) => s.node), ["nodes/once", "nodes/every"]);
  assert.ok(first.refused && second.refused && asked.refused, "a refusal is never held back");
  assert.deepEqual(errors, []);
});

test("a refusal stops a refusable place; elsewhere it is recorded as a miss", async () => {
  const { loader, as } = setup();
  await loader.apply(
    tree({ id: "a", nodes: [refuse("no-bash", ["tool:Bash", "session_start"], "Use the dedicated tool."), say("ok", ["tool:*"], "Careful.")] }),
  );
  const { run, read } = as();
  await run.begin(start);
  const bash = await run.reach(moment(["tool:Bash"]));
  assert.deepEqual(bash.refused, { node: "nodes/no-bash", text: "Use the dedicated tool." });
  assert.deepEqual(bash.said.map((s) => s.text), ["Careful."]);
  const begin = await run.reach(moment(["session_start"]));
  assert.equal(begin.refused, undefined);
  const kinds = (await read.events("r1")).items.map((e) => e.kind);
  assert.deepEqual(kinds, ["begin", "refuse", "say", "miss"]);
});

test("a node that throws is a miss; the others still speak", async () => {
  const { loader, as } = setup();
  const broken: NodeSpec = { name: "broken", kind: "reflex", at: ["prompt"], throws: "boom" };
  await loader.apply(tree({ id: "a", nodes: [broken, say("fine", ["prompt"], "Fine.")] }));
  const { run, read } = as();
  await run.begin(start);
  const answer = await run.reach(moment(["prompt"], "hi"));
  assert.deepEqual(answer.said.map((s) => s.text), ["Fine."]);
  const miss = (await read.events("r1")).items.find((e) => e.kind === "miss")!;
  assert.equal(miss.node, "nodes/broken");
  assert.equal(miss.text, "boom");
});

test("the tree follows the packs: nodes go when their pack unloads and come back with it", async () => {
  const { loader, as } = setup();
  await loader.apply(tree({ id: "a", nodes: [say("x", ["prompt"], "X.")] }, { id: "b", nodes: [say("y", ["prompt"], "Y.")] }));
  const { tree: t } = as();
  let changes = 0;
  t.watch(() => changes++);
  assert.deepEqual(t.nodes().map((n) => [n.id, n.pack]), [["nodes/x", "nodes"], ["nodes/y", "nodes"]]);
  await loader.edit((tr) => (tr[2]!.disabled = true, tr));
  assert.deepEqual(t.nodes().map((n) => n.id), ["nodes/y"]);
  await loader.edit((tr) => (delete tr[2]!.disabled, tr));
  assert.deepEqual(t.nodes().map((n) => n.id), ["nodes/x", "nodes/y"], "back, in tree order");
  assert.ok(changes >= 2);
});

test("a second node of the same name from one pack is refused", async () => {
  const { loader, errors } = setup();
  await loader.apply(tree({ id: "a", nodes: [say("x", ["prompt"], "1"), say("x", ["prompt"], "2")] }));
  assert.equal(loader.status().find((s) => s.id === "a")!.state, "failed");
  assert.match(String((errors[0] as Error).message), /already registered/);
});

test("exchange.watch streams events live, by filter, and stops when disposed", async () => {
  const { loader, as } = setup();
  await loader.apply(tree({ id: "a", nodes: [say("x", ["prompt"], "X.")] }));
  const { run, watch } = as();
  const seen: ExchangeEvent[] = [];
  const stop = watch.watch({ run: "r1", kinds: ["say"] }, (e) => seen.push(e));
  await run.begin(start);
  await run.reach(moment(["prompt"]));
  await stop();
  await run.reach(moment(["prompt"]));
  assert.deepEqual(seen.map((e) => e.text), ["X."]);
});

test("without the exchange the agent waits, and comes back when it returns", async () => {
  const { loader } = setup();
  await loader.apply(tree());
  const state = (id: string) => loader.status().find((s) => s.id === id)!.state;
  assert.equal(state("agent"), "active");
  await loader.edit((tr) => (tr[0]!.disabled = true, tr));
  assert.equal(state("agent"), "waiting");
  await loader.edit((tr) => (delete tr[0]!.disabled, tr));
  assert.equal(state("agent"), "active");
});

test("a run in flight survives the agent pack reloading: taken up with a miss", async () => {
  const { loader, as } = setup();
  await loader.apply(tree({ id: "a", nodes: [say("x", ["prompt"], "X.")] }));
  await as().run.begin(start);
  await loader.edit((tr) => (tr[1]!.config = { reloaded: true }, tr));
  const { run, read } = as();
  const answer = await run.reach(moment(["prompt"]));
  assert.deepEqual(answer.said.map((s) => s.text), ["X."]);
  const kinds = (await read.events("r1")).items.map((e) => e.kind);
  assert.deepEqual(kinds, ["begin", "miss", "say"]);
});

test("the journal keeps the record across a restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "exchange-"));
  const journal = join(dir, "exchange.jsonl");
  try {
    const one = setup();
    const t1 = tree({ id: "a", nodes: [say("x", ["prompt"], "X.")] });
    t1[0]!.config = { journal };
    await one.loader.apply(t1);
    await one.as().run.begin(start);
    await one.as().run.reach(moment(["prompt"]));
    await one.loader.apply([]);

    const two = setup();
    const t2 = tree();
    t2[0]!.config = { journal };
    await two.loader.apply(t2);
    const { read } = two.as();
    assert.deepEqual((await read.events("r1")).items.map((e) => [e.seq, e.kind]), [[1, "begin"], [2, "say"]]);
    assert.equal((await read.runs()).items[0]!.run, "r1");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
