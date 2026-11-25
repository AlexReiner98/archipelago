import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionInvoke, ActionRegister } from "../spec/action.ts";
import type { AgentRun } from "../spec/agent.ts";
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
import profile from "../packs/profile/index.ts";
import used from "../packs/used/index.ts";
import { serverOf, tally } from "../packs/used/tally.ts";

const T = "2026-11-22T10:00:00.000Z";

test("tally: per tool and server, runs given and runs used; a server used when one of its tools is; sizes the newest run's", () => {
  const rows = tally([
    { run: "b", given: new Map([["tool:Bash", 100], ["tool:mcp__x__a", 10], ["tool:mcp__x__b", 20], ["mcp:x", 5], ["system", 999]]), used: new Set(["Bash", "mcp__x__a"]) },
    { run: "a", given: new Map([["tool:Bash", 90], ["tool:mcp__x__a", 10], ["tool:Artifact", 37000], ["tool:mcp__y__z", 7]]), used: new Set(["Bash", "WebSearch"]) },
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.name, [r.given, r.used, r.size]]));
  assert.deepEqual(by, {
    "tool:Bash": [2, 2, 100],
    "tool:mcp__x__a": [2, 1, 10],
    "tool:mcp__x__b": [1, 0, 20],
    "mcp:x": [2, 1, 35],
    "tool:Artifact": [1, 0, 37000],
    "tool:mcp__y__z": [1, 0, 7],
    "mcp:y": [1, 0, 7],
    "tool:WebSearch": [1, 1, 0],
  });
  assert.equal(serverOf("mcp__claude-in-chrome__navigate"), "claude-in-chrome");
  assert.equal(serverOf("Bash"), undefined);
});

/** Stands in for the transcript pack: what each run was given. */
const GIVEN: Record<string, { name: string; size: number }[]> = {
  r1: [{ name: "system", size: 5000 }, { name: "tool:Bash", size: 900 }, { name: "tool:Artifact", size: 37000 }, { name: "tool:mcp__x__a", size: 300 }, { name: "mcp:x", size: 100 }],
  r2: [{ name: "tool:Bash", size: 900 }, { name: "tool:Artifact", size: 36000 }, { name: "tool:mcp__x__a", size: 300 }],
  r3: [{ name: "tool:Bash", size: 900 }],
};
const fakeTranscript: Pack = {
  id: "transcript",
  inject: ["action.register"],
  apply(ctx) {
    ctx.get<ActionRegister>("action.register").register({
      name: "transcript.given",
      title: "fake",
      input: { type: "object" },
      async run(input: { run: string }) {
        const nodes = GIVEN[input.run];
        return nodes ? { nodes: nodes.map((n) => ({ ...n, title: n.name, by: "Claude Code", at: "x", count: 1 })) } : { nodes: [], none: true };
      },
    });
  },
};

const probe: Pack = { id: "probe", inject: ["agent.run", "action.invoke"], apply() {} };

test("used.tools: across the runs with a transcript, given and used from the tool acts; by name, by profile; writes nothing", async () => {
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const modules: Record<string, Pack> = { graph, action, types, record, links, items, exchange, agent, profile, transcript: fakeTranscript, used, probe } as Record<string, Pack>;
  const BASE = "mem:/packs/";
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length)] }) });
  const tree: Entry[] = Object.keys(modules).map((id) => ({ id, pack: id }));
  await loader.apply(tree);
  await rt.settle();
  const ctx = (run: string) => loader.fiber("probe")!.ctx.intercept({ actor: { id: "e_agent", kind: "agent" }, run });
  const invoke = (a: string, input: object) => ctx("r0").get<ActionInvoke>("action.invoke").invoke({ action: a, input: input as never, authority: { of: "human", basis: "test" }, reason: "test" });
  try {
    const prof = await invoke("items.create", { type: "context_filter", title: "Lean" });
    assert.ok(prof.ok);
    const pid = (prof.output as { id: string }).id;
    for (const r of ["r1", "r2", "r3", "r4"]) {
      const run = ctx(r).get<AgentRun>("agent.run");
      const facts: Record<string, string> = r === "r4" ? {} : { transcript: `/t/${r}.jsonl`, ...(r !== "r3" ? { profiles: pid } : {}) };
      await run.begin({ run: r, agent: { id: "e_agent", kind: "agent" }, harness: "test", reaches: [], facts });
    }
    await ctx("r1").get<AgentRun>("agent.run").act({ run: "r1", place: "tool:Bash", time: T, kind: "tool", by: "agent", ok: true });
    await ctx("r1").get<AgentRun>("agent.run").act({ run: "r1", place: "tool:mcp__x__a", time: T, kind: "tool", by: "agent", ok: true });
    await ctx("r2").get<AgentRun>("agent.run").act({ run: "r2", place: "tool:Bash", time: T, kind: "tool", by: "agent", ok: true });

    const out = await invoke("used.tools", {});
    assert.ok(out.ok, JSON.stringify(out));
    assert.equal(out.change, undefined, "a read writes nothing");
    const o = out.output as { runs: number; tools: { name: string; given: number; used: number; size: number }[] };
    assert.equal(o.runs, 3, "a run without a transcript isn't counted");
    const by = Object.fromEntries(o.tools.map((t) => [t.name, [t.given, t.used, t.size]]));
    assert.deepEqual(by["tool:Bash"], [3, 2, 900]);
    assert.deepEqual(by["tool:Artifact"], [2, 0, 36000], "the newest run's size");
    assert.deepEqual(by["mcp:x"], [2, 1, 300]);
    assert.equal(by["system"], undefined, "only tools and servers");

    const named = await invoke("used.tools", { names: ["tool:Artifact"] });
    assert.ok(named.ok);
    assert.deepEqual((named.output as { tools: { name: string }[] }).tools.map((t) => t.name), ["tool:Artifact"]);
    const page = await invoke("used.tools", { limit: 2 });
    assert.ok(page.ok && (page.output as { next?: string }).next);

    const inProfile = await invoke("used.tools", { profile: pid, names: ["tool:Bash"] });
    assert.ok(inProfile.ok);
    assert.equal((inProfile.output as { runs: number }).runs, 2);
    assert.deepEqual((inProfile.output as { tools: { given: number }[] }).tools[0]!.given, 2);

    const tooMany = await invoke("used.tools", { names: Array.from({ length: 1000 }, (_, i) => `tool:t${i}`) });
    assert.ok(!tooMany.ok && tooMany.refused.code === "used.names");
    assert.deepEqual(errors, []);
  } finally {
    await loader.apply([]);
  }
});

test("on a given node: its use and its server's, what a profile would leave out; the key marks a tool never used", async () => {
  const { givenNodes } = await import("../packs/harness/given.ts");
  const { letters, outOf, useLine, useNames } = await import("../packs/harness/use.ts");
  const { marksIn } = await import("../packs/harness/key.ts");
  assert.deepEqual(useNames(["system", "tool:Bash", "tool:mcp__x__a", "mcp:y"]), ["tool:Bash", "tool:mcp__x__a", "mcp:x", "mcp:y"]);
  assert.deepEqual([letters(950), letters(36_400), letters(1_250_000)], ["950", "36k", "1.3M"]);
  const use = new Map([
    ["tool:Artifact", { given: 40, used: 0, size: 36_400, runs: 40 }],
    ["tool:mcp__x__a", { given: 40, used: 3, size: 300, runs: 40 }],
    ["mcp:x", { given: 40, used: 3, size: 900, runs: 40 }],
  ]);
  const plans = [{ profile: "p1", title: "Focus", state: "shadow", runs: 40, enough: true, leave: [{ name: "tool:Artifact", given: 40, size: 36_400 }], letters: 36_400, set: [] }];
  const rows = [
    { name: "tool:Artifact", title: "Artifact", by: "Claude Code", at: "tool:Artifact", count: 1, size: 36_400 },
    { name: "tool:mcp__x__a", title: "a", by: "x", at: "tool:mcp__x__a", count: 1, size: 300 },
  ];
  const [art, a] = givenNodes("r1", rows, { use, plans, writing: false });
  assert.equal(useLine(art!.use!), "used in 0 of 40 runs · 36k letters");
  assert.deepEqual(art!.out, { profile: "p1", title: "Focus", state: "shadow", set: false, applied: false, count: 1, letters: 36_400 });
  assert.equal(a!.server!.name, "x");
  assert.equal(a!.out, undefined);
  assert.equal(outOf({ use, plans: [{ ...plans[0]!, state: "on", set: ["tool:Artifact"] }], writing: true }, "tool:Artifact")!.applied, true, "written: on, set, and the server writes");
  assert.deepEqual(givenNodes("r1", rows).map((n) => n.use), [undefined, undefined], "without the packs, nothing");
  const marks = marksIn({ nodes: [art!, a!], heard: new Map(), held: new Map(), trial: () => false });
  assert.ok(marks.has("unused") && marks.has("shadow"));
  assert.ok(!marksIn({ nodes: [a!], heard: new Map(), held: new Map(), trial: () => false }).has("unused"), "in the key only when present");
});
