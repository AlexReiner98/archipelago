import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, request, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ActionInvoke } from "../spec/action.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader } from "../runtime/loader.ts";
import action from "../packs/action/index.ts";
import graph from "../packs/graph/index.ts";
import gateway, { issuerOf } from "../packs/gateway/index.ts";
import { checkPassphrase, GatewayStore, hashPassphrase } from "../packs/gateway/store.ts";

const ISSUER = "https://map.example.net";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const PASS = "correct horse battery staple";
const VERIFIER = "v".repeat(20) + "-verifier-that-is-long-enough_123";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

/** A stand-in for the adapter: it records what reached it and answers like it. */
async function upstream() {
  const seen: { method: string; headers: IncomingHttpHeaders; body: string }[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      seen.push({ method: req.method!, headers: req.headers, body: Buffer.concat(chunks).toString() });
      if (req.method === "DELETE") return res.writeHead(204).end();
      res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "s-1", "set-cookie": "x=1" }).end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as { port: number }).port;
  return { seen, port, close: () => new Promise<void>((ok) => server.close(() => ok())) };
}

async function boot(opts: { passphrase?: boolean; issuer?: string; maxFailures?: number } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "gateway-"));
  const db = join(dir, "gateway.sqlite");
  if (opts.passphrase !== false) {
    const s = new GatewayStore(db);
    s.setPassphrase(hashPassphrase(PASS));
    s.close();
  }
  const up = await upstream();
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const logs: string[] = [];
  let port = 0;
  const modules: Record<string, Pack> = { graph, action, gateway: gateway as Pack };
  const loader = new Loader(rt, { base: "mem:/", import: async (url) => ({ default: modules[url.slice(5)]! }) });
  await loader.apply([
    { id: "graph", pack: "graph" },
    { id: "action", pack: "action" },
    {
      id: "gateway",
      pack: "gateway",
      config: {
        issuer: "issuer" in opts ? opts.issuer : ISSUER,
        port: 0,
        db,
        upstream: `http://127.0.0.1:${up.port}/mcp`,
        maxFailures: opts.maxFailures ?? 5,
        onListen: (p: number) => (port = p),
        log: (l: string) => logs.push(l),
      },
    },
  ]);
  await rt.settle();
  const base = `http://127.0.0.1:${port}`;
  const invoke = rt.root.get<ActionInvoke>("action.invoke");
  return {
    base,
    port,
    up,
    logs,
    errors,
    invoke: (name: string, input: object) => invoke.invoke({ action: name, input: input as never, authority: { of: "human" }, reason: "test" }),
    async close() {
      await loader.apply([]);
      await up.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

const form = (o: Record<string, string>) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o).toString() });

async function registerClient(base: string, redirect = CALLBACK) {
  const r = await fetch(`${base}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Claude", redirect_uris: [redirect] }) });
  return { status: r.status, body: (await r.json()) as { client_id: string; token_endpoint_auth_method: string; error?: string } };
}

/** The authorize page's request id, from GET /authorize with these params. */
async function authorizePage(base: string, params: Record<string, string>) {
  const r = await fetch(`${base}/authorize?${new URLSearchParams(params)}`, { redirect: "manual" });
  const html = await r.text();
  return { status: r.status, location: r.headers.get("location"), csp: r.headers.get("content-security-policy"), request: /name="request" value="([^"]+)"/.exec(html)?.[1], html };
}

const authParams = (client: string, extra: Record<string, string> = {}) => ({
  response_type: "code",
  client_id: client,
  redirect_uri: CALLBACK,
  code_challenge: CHALLENGE,
  code_challenge_method: "S256",
  state: "st8",
  resource: `${ISSUER}/mcp`,
  scope: "mcp offline_access",
  ...extra,
});

async function signIn(base: string, request: string, passphrase = PASS) {
  const r = await fetch(`${base}/authorize`, { ...form({ request, passphrase }), redirect: "manual" });
  return { status: r.status, location: r.headers.get("location"), html: await r.text() };
}

/** Registration through tokens: what Claude does when the owner connects. */
async function connect(base: string) {
  const { body: c } = await registerClient(base);
  const page = await authorizePage(base, authParams(c.client_id));
  const back = new URL((await signIn(base, page.request!)).location!);
  const code = back.searchParams.get("code")!;
  const r = await fetch(`${base}/token`, form({ grant_type: "authorization_code", client_id: c.client_id, code, redirect_uri: CALLBACK, code_verifier: VERIFIER, resource: `${ISSUER}/mcp` }));
  return { client: c.client_id, code, status: r.status, tokens: (await r.json()) as { access_token: string; refresh_token: string; expires_in: number; token_type: string } };
}

test("issuer: https origins only (http on loopback for tests)", () => {
  assert.equal(issuerOf("https://map.example.net/"), "https://map.example.net");
  assert.throws(() => issuerOf("http://map.example.net"));
  assert.throws(() => issuerOf("https://map.example.net/path"));
  assert.equal(issuerOf("http://127.0.0.1:9"), "http://127.0.0.1:9");
});

test("the passphrase: kept as an scrypt hash, checked", async () => {
  const h = hashPassphrase(PASS);
  assert.ok(!JSON.stringify(h).includes(PASS));
  assert.equal(await checkPassphrase(PASS, h), true);
  assert.equal(await checkPassphrase(PASS + "x", h), false);
});

test("off without a passphrase or an issuer: nothing listens, and it says why", async () => {
  const a = await boot({ passphrase: false });
  try {
    assert.equal(a.port, 0);
    assert.match(a.logs.join("\n"), /no passphrase/);
  } finally {
    await a.close();
  }
  const b = await boot({ issuer: undefined });
  try {
    assert.equal(b.port, 0);
    assert.match(b.logs.join("\n"), /no issuer/);
  } finally {
    await b.close();
  }
});

test("metadata, the 401 challenge, and another Host refused", async () => {
  const g = await boot();
  try {
    const prm = await (await fetch(`${g.base}/.well-known/oauth-protected-resource`)).json();
    assert.deepEqual(prm.resource, `${ISSUER}/mcp`);
    assert.deepEqual(prm.authorization_servers, [ISSUER]);
    assert.deepEqual(await (await fetch(`${g.base}/.well-known/oauth-protected-resource/mcp`)).json(), prm);
    const asm = await (await fetch(`${g.base}/.well-known/oauth-authorization-server`)).json();
    assert.equal(asm.issuer, ISSUER);
    assert.equal(asm.token_endpoint, `${ISSUER}/token`);
    assert.equal(asm.registration_endpoint, `${ISSUER}/register`);
    assert.deepEqual(asm.code_challenge_methods_supported, ["S256"]);
    assert.deepEqual(asm.token_endpoint_auth_methods_supported, ["none"]);
    assert.ok(asm.scopes_supported.includes("offline_access"));

    const r = await fetch(`${g.base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(r.status, 401);
    assert.equal(r.headers.get("www-authenticate"), `Bearer resource_metadata="${ISSUER}/.well-known/oauth-protected-resource"`);
    const bad = await fetch(`${g.base}/mcp`, { method: "POST", headers: { authorization: "Bearer " + "x".repeat(43) }, body: "{}" });
    assert.equal(bad.status, 401);
    assert.match(bad.headers.get("www-authenticate")!, /error="invalid_token"/);
    assert.equal(g.up.seen.length, 0);

    // DNS rebinding: a name that isn't the issuer's or loopback.
    const status = await new Promise<number>((ok) => request({ host: "127.0.0.1", port: g.port, path: "/.well-known/oauth-authorization-server", headers: { host: "evil.example" } }, (res) => ok(res.statusCode!)).end());
    assert.equal(status, 403);
    const named = await new Promise<number>((ok) => request({ host: "127.0.0.1", port: g.port, path: "/.well-known/oauth-authorization-server", headers: { host: "map.example.net" } }, (res) => ok(res.statusCode!)).end());
    assert.equal(named, 200);
  } finally {
    await g.close();
  }
});

test("registration: only the allowed redirects, as a public client", async () => {
  const g = await boot();
  try {
    const ok = await registerClient(g.base);
    assert.equal(ok.status, 201);
    assert.match(ok.body.client_id, /^c_/);
    assert.equal(ok.body.token_endpoint_auth_method, "none");
    assert.equal((await registerClient(g.base, "https://claude.com/api/mcp/auth_callback")).status, 201);
    for (const evil of ["https://evil.example/cb", "https://claude.ai/api/mcp/auth_callback/../x", "http://localhost:3118/callback"]) {
      const r = await registerClient(g.base, evil);
      assert.equal(r.status, 400, evil);
      assert.equal(r.body.error, "invalid_redirect_uri");
    }
    // A registered client still can't be sent to a redirect it didn't register.
    const page = await authorizePage(g.base, authParams(ok.body.client_id, { redirect_uri: "https://evil.example/cb" }));
    assert.equal(page.status, 400);
    assert.equal(page.location, null);
  } finally {
    await g.close();
  }
});

test("PKCE: S256 required at authorize, the verifier checked at token, a code used once", async () => {
  const g = await boot();
  try {
    const { body: c } = await registerClient(g.base);
    for (const extra of [{ code_challenge: "" }, { code_challenge_method: "plain" }] as Record<string, string>[]) {
      const p = await authorizePage(g.base, authParams(c.client_id, extra));
      assert.equal(p.status, 302);
      const back = new URL(p.location!);
      assert.equal(back.origin + back.pathname, CALLBACK);
      assert.equal(back.searchParams.get("error"), "invalid_request");
      assert.equal(back.searchParams.get("state"), "st8");
    }
    const page = await authorizePage(g.base, authParams(c.client_id));
    assert.equal(page.status, 200);
    assert.match(page.html, /claude\.ai/);
    assert.match(page.csp!, /frame-ancestors 'none'/);
    const signed = await signIn(g.base, page.request!);
    assert.equal(signed.status, 302);
    const back = new URL(signed.location!);
    assert.equal(back.searchParams.get("state"), "st8");
    assert.equal(back.searchParams.get("iss"), ISSUER);
    const code = back.searchParams.get("code")!;

    const exchange = (verifier: string) => fetch(`${g.base}/token`, form({ grant_type: "authorization_code", client_id: c.client_id, code, redirect_uri: CALLBACK, code_verifier: verifier }));
    // A wrong verifier spends the code.
    const wrong = await exchange("w".repeat(43));
    assert.equal(wrong.status, 400);
    assert.equal((await wrong.json()).error, "invalid_grant");
    assert.equal((await (await exchange(VERIFIER)).json()).error, "invalid_grant");

    // A fresh code with the right verifier: tokens, once.
    const p2 = await authorizePage(g.base, authParams(c.client_id));
    const code2 = new URL((await signIn(g.base, p2.request!)).location!).searchParams.get("code")!;
    const t = await fetch(`${g.base}/token`, form({ grant_type: "authorization_code", client_id: c.client_id, code: code2, redirect_uri: CALLBACK, code_verifier: VERIFIER }));
    assert.equal(t.status, 200);
    assert.equal(t.headers.get("cache-control"), "no-store");
    const tokens = await t.json();
    assert.equal(tokens.token_type, "Bearer");
    assert.equal(tokens.expires_in, 3600);
    const again = await fetch(`${g.base}/token`, form({ grant_type: "authorization_code", client_id: c.client_id, code: code2, redirect_uri: CALLBACK, code_verifier: VERIFIER }));
    assert.equal((await again.json()).error, "invalid_grant");
    // The code used twice revoked what it became.
    const r = await fetch(`${g.base}/mcp`, { method: "POST", headers: { authorization: `Bearer ${tokens.access_token}` }, body: "{}" });
    assert.equal(r.status, 401);
  } finally {
    await g.close();
  }
});

test("a wrong passphrase, then the lockout; a cross-site post refused", async () => {
  const g = await boot({ maxFailures: 3 });
  try {
    const { body: c } = await registerClient(g.base);
    const page = await authorizePage(g.base, authParams(c.client_id));
    const wrong = await signIn(g.base, page.request!, "not it");
    assert.equal(wrong.status, 401);
    assert.match(wrong.html, /Wrong passphrase/);
    assert.equal(wrong.location, null);

    const forged = await fetch(`${g.base}/authorize`, { ...form({ request: page.request!, passphrase: PASS }), headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" }, redirect: "manual" });
    assert.equal(forged.status, 403);
    assert.equal((await signIn(g.base, "made-up", PASS)).status, 400);

    await signIn(g.base, page.request!, "still not");
    const p2 = await authorizePage(g.base, authParams(c.client_id));
    await signIn(g.base, p2.request!, "third wrong");
    // Locked: even the right passphrase is refused now.
    const p3 = await authorizePage(g.base, authParams(c.client_id));
    const locked = await signIn(g.base, p3.request!, PASS);
    assert.equal(locked.status, 429);
    assert.equal(locked.location, null);
  } finally {
    await g.close();
  }
});

test("refresh tokens rotate; a spent one used again revokes the grant", async () => {
  const g = await boot();
  try {
    const { client, tokens } = await connect(g.base);
    const refresh = (t: string) => fetch(`${g.base}/token`, form({ grant_type: "refresh_token", client_id: client, refresh_token: t }));
    const r1 = await refresh(tokens.refresh_token);
    assert.equal(r1.status, 200);
    const t1 = await r1.json();
    assert.notEqual(t1.refresh_token, tokens.refresh_token);
    assert.notEqual(t1.access_token, tokens.access_token);
    const reused = await refresh(tokens.refresh_token);
    assert.equal(reused.status, 400);
    assert.equal((await reused.json()).error, "invalid_grant");
    // Theft assumed: the new pair goes too.
    assert.equal((await refresh(t1.refresh_token)).status, 400);
    const r = await fetch(`${g.base}/mcp`, { method: "POST", headers: { authorization: `Bearer ${t1.access_token}` }, body: "{}" });
    assert.equal(r.status, 401);
  } finally {
    await g.close();
  }
});

test("the proxy: the adapter's own Host, no Authorization, the session passed both ways; revoked refused", async () => {
  const g = await boot();
  try {
    const { client, tokens } = await connect(g.base);
    const auth = { authorization: `Bearer ${tokens.access_token}` };
    const r = await fetch(`${g.base}/mcp`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-session-id": "s-1", "mcp-protocol-version": "2025-06-18", cookie: "a=b", "cf-connecting-ip": "1.2.3.4" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("mcp-session-id"), "s-1");
    assert.equal(r.headers.get("set-cookie"), null);
    assert.deepEqual(await r.json(), { jsonrpc: "2.0", id: 1, result: { ok: true } });
    const seen = g.up.seen[0]!;
    assert.equal(seen.method, "POST");
    assert.equal(seen.headers.host, `127.0.0.1:${g.up.port}`);
    assert.equal(seen.headers.authorization, undefined);
    assert.equal(seen.headers.cookie, undefined);
    assert.equal(seen.headers["cf-connecting-ip"], undefined);
    assert.equal(seen.headers.origin, undefined);
    assert.equal(seen.headers["mcp-session-id"], "s-1");
    assert.equal(seen.headers["mcp-protocol-version"], "2025-06-18");
    assert.equal(seen.body, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    const del = await fetch(`${g.base}/mcp`, { method: "DELETE", headers: { ...auth, "mcp-session-id": "s-1" } });
    assert.equal(del.status, 204);
    assert.equal(g.up.seen[1]!.method, "DELETE");

    // The grants, listed without secrets; revoked through the action, refused after.
    const listed = await g.invoke("gateway.grants", {});
    assert.ok(listed.ok);
    const items = (listed.output as { items: { grant: string; client: string; redirect: string; revoked: null }[] }).items;
    assert.equal(items.length, 1);
    assert.equal(items[0]!.client, "Claude");
    assert.equal(items[0]!.redirect, "claude.ai");
    assert.ok(!JSON.stringify(listed.output).includes(tokens.access_token));
    assert.ok(!JSON.stringify(listed.output).includes(tokens.refresh_token));
    assert.equal((await g.invoke("gateway.revoke", {})).ok, false);
    const revoked = await g.invoke("gateway.revoke", { grant: items[0]!.grant });
    assert.deepEqual(revoked.ok && revoked.output, { revoked: 1 });
    const after = await fetch(`${g.base}/mcp`, { method: "POST", headers: auth, body: "{}" });
    assert.equal(after.status, 401);
    const refresh = await fetch(`${g.base}/token`, form({ grant_type: "refresh_token", client_id: client, refresh_token: tokens.refresh_token }));
    assert.equal(refresh.status, 400);
    assert.equal((await refresh.json()).error, "invalid_grant");
    assert.equal(g.up.seen.length, 2);
    assert.deepEqual(g.errors, []);
  } finally {
    await g.close();
  }
});
