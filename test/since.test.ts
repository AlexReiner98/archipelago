import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionInvoke } from "../spec/action.ts";
import type { AgentRun, AgentTree } from "../spec/agent.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import action from "../packs/action/index.ts";
import agent from "../packs/agent/index.ts";
import exchange from "../packs/exchange/index.ts";
import graph from "../packs/graph/index.ts";
import words from "../packs/words/index.ts";
import since, { tell } from "../packs/since/index.ts";

const BASE = "mem:/packs/";
const probe: Pack = { id: "probe", inject: ["agent.run", "agent.tree", "action.invoke"], apply() {} };
const ALEX = { id: "person:owner", kind: "person" as const };
const AGENT = { id: "claude-code", kind: "agent" as const };

async function setup() {
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const modules: Record<string, Pack> = { graph, action, exchange, agent, words, since, probe };
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length, -3)] }) });
  const tree: Entry[] = ["graph", "action", "exchange", "agent", "words", "since", "probe"].map((id) => ({ id, pack: `${id}.ts` }));
  await loader.apply(tree);
  await rt.settle();
  const as = (actor: typeof ALEX | typeof AGENT, run?: string) => loader.fiber("probe")!.ctx.intercept({ actor, ...(run ? { run } : {}) });
  const add = (actor: typeof ALEX | typeof AGENT, title: string, run?: string) =>
    as(actor, run).get<ActionInvoke>("action.invoke").invoke({ action: "words.add", input: { title, at: ["tool:Nothing"], words: title }, authority: { of: "human", basis: "test" }, reason: `add ${title}` });
  const agentRun = () => as(AGENT, "r1").get<AgentRun>("agent.run");
  const prompt = async () => (await agentRun().reach({ run: "r1", places: ["prompt"], time: new Date().toISOString(), input: "go on" })).said.map((s) => s.text);
  return { loader, errors, add, agentRun, prompt, tree: () => as(AGENT).get<AgentTree>("agent.tree") };
}

test("at a prompt, the run hears what a person changed on the map since it last heard, and only that", async () => {
  const s = await setup();
  try {
    assert.ok(s.tree().nodes().some((n) => n.id === "since/heard" && n.at.includes("prompt")));
    await s.add(ALEX, "Before the run");
    await new Promise((r) => setTimeout(r, 5));
    await s.agentRun().begin({ run: "r1", agent: AGENT, harness: "test", reaches: ["prompt"] });
    assert.deepEqual(await s.prompt(), [], "nothing since it began");

    await new Promise((r) => setTimeout(r, 5));
    await s.add(ALEX, "Alex's new node");
    await s.add(AGENT, "The run's own node", "r1");
    await s.add(AGENT, "Another agent's node", "r2");
    const said = await s.prompt();
    assert.equal(said.length, 1);
    assert.match(said[0]!, /^Since you last heard, a person changed the map:\n- added a node "Alex's new node": add Alex's new node$/);

    assert.deepEqual(await s.prompt(), [], "heard once");
    assert.deepEqual(s.errors, []);
  } finally {
    await s.loader.apply([]);
  }
});

test("what it tells is brief: the last few, and how many came before", () => {
  const sets = Array.from({ length: 5 }, (_, i) => ({
    id: `c${i}`,
    seq: i,
    committed: "",
    header: { actor: ALEX, authority: { of: "human" as const, basis: "" }, pack: { id: "items" }, action: "items.set", reason: `step ${i}`, time: "" },
    facts: [["+", `i${i}`, "status", "done"] as ["+", string, string, string]],
  }));
  const titles = new Map(sets.map((c, i) => [`i${i}`, `Task ${i}`]));
  assert.equal(tell(sets, titles, 2), 'Since you last heard, a person changed the map:\n- changed "Task 3": step 3\n- changed "Task 4": step 4\n(and 3 earlier)');
});
