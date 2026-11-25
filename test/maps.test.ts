/**
 * Maps by name (issue #24): servers for different maps side by side on any
 * free port, one server per map, sessions that follow their map by name and
 * do nothing while it is down, and maps kept outside the checkout.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { claim, defaultMap, freePort, letPortGo, nameFrom, release, servers } from "../scripts/maps.ts";
import { adapterOf, entryOf, serverFile, type Served } from "../plugins/claude-code/registry.ts";
import { proxy } from "../plugins/claude-code/proxy.ts";
import { wanted } from "../plugins/connect/here.ts";
import { lineOf } from "../plugins/serving/view.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const home = mkdtempSync(join(tmpdir(), "archipelago-maps-"));
const started: { kill(): void }[] = [];
after(() => {
  for (const c of started) c.kill();
  // Windows lets a folder go a moment after the processes that held it.
  setTimeout(() => rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }), 500).unref();
});

const entry = (map: string, port: number, pid = process.pid): Served => ({ map, pid, port, checkout: "/home/me/code", data: join(home, "maps", map), started: new Date().toISOString() });
const put = (e: Served) => {
  mkdirSync(join(home, "servers"), { recursive: true });
  writeFileSync(serverFile(e.map, home), JSON.stringify(e));
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A fake adapter: answers /hook and /mcp, and records what it was sent. */
async function adapter(sessionId = "s1") {
  const seen: { path: string; body: any; session?: string }[] = [];
  const known = new Set<string>();
  const read = (req: IncomingMessage) => new Promise<string>((ok) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => ok(b));
  });
  const server: Server = createServer(async (req, res) => {
    const body = JSON.parse((await read(req)) || "{}");
    const session = req.headers["mcp-session-id"] as string | undefined;
    seen.push({ path: req.url!, body, ...(session ? { session } : {}) });
    if (req.url === "/hook") return res.end(JSON.stringify({ heard: sessionId }));
    if (session && !known.has(session)) {
      res.statusCode = 404;
      return res.end("{}");
    }
    if (body.method === "initialize") {
      known.add(sessionId);
      res.setHeader("mcp-session-id", sessionId);
      return res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "archipelago", version: "0" } } }));
    }
    if (body.id === undefined) {
      res.statusCode = 202;
      return res.end();
    }
    res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: `tool-of-${sessionId}` }] } }));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as { port: number }).port;
  return { seen, port, page: port - 1, close: () => new Promise<void>((ok) => {
    server.close(() => ok());
    server.closeAllConnections();
  }) };
}

/** Runs the hook script for a map, as a connected folder's hook would. */
function hook(map: string, input: object): Promise<{ out: string; code: number | null }> {
  return new Promise((ok) => {
    const child = spawn(process.execPath, [join(root, "plugins", "claude-code", "hook.ts"), "--map", map], {
      env: { ...process.env, ARCHIPELAGO_HOME: home, ARCHIPELAGO_TRANSCRIPT: "off", ARCHIPELAGO_TOKEN: "" },
      windowsHide: true,
    });
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.on("exit", (code) => ok({ out, code }));
    child.stdin.end(JSON.stringify(input));
  });
}

/** Starts app/server.ts for a map; resolves with its registry entry once its page answers, or its exit and output. */
function serveMap(map: string): Promise<{ served?: Served; code?: number | null; out: string }> {
  return new Promise((ok) => {
    let out = "";
    const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", join(root, "app", "server.ts"), "--map", map, "--no-watch", "--no-write"], {
      env: { ...process.env, ARCHIPELAGO_HOME: home, ARCHIPELAGO_PORT: "" },
      windowsHide: true,
    });
    started.push(child);
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (out += c));
    child.on("exit", (code) => ok({ code, out }));
    const poll = async () => {
      for (let i = 0; i < 120 && child.exitCode === null; i++) {
        const e = entryOf(map, home);
        if (e && e.pid === child.pid && e.port) {
          try {
            await fetch(`http://127.0.0.1:${e.port}/app/`, { signal: AbortSignal.timeout(1000) });
            return ok({ served: e, out });
          } catch {}
        }
        await wait(250);
      }
    };
    void poll();
  });
}

test("a map's name comes from anything, a branch included", () => {
  assert.equal(nameFrom("claude/maps-not-ports"), "claude-maps-not-ports");
  assert.equal(nameFrom("live"), "live");
  assert.equal(nameFrom("///"), undefined);
  assert.match(defaultMap(root), /^[a-z0-9][a-z0-9._-]*$/i);
});

test("two servers for different maps run at once, on free ports nobody gave them, with their maps outside the checkout", async () => {
  const [a, b] = await Promise.all([serveMap("alpha"), serveMap("beta")]);
  assert.ok(a.served, a.out);
  assert.ok(b.served, b.out);
  const pa = a.served.port!;
  const pb = b.served.port!;
  assert.ok(Math.abs(pa - pb) >= 3, `ports ${pa} and ${pb} overlap`);
  assert.notEqual(pa, 5180);
  assert.notEqual(pa, 5280);
  // Each map's data is in the home: deleting the checkout takes no map with it.
  for (const s of [a.served, b.served]) {
    assert.equal(s.data, join(home, "maps", s.map));
    assert.ok(existsSync(join(s.data, "graph.sqlite")));
    assert.ok(relative(root, s.data).startsWith(".."), `${s.data} is inside the checkout`);
    assert.equal(s.checkout, root);
  }
  assert.deepEqual(servers(home).filter((s) => s.running).map((s) => s.map).sort(), ["alpha", "beta"]);

  // A second server for the same map is refused, naming the one that runs.
  const again = await serveMap("alpha");
  assert.equal(again.code, 1);
  assert.match(again.out, new RegExp(`refused: map alpha is already served by pid ${a.served.pid} on http://127.0.0.1:${pa}/app/`));
  assert.equal(entryOf("alpha", home)?.pid, a.served.pid);
});

test("the registry refuses a second claim on a running map and takes over one whose process is gone", () => {
  const map = "claimed";
  const mine = { ...entry(map, 0), pid: process.pid };
  assert.deepEqual(claim(mine, home), { ok: true });
  const other = claim({ ...mine, pid: process.pid + 100000 }, home);
  assert.equal(other.ok, false);
  release(map, process.pid, home);
  put({ ...mine, pid: 999999 });
  assert.deepEqual(claim(mine, home), { ok: true });
  release(map, process.pid, home);
});

test("a free port is held, so servers starting at once never take the same one", async () => {
  const [a, b] = await Promise.all([freePort(home, 5400, process.pid), freePort(home, 5400, process.ppid)]);
  assert.notEqual(a, b);
  letPortGo(a, process.pid, home);
  letPortGo(b, process.ppid, home);
  // A hold whose process is gone is taken over.
  mkdirSync(join(home, "ports"), { recursive: true });
  writeFileSync(join(home, "ports", "5400"), "999999");
  assert.equal(await freePort(home, 5400), 5400);
  letPortGo(5400, process.pid, home);
});

test("a connected session's hook follows its map to a new port, and says nothing while it is down", async () => {
  const map = "moving";
  assert.deepEqual((await hook(map, { hook_event_name: "UserPromptSubmit", session_id: "x", cwd: home })), { out: "", code: 0 });
  const one = await adapter("one");
  put(entry(map, one.page));
  assert.match((await hook(map, { hook_event_name: "UserPromptSubmit", session_id: "x", cwd: home })).out, /"one"/);
  const two = await adapter("two");
  put(entry(map, two.page));
  assert.match((await hook(map, { hook_event_name: "UserPromptSubmit", session_id: "x", cwd: home })).out, /"two"/);
  assert.equal(one.seen.length, 1);
  assert.equal(two.seen.length, 1);
  // Its process gone: nothing, exit 0.
  put(entry(map, two.page, 999999));
  assert.deepEqual((await hook(map, { hook_event_name: "UserPromptSubmit", session_id: "x", cwd: home })), { out: "", code: 0 });
  await one.close();
  await two.close();
});

test("the MCP proxy follows its map to a new port, opening a new session there with the client's initialize", async () => {
  const map = "proxied";
  const one = await adapter("one");
  put(entry(map, one.page));
  const p = proxy({ map, home, send() {} });
  const init = await p.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "claude-code" } } });
  assert.deepEqual((init as any).result.capabilities.tools, { listChanged: true });
  await p.handle({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.deepEqual(((await p.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" })) as any).result.tools, [{ name: "tool-of-one" }]);
  assert.equal(one.seen.at(-1)?.session, "one");

  const two = await adapter("two");
  put(entry(map, two.page));
  assert.deepEqual(((await p.handle({ jsonrpc: "2.0", id: 3, method: "tools/list" })) as any).result.tools, [{ name: "tool-of-two" }]);
  assert.deepEqual(two.seen.map((s) => s.body.method), ["initialize", "notifications/initialized", "tools/list"]);
  assert.equal(two.seen[0]!.body.params.clientInfo.name, "claude-code");
  p.close();
  await one.close();
  await two.close();
});

test("the MCP proxy answers with no tools while its map is down, and says its tools changed when it starts", async () => {
  const map = "sleeping";
  const sent: any[] = [];
  const p = proxy({ map, home, poll: 20, send: (m) => sent.push(m) });
  const init = (await p.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })) as any;
  assert.match(init.result.instructions, /isn't running/);
  assert.deepEqual(((await p.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" })) as any).result.tools, []);
  assert.match(((await p.handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "x" } })) as any).error.message, /isn't running/);
  assert.equal(adapterOf(map, home), undefined);
  const up = await adapter("up");
  put(entry(map, up.page));
  for (let i = 0; i < 50 && !sent.length; i++) await wait(20);
  assert.deepEqual(sent, [{ jsonrpc: "2.0", method: "notifications/tools/list_changed" }]);
  assert.deepEqual(((await p.handle({ jsonrpc: "2.0", id: 4, method: "tools/list" })) as any).result.tools, [{ name: "tool-of-up" }]);
  p.close();
  await up.close();
});

test("a folder connected to a map by name holds the map's name, never a port", () => {
  const repo = { hooks: { SessionStart: [{ hooks: [{ type: "command", command: "x" }] }], PreToolUse: [{ matcher: "*", hooks: [{ type: "http", url: "x" }] }] } };
  const w = wanted(repo, { hook: "http://127.0.0.1:5301/hook", mcp: "http://127.0.0.1:5301/mcp", command: 'node "/home/me/code/plugins/claude-code/hook.ts" --map live', byMap: { map: "live", proxy: "/home/me/code/plugins/claude-code/proxy.ts" } });
  const text = JSON.stringify(w);
  assert.doesNotMatch(text, /5301/);
  assert.ok(w.settings.filter((e) => "at" in e && e.at[0] === "hooks").every((e) => JSON.stringify(e).includes('"type":"command"')));
  assert.deepEqual(w.mcp[0], { at: ["mcpServers"], key: "archipelago", value: { type: "stdio", command: "node", args: ["/home/me/code/plugins/claude-code/proxy.ts", "live"] } });
  // Without a map, as before: the adapter's address.
  assert.match(JSON.stringify(wanted(repo, { hook: "http://127.0.0.1:5181/hook", mcp: "http://127.0.0.1:5181/mcp", command: "c" }).mcp), /5181/);
});

test("the header says map, commit and checkout", () => {
  assert.deepEqual(lineOf({ map: "live", commit: "abc1234", checkout: "/home/me/code/archipelago", port: 5300 }), {
    text: "live · abc1234 · archipelago",
    title: "Map live on port 5300\nCommit abc1234\nCode from /home/me/code/archipelago",
  });
  assert.equal(lineOf({ commit: "abc1234+", port: 5180 })?.text, ":5180 · abc1234+");
  assert.match(lineOf({ commit: "abc1234+", port: 5180 })!.title, /changes not committed/);
  assert.equal(lineOf({ map: "dev", checkout: "C:\\Users\\me\\code\\archipelago\\" })?.text, "dev · archipelago");
  assert.equal(lineOf({}), undefined);
});
