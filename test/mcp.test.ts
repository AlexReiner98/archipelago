import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ActionInvoke } from "../spec/action.ts";
import type { AgentNode, AgentRun, AgentTree } from "../spec/agent.ts";
import type { Dispose } from "../spec/common.ts";
import type { ExchangeRead } from "../spec/exchange.ts";
import type { GraphRead } from "../spec/graph.ts";
import { Runtime, type Context, type Plugin } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import action from "../plugins/action/index.ts";
import actor from "../plugins/actor/index.ts";
import agent from "../plugins/agent/index.ts";
import exchange from "../plugins/exchange/index.ts";
import graph from "../plugins/graph/index.ts";
import history from "../plugins/history/index.ts";
import items from "../plugins/items/index.ts";
import links from "../plugins/links/index.ts";
import mcp, { DESCRIPTIONS } from "../plugins/mcp/index.ts";
import type { McpHost, ToolDef } from "../plugins/mcp/host.ts";
import question from "../plugins/question/index.ts";
import record from "../plugins/record/index.ts";
import schema from "../plugins/schema/index.ts";
import types from "../plugins/types/index.ts";
import words from "../plugins/words/index.ts";
import interchange from "../plugins/interchange/index.ts";
import work from "../plugins/work/index.ts";
import { fixIn } from "../plugins/action/input.ts";

const BASE = "mem:/plugins/";
const RUN = "run-1";
const AGENT = { id: "claude-code", kind: "agent" as const };

/** A host as an adapter would be: it serves what is added, and gives each call the run. */
function hostPlugin(served: Map<string, ToolDef>): Plugin {
  return {
    id: "host",
    inject: ["agent.run", "action.invoke"],
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
}

const probe: Plugin = { id: "probe", inject: ["graph.read", "exchange.read", "agent.tree", "agent.node", "action.invoke"], apply() {} };

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "mcp-"));
  const served = new Map<string, ToolDef>();
  const modules: Record<string, Plugin> = {
    graph, action, types, work, question, record, actor, links, items, schema, history, exchange, agent, words, host: hostPlugin(served), mcp, probe, interchange,
  };
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length, -3)] }) });
  const tree: Entry[] = ["graph", "action", "types", "work", "question", "record", "actor", "links", "items", "schema", "history", "exchange", "agent", "words", "host", "mcp", "probe", "interchange"].map(
    (id) => ({ id, plugin: `${id}.ts`, ...(id === "history" ? { config: { db: join(dir, "history.sqlite") } } : {}) }),
  );
  await loader.apply(tree);
  await rt.settle();
  const runCtx = () => loader.fiber("host")!.ctx.intercept({ actor: AGENT, run: RUN });
  const toolRun = () => ({ run: RUN, actor: AGENT, agent: runCtx().get<AgentRun>("agent.run"), invoke: runCtx().get<ActionInvoke>("action.invoke") });
  await toolRun().agent.begin({ run: RUN, agent: AGENT, harness: "test", reaches: [] });
  const call = async (name: string, args: object) => {
    const out = await served.get(name)!.call(args as never, toolRun());
    let json: any;
    try {
      json = out.isError ? undefined : JSON.parse(out.text);
    } catch {}
    return { ...out, json };
  };
  const p = loader.fiber("probe")!.ctx;
  return {
    loader,
    errors,
    served,
    call,
    graph: () => p.get<GraphRead>("graph.read"),
    exchange: () => p.get<ExchangeRead>("exchange.read"),
    tree: () => p.get<AgentTree>("agent.tree"),
    node: () => p.get<AgentNode>("agent.node"),
    agent: () => toolRun().agent,
    invoke: () => p.intercept({ actor: { id: "person:owner", kind: "person" } }).get<ActionInvoke>("action.invoke"),
    async close() {
      await loader.apply([]);
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("six tools, each described by a node at its place that the words plugin says and words.set refines", async () => {
  const s = await setup();
  try {
    assert.deepEqual([...s.served.keys()], ["hear", "act", "get", "query", "tell", "run"]);
    const described = s.tree().nodes().filter((n) => n.kind === "tool_text");
    assert.deepEqual(described.map((n) => n.at[0]).sort(), Object.keys(DESCRIPTIONS).map((t) => `tool:mcp__archipelago__${t}`).sort());
    assert.equal(await s.served.get("get")!.description(), DESCRIPTIONS.get);
    assert.match(await s.served.get("act")!.description(), /Declared now: .*items\.create.*history\.undo/);
    for (const d of Object.values(DESCRIPTIONS)) assert.ok(d.length <= 240, `short: ${d}`);

    const getNode = described.find((n) => n.at[0] === "tool:mcp__archipelago__get")!;
    const set = await s.invoke().invoke({ action: "words.set", input: { node: getNode.source!, words: "Items by id." }, authority: { of: "human", basis: "test" }, reason: "shorter" });
    assert.ok(set.ok);
    assert.equal(await s.served.get("get")!.description(), "Items by id.");

    // Said where the agent is about to call it, so the verdicts judge it.
    const heard = await s.call("hear", { place: "tool:mcp__archipelago__get" });
    assert.equal(heard.text, "Items by id.");

    // Loaded again, it finds its nodes rather than making more.
    const tree = s.loader.status().map((e) => ({ id: e.id, plugin: `${e.id}.ts` }));
    await s.loader.apply(tree.filter((e) => e.id !== "mcp"));
    assert.equal(s.served.size, 0, "its tools go when it unloads");
    await s.loader.apply(tree);
    assert.equal(s.served.size, 6);
    assert.equal(s.tree().nodes().filter((n) => n.kind === "tool_text").length, 6, "no second set of nodes");
    assert.equal(await s.served.get("get")!.description(), "Items by id.");
    assert.deepEqual(s.errors, []);
  } finally {
    await s.close();
  }
});

test("act writes through declared actions, shows what one takes, and undo takes a change back", async () => {
  const s = await setup();
  try {
    const shown = await s.call("act", { action: "items.create" });
    assert.deepEqual(shown.json.input.required, ["type", "title"]);
    const made = await s.call("act", { action: "items.create", input: { type: "work", title: "Serve the map" }, reason: "test" });
    const id = made.json.output.id;
    const [item] = await s.graph().get([id]);
    assert.equal(item!.fields.status, "todo");
    const refused = await s.call("act", { action: "items.set", input: { id, fields: { status: "built" } } });
    assert.equal(refused.isError, true);
    assert.match(refused.text, /todo, doing, done, dropped/);
    const flat = await s.call("act", { action: "items.set", input: { id, status: "doing" } });
    assert.match(flat.text, /\/fields wants an object: it is required\. It takes: \{"id":.*"fields":/, "a misshapen input is told the shape");
    const fix = fixIn(flat.text)!;
    assert.deepEqual(fix.fix, [{ path: "/fields", expected: "an object: it is required", example: {} }], "and how to fix it, on its own line");
    assert.deepEqual(fix.input, { id, status: "doing", fields: {} });
    const undone = await s.call("act", { action: "history.undo", input: { change: made.json.change }, reason: "test" });
    assert.ok(!undone.isError, undone.text);
    assert.deepEqual(await s.graph().get([id]), [null]);
    assert.match((await s.call("act", { action: "nope.nothing" })).text, /No action nope\.nothing/);
  } finally {
    await s.close();
  }
});

test("each kind of refusal is a node, said at the tool's result when the result holds it, and reworded like any other", async () => {
  const s = await setup();
  try {
    const made = await s.call("act", { action: "items.create", input: { type: "work", title: "A task" }, reason: "test" });
    const id = made.json.output.id;
    const wrong = await s.call("act", { action: "items.set", input: { id, fields: { status: "built" } } });
    const flat = await s.call("act", { action: "items.set", input: { id, status: "doing" } });
    await s.call("act", { action: "items.set", input: { id, status: "done" } });
    const codeOf = (text: string) => /^Refused \((.+?)\)/.exec(text)![1]!;
    const codes = [codeOf(wrong.text), codeOf(flat.text)];
    assert.equal(codes[1], "action.input");
    await new Promise((r) => setTimeout(r, 20));
    const nodes = s.tree().nodes().filter((n) => n.title.startsWith("Refused: "));
    assert.deepEqual(nodes.map((n) => n.title).sort(), [...new Set(codes)].map((c) => `Refused: ${c}`).sort(), "one node per code, the same code twice makes none");
    for (const n of nodes) {
      assert.deepEqual(n.at, ["tool_result:mcp__archipelago__*"]);
      assert.equal(n.kind, n.title.includes("schema.") ? "schema_check" : "rule");
    }

    // Said only where a result holds its refusal.
    const at = (input: string) => s.agent().reach({ run: RUN, places: ["tool_result:mcp__archipelago__act"], time: new Date().toISOString(), input });
    const said = await at(flat.text);
    assert.deepEqual(said.said.map((x) => x.node), [nodes.find((n) => n.title === "Refused: action.input")!.id]);
    assert.match(said.said[0]!.text, /fix line names each path/);
    assert.deepEqual((await at('{"output":{"id":"x"}}')).said, []);

    const input = nodes.find((n) => n.title === "Refused: action.input")!;
    const set = await s.invoke().invoke({ action: "words.set", input: { node: input.source!, words: "Give every field the action takes." }, authority: { of: "human", basis: "test" }, reason: "reword" });
    assert.ok(set.ok);
    assert.equal((await at(flat.text)).said[0]!.text, "Give every field the action takes.");
    assert.deepEqual(s.errors, []);
  } finally {
    await s.close();
  }
});

test("get and query read every base the same way, bounded, with walks along links", async () => {
  const s = await setup();
  try {
    const make = async (type: string, title: string, part_of?: string) =>
      (await s.call("act", { action: "items.create", input: { type, title, ...(part_of ? { part_of } : {}) } })).json.output.id as string;
    const hub = await make("work", "Track three");
    const task = await make("work", "Serve the map", hub);
    const q = await make("question", "Which tools?", task);
    const r = await make("record", "Ten old tools", q);
    const who = await make("actor", "Owner");
    await s.call("act", { action: "items.link", input: { type: "waits_on", from: task, to: who, fields: { for: "a look" } } });

    const got = await s.call("get", { ids: [task, "i_none"] });
    const t = got.json.items[0];
    assert.equal(t.base, "work");
    assert.equal(t.title, "Serve the map");
    assert.deepEqual(got.json.missing, ["i_none"]);
    const waits = t.links.find((l: any) => l.type === "waits_on");
    assert.deepEqual([waits.to.id, waits.to.title, waits.for], [who, "Owner", "a look"]);
    assert.ok(t.links.some((l: any) => l.type === "part_of" && l.from?.id === q));

    const inside = await s.call("query", { find: `in:${hub}` });
    assert.deepEqual(inside.json.items.map((i: any) => i.title).sort(), ["Serve the map", "Ten old tools", "Track three", "Which tools?"]);
    assert.equal(inside.json.links.length, 3);
    assert.deepEqual((await s.call("query", { find: "type:question" })).json.items.map((i: any) => i.id), [q]);
    assert.deepEqual((await s.call("query", { find: "tools" })).json.items.length, 2);
    const walked = await s.call("query", { find: `id:${r}`, walk: { over: "part_of", dir: "out", steps: 2 } });
    assert.deepEqual(walked.json.items.map((i: any) => i.id), [r, q, task]);
    const limited = await s.call("query", { find: "is:open", limit: 2 });
    assert.equal(limited.json.items.length, 2);
    assert.equal(limited.json.more, 3);
  } finally {
    await s.close();
  }
});

test("tell keeps what the agent concluded as a record about its items, in one change set; replaces supersedes", async () => {
  const s = await setup();
  try {
    const task = (await s.call("act", { action: "items.create", input: { type: "work", title: "Serve the map" } })).json.output.id;
    const first = await s.call("tell", { said: "Six tools are enough.", about: [task] });
    assert.ok(!first.isError, first.text);
    const [rec] = await s.graph().get([first.json.id]);
    assert.deepEqual([rec!.type, rec!.fields.status, rec!.fields.title, rec!.fields.kind], ["record", "current", "Six tools are enough.", "said"]);
    const about = (await s.graph().links(task, { type: "about", dir: "in" })).items;
    assert.deepEqual(about.map((l) => l.from), [first.json.id]);

    const second = await s.call("tell", { said: "Six tools, one of them act.", about: [task], replaces: first.json.id });
    assert.equal((await s.graph().get([first.json.id]))[0]!.fields.status, "superseded");
    const entry = await s.call("act", { action: "history.get", input: { change: second.json.change } });
    assert.equal(entry.json.output.header.run, RUN, "said in the run, as the agent");
    assert.match((await s.call("tell", { said: "x", about: ["i_none"] })).text, /no item i_none/);
  } finally {
    await s.close();
  }
});

test("run says what the run is on the exchange, keeping when it began", async () => {
  const s = await setup();
  try {
    const task = (await s.call("act", { action: "items.create", input: { type: "work", title: "Serve the map" } })).json.output.id;
    const before = (await s.exchange().runs()).items.find((r) => r.run === RUN)!;
    const out = await s.call("run", { title: "MCP tools", task });
    assert.deepEqual(out.json, { run: RUN, title: "MCP tools", task });
    const after = (await s.exchange().runs()).items.find((r) => r.run === RUN)!;
    assert.deepEqual([after.title, after.task, after.harness, after.started], ["MCP tools", task, "test", before.started]);
    assert.match((await s.call("run", { task: "i_none" })).text, /no item i_none/);
    await s.call("run", { end: true });
    assert.ok((await s.exchange().runs()).items.find((r) => r.run === RUN)!.ended);
  } finally {
    await s.close();
  }
});

test("query finds a node item moved to a record by its title: the index reads it whole", async () => {
  const s = await setup();
  try {
    const node = (await s.call("act", { action: "words.add", input: { title: "Moved rule", at: ["tool:Bash"], words: "Its words." } })).json.output.node as string;
    assert.deepEqual((await s.call("query", { find: "moved" })).json.items, [], "a node item isn't a type query shows");
    const facts = [["-", node, "type", "node"], ["+", node, "type", "record"], ["-", node, "words", "Its words."], ["-", node, "at", ["tool:Bash"]], ["-", node, "kind", "reflex"], ["+", node, "kind", "rule"], ["+", node, "note", "Its words."], ["+", node, "status", "current"]];
    const out = await s.call("act", { action: "interchange.import", input: { facts } });
    assert.ok(!out.isError, out.text);
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual((await s.call("query", { find: "moved" })).json.items.map((i: any) => [i.id, i.title]), [[node, "Moved rule"]]);
  } finally {
    await s.close();
  }
});
