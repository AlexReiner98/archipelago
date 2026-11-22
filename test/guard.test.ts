/**
 * The local servers refuse what a web page could send them: a Host that is
 * not theirs (DNS rebinding), an Origin that is not the app's (a cross-site
 * post). What the harness sends, with no Origin, still goes through.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader } from "../runtime/loader.ts";
import { serve } from "../runtime/serve.ts";
import claudeCode from "../packs/claude-code/index.ts";
import bridge, { KEYS } from "../packs/bridge/server.ts";
import { serverTree } from "../app/tree.ts";

const PAGE = "http://localhost:5999";
const HOSTED = "https://map.example.test";

/** A request with exactly these headers (fetch would set Host itself). */
function call(port: number, path: string, headers: Record<string, string>, method = "GET", body?: string): Promise<{ status: number; body: string }> {
  return new Promise((ok, fail) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => ok({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", fail);
    req.end(body);
  });
}

/** Every case each server must answer the same way. */
async function cases(port: number, path: string, method = "GET", body?: string) {
  const at = (headers: Record<string, string>) => call(port, path, headers, method, body).then((r) => r.status);
  // Refused.
  assert.equal(await at({ host: `rebound.example:${port}` }), 403, "a rebound name");
  assert.equal(await at({ host: `127.0.0.1:${port + 1}` }), 403, "another port");
  assert.equal(await at({ origin: "https://evil.example" }), 403, "a foreign origin");
  assert.equal(await at({ origin: "null" }), 403, "an opaque origin");
  assert.equal(await at({ origin: `http://127.0.0.1:${port}.evil.example` }), 403, "a look-alike origin");
  // Answered.
  assert.notEqual(await at({}), 403, "no origin: the harness, curl");
  assert.notEqual(await at({ host: `localhost:${port}` }), 403, "localhost");
  assert.notEqual(await at({ host: `LOCALHOST:${port}` }), 403, "a host is not case sensitive");
  assert.notEqual(await at({ origin: `http://127.0.0.1:${port}` }), 403, "its own origin");
  assert.notEqual(await at({ origin: PAGE }), 403, "the app's page");
  assert.notEqual(await at({ origin: HOSTED }), 403, "a configured origin");
  assert.notEqual(await at({ host: "map.example.test" }), 403, "a configured host");
}

const access = { origins: [PAGE, HOSTED], hosts: ["map.example.test"] };

test("the page server refuses a foreign Host or Origin, and serves the rest", async () => {
  const root = mkdtempSync(join(tmpdir(), "guard-"));
  writeFileSync(join(root, "index.html"), "<p>hi</p>");
  const page = await serve({ root, watch: false, ...access });
  after(() => page.close().then(() => rmSync(root, { recursive: true, force: true })));
  const port = Number(new URL(page.url).port);
  await cases(port, "/index.html");
  const r = await call(port, "/index.html", { origin: "https://evil.example" });
  assert.match(r.body, /origin https:\/\/evil\.example is not allowed/);
  assert.equal((await call(port, "/index.html", {})).body, "<p>hi</p>");
});

/** Loads one pack over stand-ins for every key it injects. */
async function load(pack: Pack, keys: readonly string[], config: Record<string, unknown>) {
  const stub: Pack = {
    id: "stub",
    apply(ctx) {
      for (const k of keys) ctx.provide(k, () => ({}));
    },
  };
  let port = 0;
  const rt = new Runtime();
  const loader = new Loader(rt, { base: "mem:/", import: async (url) => ({ default: url.endsWith("stub.ts") ? stub : pack }) });
  await loader.apply([
    { id: "stub", pack: "stub.ts" },
    { id: pack.id, pack: "pack.ts", config: { ...config, port: 0, onListen: (p: number) => (port = p) } },
  ]);
  assert.ok(port > 0, `${pack.id} listens`);
  return { port, close: () => loader.apply([]) };
}

test("the adapter's /hook, /mcp and /health refuse a foreign Host or Origin; Claude Code's own requests go through", async () => {
  const { port, close } = await load(claudeCode, ["agent.run", "agent.tree", "action.invoke", "action.list", "exchange.read"], access);
  try {
    await cases(port, "/health");
    // A cross-site simple POST (text/plain, no preflight) is refused before its body is read.
    await cases(port, "/hook", "POST", "{}");
    await cases(port, "/mcp", "POST", JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }));
    // With no Origin, a hook is read: this one is told what it lacks.
    const hook = await call(port, "/hook", { "content-type": "application/json" }, "POST", "{}");
    assert.equal(hook.status, 400);
  } finally {
    await close();
  }
});

test("the bridge refuses a foreign Host or Origin, and answers its page with CORS", async () => {
  const { port, close } = await load(bridge, KEYS, access);
  try {
    await cases(port, "/caps");
    await cases(port, "/call", "POST", JSON.stringify({ key: "agent.tree", method: "nodes" }));
    await new Promise<void>((ok, fail) => {
      const req = request({ host: "127.0.0.1", port, path: "/caps", headers: { host: `127.0.0.1:${port}`, origin: PAGE } }, (res) => {
        assert.equal(res.headers["access-control-allow-origin"], PAGE);
        res.resume().on("end", ok);
      });
      req.on("error", fail).end();
    });
  } finally {
    await close();
  }
});

test("the server tree gives the adapter and the bridge the page's origin and the host's", () => {
  const tree = serverTree({ data: "d", port: 5180, write: false, origins: [HOSTED], hosts: ["map.example.test"] });
  for (const id of ["claude-code", "bridge"]) {
    const config = tree.find((e) => e.id === id)!.config as { origins: string[]; hosts: string[] };
    assert.deepEqual(config.origins, ["http://127.0.0.1:5180", "http://localhost:5180", HOSTED], id);
    assert.deepEqual(config.hosts, ["map.example.test"], id);
  }
});
