import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ActionInvoke } from "../spec/action.ts";
import type { AgentRun } from "../spec/agent.ts";
import type { Dispose, Json } from "../spec/common.ts";
import type { GraphRead } from "../spec/graph.ts";
import { Runtime, type Context, type Plugin } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import action from "../plugins/action/index.ts";
import actor from "../plugins/actor/index.ts";
import agent from "../plugins/agent/index.ts";
import archive from "../plugins/archive/index.ts";
import branch from "../plugins/branch/index.ts";
import exchange from "../plugins/exchange/index.ts";
import graph from "../plugins/graph/index.ts";
import { Store } from "../plugins/graph/store.ts";
import history from "../plugins/history/index.ts";
import interchange from "../plugins/interchange/index.ts";
import links from "../plugins/links/index.ts";
import mcp from "../plugins/mcp/index.ts";
import type { McpHost, ToolDef } from "../plugins/mcp/host.ts";
import question from "../plugins/question/index.ts";
import record from "../plugins/record/index.ts";
import schema from "../plugins/schema/index.ts";
import types from "../plugins/types/index.ts";
import work from "../plugins/work/index.ts";
import { archiveHeader, landArchive, landFocus, placeOf, type Dump } from "../scripts/pelago-map.ts";

const BASE = "mem:/plugins/";

/** A small old map: what the old server's flat read gives. */
const dump: Dump = {
  items: [
    { id: "e_isl", type: "island", title: "An island", status: "current", fields: { plugin: "core" } },
    { id: "e_feat", type: "build.feature", title: "A feature", status: "built", island: "e_isl", fields: { island: "e_isl", focus: true } },
    { id: "e_task", type: "task", title: "A task", status: "waiting", island: "e_feat", body: "Waits on a reply.", fields: { island: "e_feat", priority: "high", cell: [1, 2] } },
    { id: "e_lane", type: "build.lane", title: "A lane", status: "merged", island: "e_feat", fields: { island: "e_feat", branch: "claude/x", files: ["a/**"], checks: "pass", head: "abc" } },
    { id: "e_q", type: "question", title: "A question", status: "settled", island: "e_isl", fields: { island: "e_isl", outcome: "Yes", options: ["Yes", "No"] } },
    { id: "e_v", type: "ui.verdict", title: "A verdict", status: "kept", fields: { keep: "the colours", outcome: "kept" } },
    { id: "e_me", type: "person", title: "Owner", status: "active", fields: { email: "someone@example.com" } },
    { id: "e_run", type: "run", title: "A run", status: "finished", fields: {} },
    { id: "e_src", type: "source", title: "A source", status: "recorded", fields: { uri: "file:notes.md", kind: "file" } },
    { id: "e_ins", type: "instruction", title: "Say this", status: "current", body: "Do it this way.", fields: { for: ["session_start"], order: 3 } },
    { id: "e_rfx", type: "reflex", title: "Mind this", status: "trial", body: "When changing, mind this.", fields: { for: ["tool:change"], misses: ["a miss"] } },
    { id: "e_cl", type: "instruction", title: "A rule of a file", status: "current", body: "A line of CLAUDE.md.", fields: { for: ["written:CLAUDE.md"] } },
  ],
  links: [
    { id: "r_1", type: "build.in_lane", from: "e_task", to: "e_lane" },
    { id: "r_2", type: "bears_on", from: "e_task", to: "e_q" },
    { id: "r_3", type: "ui.judges", from: "e_v", to: "e_feat" },
    { id: "r_4", type: "owned_by", from: "e_q", to: "e_me" },
    { id: "r_5", type: "works_on", from: "e_run", to: "e_task" },
    { id: "r_6", type: "bears_on", from: "e_v", to: "e_task" },
  ],
  by_owner: ["e_q", "e_v"],
  gets: { e_task: { source_id: "e_src", confidence: 0.8 } },
};

test("old types land on the bases, with kind; links on the five; islands are part_of", () => {
  const { groups, counts, moved } = landFocus(dump);
  const facts = groups.flatMap((g) => g.facts);
  const of = (id: string) => Object.fromEntries(facts.filter((f) => f[1] === id).map((f) => [f[2], f[3]]));
  assert.deepEqual([of("e_task").type, of("e_task").status, of("e_task").priority], ["work", "doing", "high"]);
  assert.equal(of("e_task").cell, undefined, "UI state is left");
  assert.match(String(of("e_task").note), /^Waits on a reply\.\n\n## From the old map\n.*confidence: 0\.8/s);
  assert.deepEqual([of("e_lane").type, of("e_lane").kind, of("e_lane").status, of("e_lane").branch], ["branch", "lane", "done", "claude/x"]);
  assert.deepEqual([of("e_feat").kind, of("e_feat").status, of("e_feat").seen_working], ["feature", "done", false]);
  assert.deepEqual([of("e_q").status, of("e_v").type, of("e_v").kind, of("e_v").status], ["decided", "question", "verdict", "decided"]);
  assert.equal(of("e_me").email, undefined, "email is private");
  assert.ok(!moved.has("e_run"), "runs are the exchange's");
  // Nodes for the words plugin, said where they were.
  assert.deepEqual([of("e_ins").type, of("e_ins").at, of("e_ins").words, of("e_ins").order], ["node", ["session_start"], "Do it this way.", 3]);
  assert.deepEqual([of("e_rfx").at, of("e_rfx").status, of("e_rfx").misses], [["tool:mcp__pelago__change"], "trial", ["a miss"]]);
  assert.deepEqual(of("e_cl").at, [], "a line the old map writes into a file is not said");
  assert.equal(placeOf("file:a.ts"), "file:a.ts");
  // Links.
  const link = (type: string, from: string, to: string) =>
    facts.some((f) => f[2] === "type" && f[3] === type && facts.some((g) => g[1] === f[1] && g[2] === "from" && g[3] === from) && facts.some((g) => g[1] === f[1] && g[2] === "to" && g[3] === to));
  assert.ok(link("part_of", "e_task", "e_lane"), "in_lane is part_of");
  assert.ok(link("about", "e_v", "e_feat"), "judges is about");
  assert.ok(link("about", "e_v", "e_task"), "bears_on to a non-question is about");
  assert.ok(link("waits_on", "e_task", "e_me"), "waiting is a waits_on");
  assert.ok(link("about", "e_src", "e_task"), "a cited source is a record about what cites it");
  assert.ok(link("part_of", "e_feat", "e_isl") && link("part_of", "e_q", "e_isl"), "what is on an island is part of it");
  assert.ok(!link("part_of", "e_task", "e_feat"), "not twice: its lane is on the same island");
  assert.ok(!facts.some((f) => f[1] === "r_4" || f[1] === "r_5"), "owned_by and works_on stay behind");
  assert.equal(counts.left_items.run, 1);
  // Authority: by whose say each item's status was last set; links after items.
  assert.equal(groups[0]!.authority.of, "human");
  assert.ok(groups[0]!.facts.some((f) => f[1] === "e_q") && !groups[0]!.facts.some((f) => f[1] === "e_task"));
  assert.match(groups.at(-1)!.reason, /links/);
});

async function runtime(dir: string, extra: { served?: Map<string, ToolDef> } = {}) {
  const served = extra.served ?? new Map<string, ToolDef>();
  const host: Plugin = {
    id: "host",
    inject: ["agent.run", "action.invoke", "graph.read"],
    apply(ctx: Context) {
      ctx.provide<McpHost>("mcp.host", (_c, from) => ({
        harness: "test",
        place: (t) => `tool:mcp__archipelago__${t}`,
        add(def): Dispose {
          return from.effect(() => {
            served.set(def.name, def);
            return () => served.delete(def.name);
          });
        },
      }));
    },
  };
  const modules: Record<string, Plugin> = { graph, action, types, work, question, record, actor, links, branch, schema, history, interchange, exchange, agent, host, mcp, archive };
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length, -3)] }) });
  const config: Record<string, Json> = {
    graph: { db: join(dir, "graph.sqlite") },
    history: { db: join(dir, "history.sqlite") },
    schema: { db: join(dir, "schema.sqlite") },
    archive: { dir: join(dir, "archives") },
  };
  const tree: Entry[] = Object.keys(modules).map((id) => ({ id, plugin: `${id}.ts`, ...(config[id] ? { config: config[id] } : {}) }));
  await loader.apply(tree);
  await rt.settle();
  const ctx = () => loader.fiber("host")!.ctx.intercept({ actor: { id: "agent:test", kind: "agent" }, run: "run-1" });
  const invoke = ctx().get<ActionInvoke>("action.invoke");
  const run = { run: "run-1", actor: { id: "agent:test", kind: "agent" as const }, agent: ctx().get<AgentRun>("agent.run"), invoke };
  await run.agent.begin({ run: "run-1", agent: run.actor, harness: "test", reaches: [] });
  const call = async (name: string, args: object) => {
    const out = await served.get(name)!.call(args as never, run);
    return { ...out, json: out.isError ? undefined : JSON.parse(out.text) };
  };
  return { invoke, call, read: ctx().get<GraphRead>("graph.read"), errors, stop: () => loader.apply([]) };
}

test("the landed sets go in through interchange.import, pass the schema, and undo takes one back", async () => {
  const dir = await mkdtemp(join(tmpdir(), "move-"));
  const s = await runtime(dir);
  try {
    const changes: string[] = [];
    const groups = landFocus(dump, 3).groups;
    for (const g of groups) {
      const out = await s.invoke.invoke({ action: "interchange.import", input: { facts: g.facts } as unknown as Json, authority: g.authority, reason: g.reason });
      if (!out.ok) assert.fail(`${out.refused.code}: ${out.refused.message} ${JSON.stringify(out.refused.detail)}`);
      changes.push(out.change!);
    }
    const [task, lane] = await s.read.get(["e_task", "e_lane"]);
    assert.equal(task?.type, "work");
    assert.equal(lane?.type, "branch");
    // The last set holds links: undone, they go and the items stay.
    const undo = await s.invoke.invoke({ action: "history.undo", input: { change: changes.at(-1)! }, authority: { of: "agent", basis: "test" }, reason: "undo" });
    assert.ok(undo.ok);
    const gone = [...new Set(groups.at(-1)!.facts.map((f) => f[1]))];
    assert.deepEqual(await s.read.get(gone), gone.map(() => null));
    assert.ok((await s.read.get(["e_task"]))[0]);
    const bad = await s.invoke.invoke({ action: "interchange.import", input: { facts: [["*", "x", "type", "work"]] } as unknown as Json, authority: { of: "agent", basis: "test" }, reason: "bad" });
    assert.equal(!bad.ok && bad.refused.code, "interchange.facts");
    assert.deepEqual(s.errors, []);
  } finally {
    await s.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("an archive is read only, and get and query read it by name", async () => {
  const dir = await mkdtemp(join(tmpdir(), "archive-"));
  await mkdir(join(dir, "archives"));
  const file = join(dir, "archives", "old.sqlite");
  const store = new Store(file);
  const { facts } = landArchive(dump);
  store.apply({ header: archiveHeader("test"), facts });
  store.close();
  const ro = new Store(file, 0, { readOnly: true });
  assert.throws(() => ro.apply({ header: archiveHeader("test"), facts: [["+", "x", "type", "work"]] }), /read-only/);
  ro.close();

  const s = await runtime(dir);
  try {
    const q = await s.call("query", { find: "type:work", map: "old" });
    assert.equal(q.json.map, "old");
    assert.deepEqual(q.json.items.map((i: { id: string }) => i.id).sort(), ["e_feat", "e_lane", "e_task"], "a flavour counts as its base");
    const lanes = await s.call("query", { find: "type:branch is:closed", map: "old" });
    assert.deepEqual(lanes.json.items.map((i: { id: string }) => i.id), ["e_lane"]);
    const g = await s.call("get", { ids: ["e_run", "e_task"], map: "old" });
    assert.equal(g.json.items[0].type, "run", "an archive keeps what the living map leaves behind");
    assert.equal(g.json.items[1].cell.length, 2, "and every field");
    assert.ok(g.json.items[1].links.some((l: { type: string; was_type?: string }) => l.type === "part_of" && l.was_type === "build.in_lane"));
    const living = await s.call("query", { find: "type:work" });
    assert.equal(living.json.items.length, 0, "without map, the living map");
    const none = await s.call("get", { ids: ["e_task"], map: "nope" });
    assert.ok(none.isError && /The others are: old/.test(none.text));
    assert.deepEqual(s.errors, []);
  } finally {
    await s.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
