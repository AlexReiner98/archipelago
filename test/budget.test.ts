import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionInvoke, ActionRegister } from "../spec/action.ts";
import type { AgentRun, Moment } from "../spec/agent.ts";
import type { Json } from "../spec/common.ts";
import type { ProfileInfo, ProfileRead } from "../spec/profile.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import action from "../packs/action/index.ts";
import agent from "../packs/agent/index.ts";
import exchange from "../packs/exchange/index.ts";
import graph from "../packs/graph/index.ts";
import types from "../packs/types/index.ts";
import work from "../packs/work/index.ts";
import items from "../packs/items/index.ts";
import type { TypesDefine } from "../spec/types.ts";
import { PROFILE } from "../packs/profile/index.ts";
import budget, { ASKER, askText, RATIO, spentOf, SPEND, type Spend } from "../packs/budget/index.ts";

const T = "2026-11-24T10:00:00.000Z";

/** Each run's usage rows, as `transcript.tokens` pages them: two a page, to walk the cursor. */
const usage = new Map<string, { n: number; input: number; cacheRead: number; cacheWrite: number; output: number }[]>();
const tokens: Pack = {
  id: "transcript",
  inject: ["action.register"],
  apply(ctx) {
    ctx.get<ActionRegister>("action.register").register({
      name: "transcript.tokens",
      title: "t",
      input: { type: "object" },
      async run(input: { run: string; after?: number }) {
        const rows = usage.get(input.run);
        if (!rows) return { rows: [], compactions: 0, none: true };
        const from = rows.filter((r) => input.after === undefined || r.n > input.after);
        const page = from.slice(0, 2);
        return { rows: page as unknown as Json, compactions: 0, ...(from.length > 2 ? { next: page[page.length - 1]!.n } : {}) };
      },
    });
  },
};

/** The context filters each run is in: by id, the test sets them. */
const filters = new Map<string, ProfileInfo[]>();
const profile: Pack = {
  id: "profile",
  inject: ["types.define"],
  apply(ctx) {
    // The profile pack's own context filter base: budget_ratio is one of its fields.
    ctx.get<TypesDefine>("types.define").base(PROFILE);
    ctx.provide<ProfileRead>("profile.read", () => ({
      of: async (run) => filters.get(run.run) ?? [],
      hears: async () => ({ hears: true }) as never,
      nodes: async () => ({ in: [], out: [] }),
      watch: () => () => {},
    }));
  },
};
const probe: Pack = { id: "probe", inject: ["agent.run", "action.invoke"], apply() {} };

const row = (n: number, input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({ n, input, cacheRead, cacheWrite, output });

test("spend counts what an estimate counts: input, cache writes, output; not cached re-reads", () => {
  assert.equal(spentOf([row(1, 100, 50, 9000, 20), row(2, 10, 5)]), 185);
  assert.match(askText({ spent: 320_000, estimate: 200_000, ratio: 1.5, task: "i_x" }), /spent 320k tokens, 1\.6× its task's estimate of 200k \(i_x\), past the 1\.5×/);
});

test("a run past its estimate is asked once at reply_end; the ratio comes from its context filter, else config, else 1.5", async () => {
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const modules: Record<string, Pack> = { graph, action, types, work, items, exchange, agent, transcript: tokens, profile, budget, probe };
  const BASE = "mem:/packs/";
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length)] }) });
  const tree: Entry[] = ["graph", "action", "types", "work", "items", "exchange", "agent", "transcript", "profile", "budget", "probe"].map((id) => ({ id, pack: id }));
  await loader.apply(tree);
  await rt.settle();
  const ctx = loader.fiber("probe")!.ctx.intercept({ actor: { id: "e_agent", kind: "agent" }, run: "r1" });
  const invoke = ctx.get<ActionInvoke>("action.invoke");
  const run = ctx.get<AgentRun>("agent.run");
  const create = async (title: string, fields: Record<string, Json> = {}, type = "work") => {
    const out = await invoke.invoke<{ id: string }>({ action: "items.create", input: { type, title, fields }, authority: { of: "human", basis: "test" }, reason: "test" });
    assert.ok(out.ok, JSON.stringify(out));
    return out.ok ? out.output.id : "";
  };
  const task = await create("Write the page", { tokens_estimated: 1000 });
  const bare = await create("No estimate");
  const start = (r: string, t?: string) => run.begin({ run: r, agent: { id: "e_agent", kind: "agent" }, harness: "test", reaches: ["reply_end"], ...(t ? { task: t } : {}) });
  const stop = (r: string): Moment => ({ run: r, places: ["reply_end"], time: T });

  // Under the ratio: quiet, though past the estimate itself.
  await start("r1", task);
  usage.set("r1", [row(1, 400, 100, 50_000), row(2, 300, 200, 0, 300)]); // 1300
  assert.equal((await run.reach(stop("r1"))).refused, undefined);

  // Past 1.5×, over three pages of usage: asked, with the ask code, so it keeps going.
  usage.get("r1")!.push(row(3, 200, 100), row(4, 100, 0), row(5, 0, 1)); // 1701
  const asked = await run.reach(stop("r1"));
  assert.equal(asked.refused?.node, ASKER);
  assert.equal(asked.refused?.code, "ask");
  assert.match(asked.refused!.text, /spent 1\.7k tokens, 1\.7× its task's estimate of 1k/);

  // Once per run: the next stop goes through, however far over.
  usage.get("r1")!.push(row(6, 5000, 0));
  assert.equal((await run.reach(stop("r1"))).refused, undefined);

  // No estimate, or no task: never asked.
  await start("r2", bare);
  usage.set("r2", [row(1, 99_999, 0)]);
  assert.equal((await run.reach(stop("r2"))).refused, undefined);
  await start("r3");
  usage.set("r3", [row(1, 99_999, 0)]);
  assert.equal((await run.reach(stop("r3"))).refused, undefined);

  // A context filter's budget_ratio: a run in it is asked sooner.
  const tight = await create("Tight", { budget_ratio: 1.1 }, "context_filter");
  await start("r4", task);
  usage.set("r4", [row(1, 1200, 0)]);
  assert.equal((await run.reach(stop("r4"))).refused, undefined, "1.2× is under the default 1.5×");
  filters.set("r4", [{ id: tight, title: "Tight", by: "match", holding: true }]);
  usage.get("r4")!.push(row(2, 0, 1));
  assert.equal((await run.reach(stop("r4"))).refused?.node, ASKER, "past the context filter's 1.1×");

  // The harness reads each run's spend against its estimate.
  const out = await invoke.invoke({ action: SPEND, input: { runs: ["r1", "r2", "r3", "nope"] }, authority: { of: "human", basis: "test" }, reason: "test" });
  assert.ok(out.ok);
  const by = new Map(out.ok ? (out.output as unknown as { runs: Spend[] }).runs.map((s) => [s.run, s]) : []);
  assert.deepEqual({ ...by.get("r1") }, { run: "r1", spent: 6701, task, estimate: 1000, ratio: RATIO, over: true, asked: true });
  assert.deepEqual({ ...by.get("r2") }, { run: "r2", spent: 99_999, task: bare, ratio: RATIO, over: false, asked: false });
  assert.equal(by.has("nope"), false);
  const many = await invoke.invoke({ action: SPEND, input: { runs: Array.from({ length: 51 }, (_, i) => `x${i}`) }, authority: { of: "human", basis: "test" }, reason: "test" });
  assert.equal(many.ok, false, "a bounded read");

  assert.deepEqual(errors, []);
  await loader.apply([]);
});

test("the config sets the ratio when no context filter does", async () => {
  const rt = new Runtime();
  const modules: Record<string, Pack> = { graph, action, types, work, items, exchange, agent, transcript: tokens, profile, budget, probe };
  const BASE = "mem:/packs/";
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length)] }) });
  await loader.apply(["graph", "action", "types", "work", "items", "exchange", "agent", "transcript", "profile", "probe"].map((id) => ({ id, pack: id })).concat([{ id: "budget", pack: "budget", config: { ratio: 3 } } as never]));
  await rt.settle();
  const ctx = loader.fiber("probe")!.ctx.intercept({ actor: { id: "e_agent", kind: "agent" }, run: "c1" });
  const invoke = ctx.get<ActionInvoke>("action.invoke");
  const run = ctx.get<AgentRun>("agent.run");
  const made = await invoke.invoke<{ id: string }>({ action: "items.create", input: { type: "work", title: "t", fields: { tokens_estimated: 100 } }, authority: { of: "human", basis: "test" }, reason: "test" });
  assert.ok(made.ok);
  await run.begin({ run: "c1", agent: { id: "e_agent", kind: "agent" }, harness: "test", reaches: ["reply_end"], task: made.ok ? made.output.id : "" });
  usage.set("c1", [row(1, 250, 0)]);
  assert.equal((await run.reach({ run: "c1", places: ["reply_end"], time: T })).refused, undefined, "2.5× is under the config's 3×");
  usage.get("c1")!.push(row(2, 100, 0));
  assert.equal((await run.reach({ run: "c1", places: ["reply_end"], time: T })).refused?.node, ASKER);
  await loader.apply([]);
});
