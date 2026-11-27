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
import claim, { absOf, covers, norm, planWords, rounds, type ClaimRead, type Hold, type IntentView } from "../plugins/claim/index.ts";

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
  const tree = (on: boolean, config?: unknown) =>
    ["graph", "action", "types", "work", "links", "items", "exchange", "agent", ...(on ? ["claim", "reader"] : []), "probe"].map((id): Entry => ({ id, plugin: id, ...(id === "claim" && config ? { config } : {}) }));
  await loader.apply(tree(withClaim));
  await rt.settle();
  /** The server restarts: the claim plugin comes back knowing no run, while the map keeps its intents. */
  const restart = async (config?: unknown) => {
    await loader.apply(tree(false));
    await rt.settle();
    await loader.apply(tree(true, config));
    await rt.settle();
  };
  const as = (run: string) => {
    const ctx = loader.fiber("probe")!.ctx.intercept({ actor: { id: `e_${run}`, kind: "agent" }, run });
    return { run: ctx.get<AgentRun>("agent.run"), invoke: ctx.get<ActionInvoke>("action.invoke") };
  };
  const plan = () => loader.fiber("reader")!.ctx.get<ClaimRead>("claim.read").plan();
  const read = () => loader.fiber("reader")!.ctx.get<GraphRead>("graph.read");
  return { loader, errors, as, plan, graph: read, restart };
}

/** One agent of the two: begins, and plays its calls one at a time so the test can interleave them. */
function agentOf(env: Awaited<ReturnType<typeof boot>>, id: string, title: string, at: { cwd: string; remote?: string; branch?: string } = { cwd: CWD }) {
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
      await run.begin({ run: id, agent: { id: `e_${id}`, kind: "agent" }, harness: "test", reaches: [], title, cwd: CWD, ...(at.remote || at.branch ? { facts: { ...(at.remote ? { remote: at.remote } : {}), ...(at.branch ? { branch: at.branch } : {}) } } : {}) });
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

test("after a restart, a run the map has not heard from can still drop its own claims", async () => {
  const env = await boot(true);
  const a = agentOf(env, "run-a", "Rename greet");
  await a.begin();
  assert.ok((await a.take(["src/greet.ts"], "rename greet")).ok);
  await env.restart();
  // The intent is still open on the map, from a run this server has not heard.
  assert.deepEqual(env.plan().holds.map((h) => [h.run, h.file, h.unheard]), [["run-a", "src/greet.ts", true]]);
  const dropped = await a.drop();
  assert.ok(dropped.ok, JSON.stringify(dropped));
  assert.deepEqual(env.plan().holds, []);
  assert.deepEqual(env.errors, []);
  await env.loader.apply([]);
});

test("after a restart, holds of a run the map does not hear again end on their own; one heard again keeps them", async () => {
  const env = await boot(true);
  const a = agentOf(env, "run-a", "Rename greet");
  const b = agentOf(env, "run-b", "Add farewell");
  const c = agentOf(env, "run-c", "Fix docs");
  await a.begin();
  await c.begin();
  assert.ok((await a.take(["src/greet.ts"], "rename greet")).ok);
  assert.ok((await c.take(["README.md"], "fix docs")).ok);
  await env.restart({ unheard_s: 0.2 });
  // B starts after the restart and hears A's hold as unheard, with how to end it.
  await b.begin();
  await b.prompt("Add a farewell");
  assert.ok(b.heard.some((t) => t.includes("- Rename greet: src/greet.ts (rename greet) [not heard since the map restarted")));
  const refused = await b.take(["src/greet.ts"], "add farewell");
  assert.ok(!refused.ok && refused.refused.message.includes(`claim.release {"run": "run-a"}`));
  // C is heard again (its next step): it keeps its hold. A is not.
  await c.prompt("Carry on");
  await new Promise((ok) => setTimeout(ok, 300));
  env.plan(); // a read lets unheard holds go
  await new Promise((ok) => setTimeout(ok, 20));
  assert.deepEqual(env.plan().holds.map((h) => [h.run, h.file]), [["run-c", "README.md"]]);
  assert.ok((await b.take(["src/greet.ts"], "add farewell")).ok);
  const intents = await env.graph().of("intent", { limit: 10 });
  assert.deepEqual(intents.items.map((i) => [i.fields.run, i.fields.status]).sort(), [["run-a", "done"], ["run-b", "doing"], ["run-c", "doing"]]);
  assert.deepEqual(env.errors, []);
  await env.loader.apply([]);
});

test("any run can end the claims of a run that is not live, never of a live one", async () => {
  const env = await boot(true);
  const a = agentOf(env, "run-a", "Rename greet");
  const b = agentOf(env, "run-b", "Add farewell");
  await a.begin();
  assert.ok((await a.take(["src/greet.ts"], "rename greet")).ok);
  await b.begin();
  const release = () => b.invoke.invoke({ action: "claim.release", input: { run: "run-a" }, authority: { of: "agent", basis: "test" }, reason: "test" });
  // A is live: B is refused.
  const live = await release();
  assert.ok(!live.ok && live.refused.code === "claim.not_yours");
  await env.restart();
  await b.prompt("Add a farewell");
  // A is not heard since the restart: B may end its claim.
  const ended = await release();
  assert.ok(ended.ok, JSON.stringify(ended));
  assert.deepEqual(env.plan().holds, []);
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

test("on a hosted map, the branch comes from the run's facts: the folders are on another machine", async () => {
  const env = await boot(true);
  const remote = "example.org/pat/shop";
  // Folders the server can't read: only the facts the hook sent say the branch.
  const a = agentOf(env, "run-a", "Rename greet", { cwd: "/home/me/elsewhere/wa", remote, branch: "rename" });
  const b = agentOf(env, "run-b", "Add farewell", { cwd: "/home/me/elsewhere/wb", remote, branch: "farewell" });
  await a.begin();
  await b.begin();
  await a.take(["src/greet.ts"], "rename greet");
  assert.equal(env.plan().holds[0]!.branch, "rename");
  assert.equal(await b.tool("Edit", "src/greet.ts"), false);
  assert.match(b.refusals[0]!, /on branch rename: .*git merge rename/);
  await settle();
  assert.equal(env.plan().plans[0]!.intents[0]!.branch, "rename");
  await a.end();
  await b.end();
  assert.deepEqual(env.errors, []);
  await env.loader.apply([]);
});

test("one file held from two repositories is one hold: by its absolute path", async () => {
  const env = await boot(true);
  // A works in one repository and claims a file in another, by its absolute path; B works in that other one.
  const a = agentOf(env, "run-a", "Next", { cwd: "C:/Users/me/next", remote: "example.org/pat/next", branch: "plugin-folders" });
  const b = agentOf(env, "run-b", "Apps", { cwd: "C:/Users/me/apps", remote: "example.org/pat/apps", branch: "main" });
  await a.begin();
  await b.begin();
  assert.ok((await a.take(["C:/Users/me/apps/core.ts"], "move core here")).ok);
  // B names it relative to its own folder, in its own repository's plan: still held.
  assert.equal(await b.tool("Edit", "core.ts"), false);
  assert.match(b.refusals[0]!, /Next holds/);
  // And B hears A's hold in its plan, though it is in another repository's.
  await b.prompt("Carry on");
  assert.ok(b.heard.some((t) => t.includes("- Next on branch plugin-folders: C:/Users/me/apps/core.ts")));
  // A file of the same name elsewhere is not held.
  assert.equal(await b.tool("Edit", "lib/core.ts"), true);
  // The other way: B's hold on a file A then names by its absolute path, Windows case aside.
  assert.equal(await a.tool("Edit", "c:/users/me/apps/lib/core.ts"), false);
  await a.end();
  await b.end();
  assert.deepEqual(env.errors, []);
  await env.loader.apply([]);
});

test("absolute paths: from a path and its run's folder, drive paths in lower case", () => {
  assert.equal(absOf("src/a.ts", "C:/Users/Me/Repo/"), "c:/users/me/repo/src/a.ts");
  assert.equal(absOf("C:\\Users\\Me\\x.ts", "/home/me"), "c:/users/me/x.ts");
  assert.equal(absOf("src/a.ts", "/home/me/repo"), "/home/me/repo/src/a.ts");
  assert.equal(absOf("src/a.ts", "relative/folder"), undefined);
  assert.equal(absOf("src/a.ts"), undefined);
});
