import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ActionInvoke } from "../spec/action.ts";
import { Runtime, type Plugin } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import action from "../plugins/action/index.ts";
import graph from "../plugins/graph/index.ts";
import types from "../plugins/types/index.ts";
import history from "../plugins/history/index.ts";
import connect from "../plugins/connect/index.ts";
import { AWAY, FOLDER_STATE, HERE } from "../plugins/connect/folders.ts";
import connectWrite, { STATUS } from "../plugins/connect/write.ts";
import { MARK, NAME, wanted } from "../plugins/connect/here.ts";
import { snapshot } from "../scripts/maps.ts";

const HOOK = "http://127.0.0.1:5381/hook";
const MCP_URL = "http://127.0.0.1:5381/mcp";
const REPO = JSON.parse(await readFile(new URL("../plugins/claude-code/settings.json", import.meta.url), "utf8"));
const probe: Plugin = { id: "probe", inject: ["action.invoke"], apply() {} };
const wait = (ms = 200) => new Promise((r) => setTimeout(r, ms));
/**
 * Until `ok` holds, looking every 25 ms for up to 10 s: the writer works after
 * the change commits, and under a full suite's load that takes longer than any
 * fixed wait. Throws if it never holds; the assertions after say what is wrong.
 */
async function until(ok: () => boolean | Promise<boolean>, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  for (;;) {
    try {
      if (await ok()) return;
    } catch {}
    if (Date.now() > end) return;
    await wait(25);
  }
}

async function tree(dir: string, opts: { writes: boolean; folder?: string; data?: string; map?: string; maps?: string }) {
  const home = join(dir, "home");
  await mkdir(home, { recursive: true });
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const modules: Record<string, Plugin> = { graph, action, types, history, connect: connect as Plugin, "connect-write": connectWrite as Plugin, probe };
  const BASE = "mem:/plugins/";
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length)] }) });
  const data = opts.data ?? join(dir, "data");
  const named = { ...(opts.map ? { map: opts.map } : {}), maps: opts.maps ?? join(dir, "maps") };
  const config: Record<string, object> = {
    ...(opts.data ? { graph: { db: join(data, "graph.sqlite") } } : {}),
    connect: { hook: HOOK, mcp: MCP_URL, writes: opts.writes, home, ...named, ...(opts.folder ? { folder: opts.folder } : {}) },
    "connect-write": { hook: HOOK, mcp: MCP_URL, home, ledger: join(data, "connect.json"), ...named },
  };
  const entries: Entry[] = Object.keys(modules)
    .filter((id) => opts.writes || id !== "connect-write")
    .map((id) => ({ id, plugin: id, ...(config[id] ? { config: config[id] } : {}) }));
  await loader.apply(entries);
  await rt.settle();
  const invoke = (a: string, input: object, of: "human" | "agent" = "human") =>
    loader.fiber("probe")!.ctx.intercept({ actor: { id: of === "human" ? "e_me" : "e_agent", kind: of === "human" ? "person" : "agent" } }).get<ActionInvoke>("action.invoke").invoke({ action: a, input: input as never, authority: { of, basis: "test" }, reason: "test" });
  return { loader, errors, invoke };
}

test("wanted: the repository's hooks for this adapter, the hook script by its full path, and the server", () => {
  const w = wanted(REPO, { hook: HOOK, mcp: MCP_URL, command: "node \"/repo/plugins/claude-code/hook.ts\" " + HOOK });
  const hooks = w.settings.filter((e) => "at" in e && e.at[0] === "hooks");
  assert.equal(hooks.length, Object.keys(REPO.hooks).length, "a group per event");
  assert.ok(!JSON.stringify(w).includes("CLAUDE_PROJECT_DIR"), "no hook leans on the folder being this checkout");
  assert.ok(!JSON.stringify(w).includes(":5281/"), "every hook goes to this adapter");
  assert.deepEqual(w.mcp, [{ at: ["mcpServers"], key: NAME, value: { type: "http", url: MCP_URL } }]);
  assert.deepEqual(w.exclude.map((e) => ("line" in e ? e.line : "")), [MARK, ".mcp.json", ".claude/settings.local.json"]);
});

test("connect.here writes a folder's settings beside the person's and the context filter's; away, undo and unloading take out only ours", async () => {
  const dir = await mkdtemp(join(tmpdir(), "connect-here-"));
  const proj = join(dir, "proj");
  await mkdir(join(proj, ".claude"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: proj });
  const settings = join(proj, ".claude", "settings.local.json");
  const exclude = join(proj, ".git", "info", "exclude");
  // What the person has, and what lean's writer keeps in the same file.
  const theirs = { permissions: { deny: ["mcp__unused"] }, disabledMcpjsonServers: ["unused"], hooks: { Stop: [{ hooks: [{ type: "command", command: "mine" }] }] } };
  await writeFile(settings, JSON.stringify(theirs));
  const excludeBefore = await readFile(exclude, "utf8");
  const { loader, errors, invoke } = await tree(dir, { writes: true });
  const disk = async () => JSON.parse(await readFile(settings, "utf8"));
  const status = async () => ((await invoke(STATUS, {})) as unknown as { output: { folders: number; files: number } }).output;
  try {
    const on = await invoke(HERE, { folder: proj });
    assert.ok(on.ok, JSON.stringify(on));
    await until(async () => existsSync(join(proj, ".mcp.json")) && (await disk()).hooks.Stop.length === 2);
    const s = await disk();
    assert.equal(s.hooks.Stop.length, 2, "the person's Stop hook stays beside ours");
    assert.deepEqual(s.enabledMcpjsonServers, [NAME]);
    assert.deepEqual([s.permissions, s.disabledMcpjsonServers], [theirs.permissions, theirs.disabledMcpjsonServers], "lean's entries untouched");
    assert.equal(JSON.parse(await readFile(join(proj, ".mcp.json"), "utf8")).mcpServers[NAME].url, MCP_URL);
    assert.ok((await readFile(exclude, "utf8")).includes(MARK));
    const porcelain = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: proj, encoding: "utf8" });
    assert.ok(!porcelain.includes(".mcp.json") && !porcelain.includes("settings.local"), "git status stays clean");
    assert.deepEqual(await status(), { folders: 1, files: 3, elsewhere: 0 });
    assert.equal(((await invoke(FOLDER_STATE, { folder: proj })) as unknown as { output: { connected: boolean } }).output.connected, true);

    // Away: what it added goes, the rest stays as it was.
    assert.ok((await invoke(AWAY, { folder: proj })).ok);
    await until(() => !existsSync(join(proj, ".mcp.json")));
    assert.deepEqual(await disk(), theirs);
    assert.ok(!existsSync(join(proj, ".mcp.json")), "the file it made goes");
    assert.equal(await readFile(exclude, "utf8"), excludeBefore);

    // On again, then undo: history takes it back like any change.
    const again = await invoke(HERE, { folder: proj });
    assert.ok(again.ok && again.change, JSON.stringify(again));
    await until(() => existsSync(join(proj, ".mcp.json")));
    assert.ok(existsSync(join(proj, ".mcp.json")));
    assert.ok((await invoke("history.undo", { change: again.change })).ok);
    await until(() => !existsSync(join(proj, ".mcp.json")));
    assert.ok(!existsSync(join(proj, ".mcp.json")), "undone: taken out");

    // On, then the server stops: unloading takes it all out, so no folder keeps hooks to a server that isn't there.
    assert.ok((await invoke(HERE, { folder: proj }, "agent")).ok, "an agent may connect a folder too: the change says it was the agent");
    await until(() => existsSync(join(proj, ".mcp.json")));
    assert.ok(existsSync(join(proj, ".mcp.json")));
    await loader.apply([]);
    assert.deepEqual(await disk(), theirs);
    assert.ok(!existsSync(join(proj, ".mcp.json")));
    assert.deepEqual(errors, []);
  } finally {
    await loader.apply([]);
    await rm(dir, { recursive: true, force: true });
  }
});

test("connect.here is refused where the server writes no files, and for a folder that isn't safe", async () => {
  const dir = await mkdtemp(join(tmpdir(), "connect-here-"));
  const { loader, invoke } = await tree(dir, { writes: false });
  try {
    const dev = await invoke(HERE, { folder: dir });
    assert.ok(!dev.ok && dev.refused.code === "connect.no_write", JSON.stringify(dev));
    assert.match(dev.refused.message, /claude --settings/, "it names the way that writes nothing");
    assert.equal(((await invoke(FOLDER_STATE, { folder: dir })) as unknown as { output: { writes: boolean } }).output.writes, false);
  } finally {
    await loader.apply([]);
  }
  const w = await tree(dir, { writes: true });
  try {
    const home = await w.invoke(HERE, { folder: join(dir, "home") });
    assert.ok(!home.ok && home.refused.code === "connect.folder", "the home folder");
    const above = await w.invoke(HERE, { folder: dir });
    assert.ok(!above.ok && above.refused.code === "connect.folder", "a folder above it");
  } finally {
    await w.loader.apply([]);
    await rm(dir, { recursive: true, force: true });
  }
});

test("a map moved in from an older server's data takes its folders over; a map copied from it leaves them to it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "connect-takeover-"));
  const proj = join(dir, "proj");
  await mkdir(proj, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: proj });
  const settings = join(proj, ".claude", "settings.local.json");
  const mcp = join(proj, ".mcp.json");
  const maps = join(dir, "maps");
  const oldData = join(dir, "old-live", "app", ".data");
  const liveData = join(maps, "maps", "live");
  const forkData = join(maps, "maps", "claude-x");
  const text = async () => [await readFile(settings, "utf8"), await readFile(mcp, "utf8")].join("\n");
  const commands = (s: { hooks: Record<string, { hooks: { command?: string; url?: string }[] }[]> }) =>
    Object.values(s.hooks).flatMap((g) => g.flatMap((x) => x.hooks.map((h) => h.command ?? h.url ?? "")));

  // An older live, by port, connects the folder; then it is stopped hard: no unload, its entries stay.
  const old = await tree(dir, { writes: true, data: oldData, maps });
  assert.ok((await old.invoke(HERE, { folder: proj })).ok);
  await until(() => existsSync(settings) && existsSync(mcp));
  assert.ok(commands(JSON.parse(await readFile(settings, "utf8"))).every((c) => c.includes(HOOK)));
  snapshot(oldData, liveData, { takeover: true });

  // Map live, moved in from that data folder: its writer replaces the old entries with its own.
  const live = await tree(dir, { writes: true, data: liveData, map: "live", maps });
  const fork = { loader: undefined as undefined | Awaited<ReturnType<typeof tree>>["loader"] };
  try {
    await until(async () => {
      const t = await readFile(settings, "utf8");
      return t.includes("--map live") && !t.includes(HOOK);
    });
    const s = JSON.parse(await readFile(settings, "utf8"));
    const cmds = commands(s);
    assert.ok(cmds.length > 0);
    assert.ok(cmds.every((c) => c.includes("--map live") && !c.includes(HOOK)), `only live's hooks: ${cmds.join(" | ")}`);
    const server = JSON.parse(await readFile(mcp, "utf8")).mcpServers[NAME];
    assert.equal(server.type, "stdio");
    assert.equal(server.args[1], "live");
    assert.equal(server.url, undefined, "no port left");

    // A map copied from live brings its connection, on: it leaves the folder to live.
    const before = await text();
    snapshot(liveData, forkData);
    assert.ok(!existsSync(join(forkData, "connect.json")), "a copy brings no ledger");
    const f = await tree(dir, { writes: true, data: forkData, map: "claude-x", maps });
    fork.loader = f.loader;
    await wait();
    assert.equal(await text(), before, "the folder still reports to live alone");
    assert.deepEqual(((await f.invoke(STATUS, {})) as unknown as { output: object }).output, { folders: 0, files: 0, elsewhere: 1 });
    const state = (await f.invoke(FOLDER_STATE, { folder: proj })) as unknown as { output: { connected: boolean; reports_to?: string } };
    assert.deepEqual([state.output.connected, state.output.reports_to], [false, "live"]);
    const here = await f.invoke(HERE, { folder: proj });
    assert.ok(!here.ok && here.refused.code === "connect.elsewhere" && /reports to map live/.test(here.refused.message), JSON.stringify(here));
    await f.loader.apply([]);
    assert.equal(await text(), before, "and unloading takes nothing of live's");
    assert.deepEqual([...old.errors, ...live.errors, ...f.errors], []);
  } finally {
    await fork.loader?.apply([]);
    await live.loader.apply([]);
    await old.loader.apply([]);
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("a server that runs from another worktree (live) is told the checkout people work in: what it offers and connects by default", async () => {
  const dir = await mkdtemp(join(tmpdir(), "connect-checkout-"));
  const work = join(dir, "archipelago");
  await mkdir(work, { recursive: true });
  const t = await tree(dir, { writes: false, folder: work });
  try {
    const state = await t.invoke(FOLDER_STATE, {});
    assert.ok(state.ok, JSON.stringify(state));
    assert.equal((state.output as { folder: string }).folder, work, "the default folder is the one named, not the server's own");
    const setup = await t.invoke("connect.setup", {});
    assert.ok(setup.ok);
    assert.equal((setup.output as { folder?: string }).folder, work, "the empty map offers the checkout people work in");
    assert.deepEqual(t.errors, []);
  } finally {
    await t.loader.apply([]);
    await rm(dir, { recursive: true, force: true });
  }
});
