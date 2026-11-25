import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentRun } from "../spec/agent.ts";
import type { GraphRead } from "../spec/graph.ts";
import { Runtime, type Plugin } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import action from "../plugins/action/index.ts";
import agent from "../plugins/agent/index.ts";
import exchange from "../plugins/exchange/index.ts";
import graph from "../plugins/graph/index.ts";
import types from "../plugins/types/index.ts";
import record from "../plugins/record/index.ts";
import git, { givenRemote, normalRemote } from "../plugins/git/index.ts";

const BASE = "mem:/plugins/";

const probe: Plugin = { id: "probe", inject: ["agent.run", "graph.read"], apply() {} };

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
  const modules: Record<string, Plugin> = { "graph.ts": graph, "action.ts": action, "types.ts": types, "record.ts": record, "exchange.ts": exchange, "agent.ts": agent, "git.ts": git as Plugin, "probe.ts": probe };
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length)] }) });
  const tree: Entry[] = [
    { id: "graph", plugin: "graph.ts" },
    { id: "action", plugin: "action.ts" },
    { id: "types", plugin: "types.ts" },
    { id: "record", plugin: "record.ts" },
    { id: "exchange", plugin: "exchange.ts" },
    { id: "agent", plugin: "agent.ts" },
    { id: "git", plugin: "git.ts", config: { git: fakeGit(folders) } },
    { id: "probe", plugin: "probe.ts" },
  ];
  await loader.apply(tree);
  await rt.settle();
  const ctx = loader.fiber("probe")!.ctx.intercept({ actor: { id: "e_agent", kind: "agent" }, run: "r1" });
  return { errors, loader, run: ctx.get<AgentRun>("agent.run"), read: ctx.get<GraphRead>("graph.read") };
}

const start = (run: string, cwd: string) => ({ run, agent: { id: "e_agent", kind: "agent" as const }, harness: "claude-code", reaches: [], cwd });

test("a remote the start gave is used where git can't see the folder (a hosted server)", async () => {
  const { errors, run, read, loader } = await setup({ "C:/here": { url: "https://github.com/a/other.git", branch: "main" } });
  // The folder is on another machine: git finds nothing, the hook's remote is the repository.
  const a = await run.begin({ ...start("r1", "C:/elsewhere"), facts: { remote: "github.com/example/archipelago-next" } });
  assert.equal(a.facts?.remote, "github.com/example/archipelago-next");
  const [item] = await read.get([String(a.facts?.repo)]);
  assert.equal(item?.fields.remote, "github.com/example/archipelago-next");
  // Given wins over the folder's own origin, and a url is read as a remote.
  const b = await run.begin({ ...start("r2", "C:/here"), facts: { remote: "git@GitHub.com:example/archipelago-next.git" } });
  assert.equal(b.facts?.repo, a.facts?.repo);
  assert.equal(b.facts?.branch, "main");
  // Not a remote: git reads the folder as before.
  const c = await run.begin({ ...start("r3", "C:/here"), facts: { remote: "nonsense" } });
  assert.notEqual(c.facts?.repo, a.facts?.repo);
  assert.equal((await read.of("repo")).items.length, 2);
  assert.deepEqual(errors, []);
  await loader.apply([]);
});

test("given remotes: urls and host/owner/name; nothing else", () => {
  assert.equal(givenRemote("github.com/a/b"), "github.com/a/b");
  assert.equal(givenRemote("GitHub.com/A/b.git"), "github.com/A/b");
  assert.equal(givenRemote("https://u:t@github.com/a/b.git"), "github.com/a/b");
  assert.equal(givenRemote(["github.com/a/b"]), "github.com/a/b");
  assert.equal(givenRemote("nonsense"), undefined);
  assert.equal(givenRemote("a/b"), undefined);
  assert.equal(givenRemote(3), undefined);
});

test("remotes read alike from https, ssh and scp forms", () => {
  assert.equal(normalRemote("https://github.com/example/archipelago-next.git"), "github.com/example/archipelago-next");
  assert.equal(normalRemote("git@github.com:example/archipelago-next.git"), "github.com/example/archipelago-next");
  assert.equal(normalRemote("ssh://git@GitHub.com/example/Studio"), "github.com/example/Studio");
  assert.equal(normalRemote("https://user:token@github.com/a/b.git"), "github.com/a/b");
  assert.equal(normalRemote(""), undefined);
});

test("a run's facts carry its remote, branch and repo item; worktrees of one remote share the item", async () => {
  const url = "https://github.com/example/archipelago-next.git";
  const { errors, run, read, loader } = await setup({
    "C:/main": { url, branch: "main" },
    "C:/worktree": { url: "git@github.com:example/archipelago-next.git", branch: "lane" },
    "C:/plain": {},
  });
  const a = await run.begin(start("r1", "C:/main"));
  assert.equal(a.facts?.remote, "github.com/example/archipelago-next");
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
