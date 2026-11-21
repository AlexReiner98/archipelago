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
import { askText } from "../packs/grow/index.ts";

const BASE = "mem:/packs/";
const probe: Pack = { id: "probe", inject: ["agent.run", "agent.tree", "action.invoke"], apply() {} };
const OWNER = { id: "person:owner", kind: "person" as const };
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
  const as = (actor: typeof OWNER | typeof AGENT, run?: string) => loader.fiber("probe")!.ctx.intercept({ actor, ...(run ? { run } : {}) });
  const add = (actor: typeof OWNER | typeof AGENT, title: string, run?: string) =>
    as(actor, run).get<ActionInvoke>("action.invoke").invoke({ action: "words.add", input: { title, at: ["tool:Nothing"], words: title }, authority: { of: "human", basis: "test" }, reason: `add ${title}` });
  const agentRun = () => as(AGENT, "r1").get<AgentRun>("agent.run");
  const prompt = async () => (await agentRun().reach({ run: "r1", places: ["prompt"], time: new Date().toISOString(), input: "go on" })).said.map((s) => s.text);
  return { loader, errors, add, agentRun, prompt, as, tree: () => as(AGENT).get<AgentTree>("agent.tree") };
}

test("at a prompt, the run hears what a person changed on the map since it last heard, and only that", async () => {
  const s = await setup();
  try {
    assert.ok(s.tree().nodes().some((n) => n.id === "since/heard" && n.at.includes("prompt")));
    await s.add(OWNER, "Before the run");
    await new Promise((r) => setTimeout(r, 5));
    await s.agentRun().begin({ run: "r1", agent: AGENT, harness: "test", reaches: ["prompt"] });
    assert.deepEqual(await s.prompt(), [], "nothing since it began");

    await new Promise((r) => setTimeout(r, 5));
    await s.add(OWNER, "Owner's new node");
    await s.add(AGENT, "The run's own node", "r1");
    await s.add(AGENT, "Another agent's node", "r2");
    const said = await s.prompt();
    assert.equal(said.length, 1);
    assert.match(said[0]!, /^Since you last heard, a person changed the map:\n- added a node "Owner's new node": add Owner's new node$/);

    assert.deepEqual(await s.prompt(), [], "heard once");
    assert.deepEqual(s.errors, []);
  } finally {
    await s.loader.apply([]);
  }
});

test("its wording is a node item on the map, said by this node only, and words.set rewords it", async () => {
  const s = await setup();
  try {
    const heard = s.tree().nodes().filter((n) => n.title === "Since you last heard");
    assert.equal(heard.length, 1, "the words pack doesn't say the voice item itself");
    assert.equal(heard[0]!.id, "since/heard");
    assert.ok(heard[0]!.source, "the node points at its wording on the map");
    await s.agentRun().begin({ run: "r1", agent: AGENT, harness: "test", reaches: ["prompt"] });
    await new Promise((r) => setTimeout(r, 5));
    await s.add(OWNER, "A change");
    const reword = await s.as(OWNER).get<ActionInvoke>("action.invoke").invoke({
      action: "words.set",
      input: { node: heard[0]!.source!, words: "While you were away:\n{changes}" },
      authority: { of: "human", basis: "test" },
      reason: "reword",
    });
    assert.ok(reword.ok);
    const said = await s.prompt();
    assert.match(said[0]!, /^While you were away:\n- added a node "A change"/);
    assert.deepEqual(s.errors, []);
  } finally {
    await s.loader.apply([]);
  }
});

test("grow's question fills its wording, and keeps the seqs on its first line whatever the wording", () => {
  const misses = [{ seq: 4, places: ["tool:Bash"], words: "boom", text: "boom" }];
  assert.match(askText(misses), /^Before you finish: a miss in this run that nothing on the map covers \(#4\)\./);
  assert.equal(askText(misses, "Fix {list} please"), "(#4) Fix - #4 at tool:Bash: boom please");
});

test("what it tells is brief: the last few, and how many came before", () => {
  const sets = Array.from({ length: 5 }, (_, i) => ({
    id: `c${i}`,
    seq: i,
    committed: "",
    header: { actor: OWNER, authority: { of: "human" as const, basis: "" }, pack: { id: "items" }, action: "items.set", reason: `step ${i}`, time: "" },
    facts: [["+", `i${i}`, "status", "done"] as ["+", string, string, string]],
  }));
  const titles = new Map(sets.map((c, i) => [`i${i}`, `Task ${i}`]));
  assert.equal(tell(sets, titles, 2), 'Since you last heard, a person changed the map:\n- changed "Task 3": step 3\n- changed "Task 4": step 4\n(and 3 earlier)');
});
