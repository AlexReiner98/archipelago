import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionInvoke } from "../spec/action.ts";
import type { AgentRun, Answer } from "../spec/agent.ts";
import type { Json } from "../spec/common.ts";
import type { GraphRead } from "../spec/graph.ts";
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
import claim, { covers, norm, planWords, rounds, type ClaimRead, type Hold, type IntentView } from "../plugins/claim/index.ts";

const probe: Plugin = { id: "probe", inject: ["agent.run", "action.invoke"], apply() {} };
const reader: Plugin = { id: "reader", inject: ["claim.read", "graph.read"], apply() {} };
const CWD = "/home/me/shop";

async function boot(withClaim: boolean) {
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const modules: Record<string, Plugin> = { graph, action, types, work, links, items, exchange, agent, claim, probe, reader };
  const BASE = "mem:/plugins/";
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length)] }) });
  const ids = ["graph", "action", "types", "work", "links", "items", "exchange", "agent", ...(withClaim ? ["claim", "reader"] : []), "probe"];
  await loader.apply(ids.map((id): Entry => ({ id, plugin: id })));
  await rt.settle();
  const as = (run: string) => {
    const ctx = loader.fiber("probe")!.ctx.intercept({ actor: { id: `e_${run}`, kind: "agent" }, run });
    return { run: ctx.get<AgentRun>("agent.run"), invoke: ctx.get<ActionInvoke>("action.invoke") };
  };
  const plan = () => loader.fiber("reader")!.ctx.get<ClaimRead>("claim.read").plan();
  const read = () => loader.fiber("reader")!.ctx.get<GraphRead>("graph.read");
  return { loader, errors, as, plan, graph: read };
}

/** One agent of the two: begins, and plays its calls one at a time so the test can interleave them. */
function agentOf(env: Awaited<ReturnType<typeof boot>>, id: string, title: string, at: { cwd: string; remote?: string } = { cwd: CWD }) {
  const CWD = at.cwd;
  const { run, invoke } = env.as(id);
  let t = 0;
  const time = () => new Date(Date.UTC(2026, 10, 27, 9, 0, t++)).toISOString();
  const writes: string[] = [];
  const heard: string[] = [];
  const refusals: string[] = [];
  const hear = (a: Answer) => heard.push(...a.said.map((s) => s.text));
  return {
    id,
    writes,
    heard,
    refusals,
    async begin() {
      await run.begin({ run: id, agent: { id: `e_${id}`, kind: "agent" }, harness: "test", reaches: [], title, cwd: CWD, ...(at.remote ? { facts: { remote: at.remote } } : {}) });
      hear(await run.reach({ run: id, places: ["session_start"], time: time() }));
    },
    /** The turn's reply ends: the agent stops and waits for its person. */
    async reply() {
      hear(await run.reach({ run: id, places: ["reply_end"], time: time() }));
    },
    async prompt(text: string) {
      hear(await run.reach({ run: id, places: ["prompt"], time: time(), input: text }));
    },
    /** A tool call on a file: true when it went through. */
    async tool(tool: string, file: string) {
      const input = { file_path: `${CWD}/${file}` } as Json;
      const a = await run.reach({ run: id, places: [`tool:${tool}`, `file:${file}`], time: time(), input });
      hear(a);
      if (a.refused) {
        refusals.push(a.refused.text);
        await run.act({ run: id, kind: "tool", by: "agent", place: `tool:${tool}`, time: time(), input, output: a.refused.text, ok: false });
        return false;
      }
      await run.act({ run: id, kind: "tool", by: "agent", place: `tool:${tool}`, time: time(), input, output: "ok", ok: true });
      if (tool !== "Read") writes.push(file);
      return true;
    },
    take: (files: string[], intent: string) => invoke.invoke({ action: "claim.take", input: { files, intent }, authority: { of: "agent", basis: "test" }, reason: "test" }),
    invoke,
    drop: (files?: string[]) => invoke.invoke({ action: "claim.drop", input: files ? { files } : {}, authority: { of: "agent", basis: "test" }, reason: "test" }),
    end: () => run.end(id, time()),
  };
}

/**
 * The scene the tweet is about: two agents, one folder, overlapping work.
 * A renames greet() and fixes its callers; B adds a farewell to the same app
 * file. Played the same way with the plugin and without it.
 */
async function overlap(withClaim: boolean) {
  const env = await boot(withClaim);
  const a = agentOf(env, "run-a", "Rename greet");
  const b = agentOf(env, "run-b", "Add farewell");
  await a.begin();
  await b.begin();
  await a.prompt("Rename greet() to hello() everywhere");
  await b.prompt("Add a farewell message after the greeting");
  await a.tool("Edit", "src/greet.ts");
  await a.tool("Edit", "src/app.ts");
  await b.tool("Read", "src/app.ts");
  await b.tool("Edit", "src/app.ts");
  await b.prompt("Carry on");
  await a.end();
  await b.end();
  const both = a.writes.filter((f) => b.writes.includes(f));
  return { env, a, b, both };
}

test("without a shared plan, two agents both write the same file", async () => {
  const { env, both } = await overlap(false);
  assert.deepEqual(both, ["src/app.ts"]);
  assert.deepEqual(env.errors, []);
  await env.loader.apply([]);
});

test("with the claim plugin, the second write is refused and the agent hears who holds it", async () => {
  const { env, a, b, both } = await overlap(true);
  assert.deepEqual(both, []);
  assert.deepEqual(a.writes, ["src/greet.ts", "src/app.ts"]);
  assert.deepEqual(b.writes, []);
  // B's read of the held file is told, not refused; its prompt after hears the plan.
  assert.ok(b.heard.some((t) => t.startsWith("Rename greet holds src/app.ts")));
  assert.ok(b.heard.some((t) => t.includes("- Rename greet: src/greet.ts, src/app.ts")));
  const plan = env.plan();
  assert.equal(plan.prevented, 1);
  assert.equal(plan.turned[0]!.holder, "run-a");
  assert.equal(plan.turned[0]!.file, "src/app.ts");
  // Both runs ended: nothing is held.
  assert.deepEqual(plan.holds, []);
  assert.deepEqual(env.errors, []);
  await env.loader.apply([]);
});

test("a claim taken first keeps the other agent out before it writes anything, and drop lets go", async () => {
  const env = await boot(true);
  const a = agentOf(env, "run-a", "Rename greet");
  const b = agentOf(env, "run-b", "Add farewell");
  await a.begin();
  await b.begin();
  const took = await a.take(["src/", "README.md"], "rename greet to hello");
  assert.ok(took.ok);
  await b.prompt("Add a farewell");
  assert.ok(b.heard.some((t) => t.includes("- Rename greet: src/, README.md (rename greet to hello)")));
  const clash = await b.take(["src/app.ts"], "add farewell");
  assert.ok(!clash.ok && clash.refused.code === "claim.held");
  assert.equal(await b.tool("Write", "src/farewell.ts"), false);
  assert.equal(await b.tool("Edit", "docs/notes.md"), true);
  await a.drop(["src/"]);
  assert.equal(await b.tool("Edit", "src/app.ts"), true);
  assert.ok((await b.take(["src/app.ts"], "add farewell")).ok);
  const plan = env.plan();
  assert.deepEqual(plan.holds.map((h) => [h.run, h.file, h.how]).sort(), [["run-a", "README.md", "claimed"], ["run-b", "docs/notes.md", "on_write"], ["run-b", "src/app.ts", "claimed"]]);
  assert.deepEqual(env.errors, []);
  await env.loader.apply([]);
});

test("an agent that waits gets the files once the holder ends, instead of leaving its task half done", async () => {
  const env = await boot(true);
  const a = agentOf(env, "run-a", "Add farewell");
  const b = agentOf(env, "run-b", "Rename greet");
  await a.begin();
  await b.begin();
  assert.ok((await a.take(["src/greet.ts", "src/app.ts"], "add farewell")).ok);
  assert.equal(await b.tool("Edit", "src/greet.ts"), false);
  const waited = b.invoke.invoke({ action: "claim.take", input: { files: ["src/greet.ts", "src/app.ts", "src/receipt.ts"], intent: "rename", wait_s: 20 }, authority: { of: "agent", basis: "test" }, reason: "test" });
  let done = false;
  void waited.then(() => (done = true));
  await new Promise((ok) => setTimeout(ok, 20));
  assert.equal(done, false);
  await a.end();
  const out = await waited;
  assert.ok(out.ok);
  assert.equal(await b.tool("Edit", "src/greet.ts"), true);
  const short = await a.take(["x"], "late").catch(() => null);
  assert.ok(short && !short.ok);
  assert.deepEqual(env.errors, []);
  await env.loader.apply([]);
});

test("a replayed run is not an agent working now: it neither holds nor is turned away", async () => {
  const env = await boot(true);
  const a = agentOf(env, "run-a", "Add farewell");
  await a.begin();
  assert.ok((await a.take(["src/app.ts"], "add farewell")).ok);
  const { run } = env.as("replay-1");
  await run.begin({ run: "replay-1", agent: { id: "e_replay", kind: "agent" }, harness: "scripted", reaches: [], title: "Replay of Rename", cwd: CWD, facts: { replay_of: "run-b" } });
  const answer = await run.reach({ run: "replay-1", places: ["tool:Edit", "file:src/app.ts"], time: "2026-11-27T09:00:00.000Z", input: { file_path: `${CWD}/src/app.ts` } });
  assert.equal(answer.refused, undefined);
  assert.equal(env.plan().prevented, 0);
  assert.deepEqual(env.plan().holds.map((h) => h.run), ["run-a"]);
  assert.deepEqual(env.errors, []);
  await env.loader.apply([]);
});

test("paths, folders and the plan's words", () => {
  assert.equal(norm("C:\\Users\\me\\shop\\src\\a.ts", "C:\\Users\\me\\shop"), "src/a.ts");
  assert.equal(norm("./src/a.ts"), "src/a.ts");
  assert.ok(covers("src/", "src/a.ts"));
  assert.ok(covers("src/a.ts", "src/"));
  assert.ok(!covers("src/a.ts", "src/ab.ts"));
  const h: Hold = { scope: "/x", file: "a.ts", run: "r1", title: "One", intent: "fix it", how: "claimed", since: "" };
  assert.equal(planWords([h], "/x", "r1"), "");
  assert.equal(planWords([h], "/y", "r2"), "");
  assert.match(planWords([h], "/x", "r2"), /- One: a\.ts \(fix it\)/);
});

test("two worktrees of one repository share the plan, and the one that waited is told to merge", async () => {
  // A repository with two worktrees, each on its own branch, as two agents in parallel have.
  const root = mkdtempSync(join(tmpdir(), "claim-"));
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  try {
    const main = join(root, "main");
    execFileSync("git", ["init", "-q", "-b", "main", main]);
    writeFileSync(join(main, "a.txt"), "a\n");
    git(main, "add", "-A");
    git(main, "-c", "user.name=t", "-c", "user.email=pat@example.org", "commit", "-qm", "start");
    git(main, "worktree", "add", "-q", "-b", "rename", join(root, "wa"));
    git(main, "worktree", "add", "-q", "-b", "farewell", join(root, "wb"));

    const env = await boot(true);
    const remote = "example.org/pat/shop";
    const a = agentOf(env, "run-a", "Rename greet", { cwd: join(root, "wa"), remote });
    const b = agentOf(env, "run-b", "Add farewell", { cwd: join(root, "wb"), remote });
    await a.begin();
    await b.begin();
    await a.take(["src/greet.ts"], "rename greet to hello");
    // Another folder, the same repository: the hold reaches it, naming the branch.
    assert.equal(await b.tool("Edit", "src/greet.ts"), false);
    assert.match(b.refusals[0]!, /on branch rename: .*git merge rename/);
    assert.equal(env.plan().holds[0]!.scope, "repo:" + remote);
    assert.equal(env.plan().holds[0]!.branch, "rename");

    // B waits; A ends; B gets the file and is told to merge A's branch first.
    const waited = b.invoke.invoke({ action: "claim.take", input: { files: ["src/greet.ts"], intent: "add farewell", wait_s: 20 }, authority: { of: "agent", basis: "test" }, reason: "test" });
    await new Promise((ok) => setTimeout(ok, 50));
    await a.end();
    const got = (await waited) as unknown as { output: { intent: string; merge: string[]; next: string } };
    assert.deepEqual(got.output.merge, ["rename"]);
    // On the map, B's intent depends_on A's: it was built on it.
    await settle();
    const on = await env.graph().links(got.output.intent, { type: "depends_on", dir: "out" });
    assert.equal(on.items.length, 1);
    const [built] = await env.graph().get([on.items[0]!.to]);
    assert.equal(built!.fields.title, "rename greet to hello");
    assert.equal(built!.fields.branch, "rename");
    // It waited first, and the map keeps that.
    const [mine] = await env.graph().get([got.output.intent]);
    assert.ok(typeof mine!.fields.asked === "string" && mine!.fields.asked < String(mine!.fields.since));
    assert.match(got.output.next, /git merge rename/);
    await b.end();
    assert.deepEqual(env.errors, []);
    await env.loader.apply([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Lets the graph's watchers and the plugin's own invocations run. */
const settle = () => new Promise((ok) => setTimeout(ok, 30));

test("the plan is on the map: a plan per repository, an intent per claim, done when its run ends", async () => {
  const env = await boot(true);
  const a = agentOf(env, "run-a", "Rename greet");
  const b = agentOf(env, "run-b", "Add farewell");
  await a.begin();
  await b.begin();
  const took = (await a.take(["src/greet.ts", "src/app.ts"], "rename greet to hello")) as unknown as { ok: true; output: { intent: string } };
  assert.ok(took.ok);
  // The same words again grow the intent; new words are a new one.
  await a.take(["src/receipt.ts"], "Rename greet to hello");
  await settle();
  const [plan] = (await env.graph().of("plan")).items;
  assert.equal(plan!.fields.scope, CWD);
  assert.equal(plan!.fields.title, "Shared plan: shop");
  const [intent] = (await env.graph().of("intent")).items;
  assert.equal(intent!.id, took.output.intent);
  assert.equal(intent!.fields.status, "doing");
  assert.deepEqual(intent!.fields.files, ["src/greet.ts", "src/app.ts", "src/receipt.ts"]);
  assert.equal(intent!.fields.agent, "Rename greet");
  const part = await env.graph().links(intent!.id, { type: "part_of", dir: "out" });
  assert.deepEqual(part.items.map((l) => l.to), [plan!.id]);
  // The page's plan: one plan, its intent.
  assert.deepEqual(env.plan().plans.map((p) => [p.title, p.intents.map((i) => [i.title, i.status])]), [["Shared plan: shop", [["rename greet to hello", "doing"]]]]);

  await a.end();
  await settle();
  const [after] = await env.graph().get([intent!.id]);
  assert.equal(after!.fields.status, "done");
  assert.ok(typeof after!.fields.ended === "string");
  assert.deepEqual(env.plan().holds, []);
  await b.end();
  assert.deepEqual(env.errors, []);
  await env.loader.apply([]);
});

test("an agent alone hears nothing about claiming; once another starts beside it, it is told once", async () => {
  const env = await boot(true);
  const a = agentOf(env, "run-a", "Solo");
  await a.begin();
  await a.prompt("Fix the bug");
  await a.tool("Edit", "src/a.ts");
  assert.equal(a.heard.length, 0);
  assert.deepEqual((await env.graph().of("intent")).items, []);
  const b = agentOf(env, "run-b", "Second");
  await b.begin();
  assert.ok(b.heard.some((t) => t.startsWith("Another agent is working on this repository now.")));
  // A hears it at its next file, once.
  await a.tool("Read", "src/b.ts");
  await a.tool("Read", "src/c.ts");
  assert.equal(a.heard.filter((t) => t.startsWith("Another agent")).length, 1);
  await a.end();
  await b.end();
  assert.deepEqual(env.errors, []);
  await env.loader.apply([]);
});

test("the holds follow the map: an intent closed there, by anyone, lets its files go", async () => {
  const env = await boot(true);
  const a = agentOf(env, "run-a", "Rename greet");
  const b = agentOf(env, "run-b", "Add farewell");
  await a.begin();
  await b.begin();
  const took = (await a.take(["src/app.ts"], "rename")) as unknown as { output: { intent: string } };
  assert.equal(await b.tool("Edit", "src/app.ts"), false);
  // A person drops the intent on the map, through the generic action.
  const set = await env.as("person").invoke.invoke({ action: "items.set", input: { id: took.output.intent, fields: { status: "dropped" } }, authority: { of: "human" }, reason: "test" });
  assert.ok(set.ok);
  await settle();
  assert.equal(await b.tool("Edit", "src/app.ts"), true);
  await a.end();
  await b.end();
  assert.deepEqual(env.errors, []);
  await env.loader.apply([]);
});

test("letting go after writing is done; letting go without writing is dropped", async () => {
  const env = await boot(true);
  const a = agentOf(env, "run-a", "Worker");
  const b = agentOf(env, "run-b", "Other");
  await a.begin();
  await b.begin();
  const wrote = (await a.take(["src/a.ts"], "fix a")) as unknown as { output: { intent: string } };
  await a.tool("Edit", "src/a.ts");
  const idle = (await a.take(["src/b.ts"], "fix b")) as unknown as { output: { intent: string } };
  await a.drop();
  await settle();
  const [done, dropped] = await env.graph().get([wrote.output.intent, idle.output.intent]);
  assert.equal(done!.fields.status, "done");
  assert.equal(dropped!.fields.status, "dropped");
  await a.end();
  await b.end();
  assert.deepEqual(env.errors, []);
  await env.loader.apply([]);
});

test("a plan's intents fall into rounds: work that overlaps or follows within the gap", () => {
  const at = (m: number) => new Date(Date.UTC(2026, 10, 27, 9, m)).toISOString();
  const i = (id: string, from: number, to: number | undefined, status = "done"): IntentView => ({ id, scope: "s", run: id, agent: id, title: id, files: [], status, since: at(from), ...(to !== undefined ? { ended: at(to) } : {}), after: [] });
  const now = Date.parse(at(40));
  const got = rounds([i("c", 30, undefined, "doing"), i("a", 0, 2), i("b", 3, 5)], now);
  assert.deepEqual(got.map((r) => r.intents.map((x) => x.id)), [["a", "b"], ["c"]]);
  assert.equal(got[1]!.end, now);
});

test("a hold lasts a turn: when the holder's reply ends, the one waiting gets the files, though its session goes on", async () => {
  const env = await boot(true);
  const a = agentOf(env, "run-a", "Rename greet");
  const b = agentOf(env, "run-b", "Add farewell");
  await a.begin();
  await b.begin();
  const took = (await a.take(["src/greet.ts"], "rename")) as unknown as { output: { intent: string } };
  await a.tool("Edit", "src/greet.ts");
  await a.tool("Edit", "src/app.ts");
  assert.equal(await b.tool("Edit", "src/app.ts"), false);
  const waited = b.invoke.invoke({ action: "claim.take", input: { files: ["src/greet.ts", "src/app.ts"], intent: "add farewell", wait_s: 20 }, authority: { of: "agent", basis: "test" }, reason: "test" });
  await new Promise((ok) => setTimeout(ok, 30));
  // A's turn ends; its session does not.
  await a.reply();
  const out = await waited;
  assert.ok(out.ok);
  await settle();
  const [done] = await env.graph().get([took.output.intent]);
  assert.equal(done!.fields.status, "done");
  assert.deepEqual(env.plan().holds.map((h) => [h.run, h.file]).sort(), [["run-b", "src/app.ts"], ["run-b", "src/greet.ts"]]);
  // A, in its next turn, finds them held by B.
  await a.prompt("Now tidy greet");
  assert.equal(await a.tool("Edit", "src/greet.ts"), false);
  await a.end();
  await b.end();
  assert.deepEqual(env.errors, []);
  await env.loader.apply([]);
});
