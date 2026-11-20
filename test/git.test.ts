import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentRun } from "../spec/agent.ts";
import type { GraphRead } from "../spec/graph.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import action from "../packs/action/index.ts";
import agent from "../packs/agent/index.ts";
import exchange from "../packs/exchange/index.ts";
import graph from "../packs/graph/index.ts";
import types from "../packs/types/index.ts";
import record from "../packs/record/index.ts";
import git, { normalRemote } from "../packs/git/index.ts";

const BASE = "mem:/packs/";

const probe: Pack = { id: "probe", inject: ["agent.run", "graph.read"], apply() {} };

/** git as a table: folder → remote url and branch. */
const fakeGit = (folders: Record<string, { url?: string; branch?: string }>) => async (cwd: string, args: string[]) => {
  const f = folders[cwd];
  if (!f) return undefined;
  return args[0] === "remote" ? f.url : f.branch;
};

async function setup(folders: Record<string, { url?: string; branch?: string }>) {
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const modules: Record<string, Pack> = { "graph.ts": graph, "action.ts": action, "types.ts": types, "record.ts": record, "exchange.ts": exchange, "agent.ts": agent, "git.ts": git as Pack, "probe.ts": probe };
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length)] }) });
  const tree: Entry[] = [
    { id: "graph", pack: "graph.ts" },
    { id: "action", pack: "action.ts" },
    { id: "types", pack: "types.ts" },
    { id: "record", pack: "record.ts" },
    { id: "exchange", pack: "exchange.ts" },
    { id: "agent", pack: "agent.ts" },
    { id: "git", pack: "git.ts", config: { git: fakeGit(folders) } },
    { id: "probe", pack: "probe.ts" },
  ];
  await loader.apply(tree);
  await rt.settle();
  const ctx = loader.fiber("probe")!.ctx.intercept({ actor: { id: "e_agent", kind: "agent" }, run: "r1" });
  return { errors, loader, run: ctx.get<AgentRun>("agent.run"), read: ctx.get<GraphRead>("graph.read") };
}

const start = (run: string, cwd: string) => ({ run, agent: { id: "e_agent", kind: "agent" as const }, harness: "claude-code", reaches: [], cwd });

test("remotes read alike from https, ssh and scp forms", () => {
  assert.equal(normalRemote("https://github.com/AlexReiner98/archipelago-next.git"), "github.com/AlexReiner98/archipelago-next");
  assert.equal(normalRemote("git@github.com:AlexReiner98/archipelago-next.git"), "github.com/AlexReiner98/archipelago-next");
  assert.equal(normalRemote("ssh://git@GitHub.com/AlexReiner98/Aperture"), "github.com/AlexReiner98/Aperture");
  assert.equal(normalRemote("https://user:token@github.com/a/b.git"), "github.com/a/b");
  assert.equal(normalRemote(""), undefined);
});

test("a run's facts carry its remote, branch and repo item; worktrees of one remote share the item", async () => {
  const url = "https://github.com/AlexReiner98/archipelago-next.git";
  const { errors, run, read, loader } = await setup({
    "C:/main": { url, branch: "main" },
    "C:/worktree": { url: "git@github.com:AlexReiner98/archipelago-next.git", branch: "lane" },
    "C:/plain": {},
  });
  const a = await run.begin(start("r1", "C:/main"));
  assert.equal(a.facts?.remote, "github.com/AlexReiner98/archipelago-next");
  assert.equal(a.facts?.branch, "main");
  const [item] = await read.get([String(a.facts?.repo)]);
  assert.equal(item?.type, "repo");
  assert.equal(item?.fields.title, "archipelago-next");

  const [b, c] = await Promise.all([run.begin(start("r2", "C:/worktree")), run.begin(start("r3", "C:/worktree"))]);
  assert.equal(b.facts?.repo, a.facts?.repo);
  assert.equal(c.facts?.repo, a.facts?.repo);
  assert.equal(b.facts?.branch, "lane");

  const plain = await run.begin(start("r4", "C:/plain"));
  assert.deepEqual(plain.facts, { harness: "claude-code", cwd: "C:/plain" });
  assert.equal((await read.of("repo")).items.length, 1);
  assert.deepEqual(errors, []);
  await loader.apply([]);
});
