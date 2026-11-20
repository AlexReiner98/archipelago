import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionInvoke } from "../spec/action.ts";
import type { AgentRun } from "../spec/agent.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import action from "../packs/action/index.ts";
import agent from "../packs/agent/index.ts";
import exchange from "../packs/exchange/index.ts";
import graph from "../packs/graph/index.ts";
import types from "../packs/types/index.ts";
import work from "../packs/work/index.ts";
import links from "../packs/links/index.ts";
import items from "../packs/items/index.ts";
import hub from "../packs/hub/index.ts";

const probe: Pack = { id: "probe", inject: ["agent.run", "action.invoke"], apply() {} };

test("a run's hub is every item its task is part of, at any depth", async () => {
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const modules: Record<string, Pack> = { graph, action, types, work, links, items, exchange, agent, hub, probe };
  const BASE = "mem:/packs/";
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length)] }) });
  const tree: Entry[] = ["graph", "action", "types", "work", "links", "items", "exchange", "agent", "hub", "probe"].map((id) => ({ id, pack: id }));
  await loader.apply(tree);
  await rt.settle();
  const ctx = loader.fiber("probe")!.ctx.intercept({ actor: { id: "e_agent", kind: "agent" }, run: "r1" });
  const invoke = ctx.get<ActionInvoke>("action.invoke");
  const make = async (title: string, part_of?: string) => {
    const out = await invoke.invoke<{ id: string }>({ action: "items.create", input: { type: "work", title, ...(part_of ? { part_of } : {}) }, authority: { of: "human", basis: "test" }, reason: "test" });
    assert.ok(out.ok);
    return out.ok ? out.output.id : "";
  };
  const top = await make("Business");
  const mid = await make("Launch", top);
  const task = await make("Write the page", mid);
  const run = ctx.get<AgentRun>("agent.run");
  const start = { run: "r1", agent: { id: "e_agent", kind: "agent" as const }, harness: "test", reaches: [] };
  assert.equal((await run.begin(start)).facts?.hub, undefined);
  assert.deepEqual((await run.begin({ ...start, task })).facts?.hub, [mid, top]);
  assert.deepEqual(errors, []);
  await loader.apply([]);
});
