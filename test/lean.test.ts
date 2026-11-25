import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ActionInvoke, ActionRegister } from "../spec/action.ts";
import type { AgentRun } from "../spec/agent.ts";
import { Runtime, type Plugin } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import action from "../plugins/action/index.ts";
import agent from "../plugins/agent/index.ts";
import exchange from "../plugins/exchange/index.ts";
import graph from "../plugins/graph/index.ts";
import types from "../plugins/types/index.ts";
import record from "../plugins/record/index.ts";
import links from "../plugins/links/index.ts";
import items from "../plugins/items/index.ts";
import history from "../plugins/history/index.ts";
import profile from "../plugins/profile/index.ts";
import used from "../plugins/used/index.ts";
import lean from "../plugins/lean/index.ts";
import leanWrite, { safeFolder } from "../plugins/lean/write.ts";
import { entriesOf, kept, leaveOut, reconcile } from "../plugins/lean/plan.ts";

const T = "2026-11-22T10:00:00.000Z";

test("leaveOut: servers none used, then their unused tools only when the server stays; never the kept; nothing on too few runs", () => {
  const rows = [
    { name: "mcp:x", given: 3, used: 0, size: 600 },
    { name: "tool:mcp__x__a", given: 3, used: 0, size: 300 },
    { name: "mcp:y", given: 3, used: 1, size: 200 },
    { name: "tool:mcp__y__a", given: 3, used: 1, size: 100 },
    { name: "tool:mcp__y__b", given: 3, used: 0, size: 100 },
    { name: "tool:Artifact", given: 3, used: 0, size: 37000 },
    { name: "tool:Read", given: 3, used: 0, size: 900 },
    { name: "mcp:archipelago", given: 3, used: 0, size: 900 },
    { name: "tool:mcp__archipelago__run", given: 3, used: 0, size: 900 },
  ];
  assert.deepEqual(leaveOut(rows, 5).map((l) => l.name), ["mcp:x", "tool:mcp__y__b", "tool:Artifact"]);
  assert.deepEqual(leaveOut(rows, 4), [], "too few runs say nothing");
  assert.match(kept("tool:Bash")!, /always kept/);
  assert.match(kept("tool:../../x")!, /not tool/);
  assert.deepEqual(entriesOf("mcp:x"), { deny: "mcp__x", server: "x" });
  assert.deepEqual(entriesOf("tool:Artifact"), { deny: "Artifact" });
});

test("reconcile: adds what is wanted, takes out only its own, keeps the person's; a file it made goes when empty", () => {
  const theirs = JSON.stringify({ permissions: { allow: ["Bash(ls)"], deny: ["Artifact"] }, model: "x" });
  const a = reconcile(theirs, undefined, { deny: ["Artifact", "mcp__y"], servers: ["y"] });
  assert.ok(!("error" in a));
  assert.deepEqual(JSON.parse(a.text!), { permissions: { allow: ["Bash(ls)"], deny: ["Artifact", "mcp__y"] }, model: "x", disabledMcpjsonServers: ["y"] });
  assert.deepEqual(a.ours, { deny: ["mcp__y"], servers: ["y"] }, "Artifact was theirs already");
  const b = reconcile(a.text, a.ours, { deny: [], servers: [] });
  assert.ok(!("error" in b));
  assert.deepEqual(JSON.parse(b.text!), JSON.parse(theirs), "back to what it was");
  const made = reconcile(undefined, undefined, { deny: ["Artifact"], servers: [] });
  assert.ok(!("error" in made) && made.ours.created);
  const gone = reconcile(made.text, made.ours, { deny: [], servers: [] });
  assert.ok(!("error" in gone) && gone.text === undefined && !gone.same, "a file it made goes");
  const same = reconcile(a.text, a.ours, { deny: ["Artifact", "mcp__y"], servers: ["y"] });
  assert.ok(!("error" in same) && same.same);
  assert.deepEqual(reconcile("{oops", undefined, { deny: ["A"], servers: [] }), { error: "it is not JSON" });
});

test("safeFolder: never the home folder, above it, under ~/.claude, a root, or a folder that isn't there", async () => {
  const home = await mkdtemp(join(tmpdir(), "lean-home-"));
  try {
    await mkdir(join(home, "proj"));
    await mkdir(join(home, ".claude", "x"), { recursive: true });
    assert.equal(await safeFolder(join(home, "proj"), home), true);
    assert.equal(await safeFolder(home, home), false);
    assert.equal(await safeFolder(join(home, ".."), home), false);
    assert.equal(await safeFolder(join(home, ".claude", "x"), home), false);
    assert.equal(await safeFolder(join(home, "none"), home), false);
    assert.equal(await safeFolder("relative/dir", home), false);
    assert.equal(await safeFolder(process.platform === "win32" ? "C:\\" : "/", home), false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

/** Stands in for the transcript plugin: what each run was given. */
const GIVEN: Record<string, { name: string; size: number }[]> = {
  r1: [{ name: "tool:Bash", size: 900 }, { name: "tool:Artifact", size: 37000 }, { name: "tool:mcp__y__a", size: 300 }, { name: "mcp:y", size: 100 }],
  r2: [{ name: "tool:Bash", size: 900 }, { name: "tool:Artifact", size: 37000 }, { name: "tool:mcp__y__a", size: 300 }],
  r3: [{ name: "tool:Bash", size: 900 }, { name: "tool:Artifact", size: 37000 }],
};
const fakeTranscript: Plugin = {
  id: "transcript",
  inject: ["action.register"],
  apply(ctx) {
    ctx.get<ActionRegister>("action.register").register({
      name: "transcript.given",
      title: "fake",
      input: { type: "object" },
      async run(input: { run: string }) {
        return { nodes: (GIVEN[input.run] ?? []).map((n) => ({ ...n, title: n.name, by: "Claude Code", at: "x", count: 1 })) };
      },
    });
  },
};
const probe: Plugin = { id: "probe", inject: ["agent.run", "action.invoke"], apply() {} };
const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));

test("a lean profile: planned always; set as a change set; written into its runs' project settings only while on, taken out by undo and by unloading", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lean-"));
  const home = join(dir, "home");
  const proj = join(dir, "proj");
  await mkdir(home);
  await mkdir(join(proj, ".claude"), { recursive: true });
  const settings = join(proj, ".claude", "settings.local.json");
  const theirs = { permissions: { allow: ["Bash(ls)"] } };
  await writeFile(settings, JSON.stringify(theirs));
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const modules: Record<string, Plugin> = { graph, action, types, record, links, items, history, exchange, agent, profile, transcript: fakeTranscript, used, lean, "lean-write": leanWrite as Plugin, probe } as Record<string, Plugin>;
  const BASE = "mem:/plugins/";
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length)] }) });
  const tree: Entry[] = Object.keys(modules).map((id) => ({ id, plugin: id, ...(id === "lean-write" ? { config: { home, ledger: join(dir, "data", "lean.json") } } : {}) }));
  await loader.apply(tree);
  await rt.settle();
  const ctx = (run: string) => loader.fiber("probe")!.ctx.intercept({ actor: { id: "e_agent", kind: "agent" }, run });
  const invoke = (a: string, input: object) => ctx("r0").get<ActionInvoke>("action.invoke").invoke({ action: a, input: input as never, authority: { of: "human", basis: "test" }, reason: "test" });
  const ok = async (a: string, input: object) => {
    const o = await invoke(a, input);
    assert.ok(o.ok, JSON.stringify(o));
    return o;
  };
  const disk = async () => JSON.parse(await readFile(settings, "utf8")) as Record<string, unknown>;
  try {
    const pid = ((await ok("items.create", { type: "context_filter", title: "Lean" })).output as { id: string }).id;
    for (const r of ["r1", "r2", "r3", "r4", "r5"]) {
      await ctx(r).get<AgentRun>("agent.run").begin({ run: r, agent: { id: "e_agent", kind: "agent" }, harness: "test", reaches: [], facts: { transcript: `/t/${r}.jsonl`, cwd: proj, profiles: pid } });
      await ctx(r).get<AgentRun>("agent.run").act({ run: r, place: "tool:Bash", time: T, kind: "tool", by: "agent", ok: true });
    }
    // Planned in shadow: it only says.
    const plan = await ok("lean.plan", { run: "r1" });
    const p = (plan.output as { plans: { title: string; state: string; runs: number; leave: { name: string }[]; letters: number; set: string[] }[] }).plans[0]!;
    assert.deepEqual([p.title, p.state, p.runs, p.leave.map((l) => l.name), p.letters, p.set], ["Lean", "shadow", 5, ["mcp:y", "tool:Artifact"], 37300, []]);
    assert.equal(plan.change, undefined, "a plan writes nothing");

    const set = await ok("lean.set", { profile: pid });
    assert.ok(set.change, "setting it is a change set");
    await wait();
    assert.deepEqual(await disk(), theirs, "in shadow, nothing is written");
    const refused = await invoke("lean.set", { profile: pid, leave: ["tool:Read"] });
    assert.ok(!refused.ok && refused.refused.code === "lean.kept");

    await ok("items.set", { id: pid, fields: { status: "on" } });
    await wait();
    assert.deepEqual(await disk(), { permissions: { allow: ["Bash(ls)"], deny: ["mcp__y", "Artifact"] }, disabledMcpjsonServers: ["y"] });
    assert.deepEqual((await ok("lean-write.status", {})).output, { files: 1, entries: 3 });

    await ok("history.undo", { change: set.change });
    await wait();
    assert.deepEqual(await disk(), theirs, "undoing the set takes its entries out");

    await ok("lean.set", { profile: pid, leave: ["tool:Artifact"] });
    await wait();
    assert.deepEqual((await disk()).permissions, { allow: ["Bash(ls)"], deny: ["Artifact"] });
    assert.deepEqual(JSON.parse(await readFile(join(dir, "data", "lean.json"), "utf8")).files[settings].entries, [{ at: ["permissions", "deny"], item: "Artifact" }], "the ledger holds what it added");
    assert.deepEqual(errors, []);
  } finally {
    await loader.apply([]);
  }
  try {
    assert.deepEqual(await disk(), theirs, "unloading takes everything it wrote out");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
