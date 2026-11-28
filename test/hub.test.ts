import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionInvoke } from "../spec/action.ts";
import type { AgentRun } from "../spec/agent.ts";
import { Runtime, type Plugin } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import action from "../plugins/action/index.ts";
import agent from "../plugins/agent/index.ts";
import exchange from "../plugins/exchange/index.ts";
import graph from "../plugins/graph/index.ts";
import types from "../plugins/types/index.ts";
import work from "../plugins/work/index.ts";
import links from "../plugins/links/index.ts";
import items from "../plugins/items/index.ts";
import hub from "../plugins/hub/index.ts";

const probe: Plugin = { id: "probe", inject: ["agent.run", "action.invoke"], apply() {} };

test("a run's hub is every item its task is part of, at any depth", async () => {
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const modules: Record<string, Plugin> = { graph, action, types, work, links, items, exchange, agent, hub, probe };
  const BASE = "mem:/plugins/";
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length)] }) });
  const tree: Entry[] = ["graph", "action", "types", "work", "links", "items", "exchange", "agent", "hub", "probe"].map((id) => ({ id, plugin: id }));
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
  // At compact, the task and what it is part of, nearest first, for the summary to keep.
  const said = await run.reach({ run: "r1", places: ["compact"], time: "2026-11-20T14:00:00.000Z" });
  assert.deepEqual(said.said, [{ node: "hub/task", text: `Keep in the summary this run's task: Write the page (${task}, todo), part of Launch (${mid}), then Business (${top}).` }]);
  assert.deepEqual(errors, []);
  await loader.apply([]);
});
