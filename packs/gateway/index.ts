/**
 * The gateway: the adapter's MCP server for one owner's Claude apps away
 * from the machine (claude.ai, the phone app), behind a TLS tunnel at a
 * public name. It is an OAuth 2.1 authorization server and protected
 * resource, and passes what a signed-in client sends to `/mcp` on to the
 * adapter over loopback, as a local client would. The adapter is not
 * changed: it still answers only its own Host, with no sign-in.
 *
 * - `GET /.well-known/oauth-protected-resource[/mcp]` (RFC 9728) and
 *   `GET /.well-known/oauth-authorization-server` (RFC 8414).
 * - `POST /register` (RFC 7591): public clients whose redirect URIs are all
 *   in `config.redirects` (Claude's callbacks by default).
 * - `GET /authorize`: PKCE S256 required; a page where the owner gives the
 *   passphrase. `POST /authorize` checks it (scrypt, constant time, one at a
 *   time, a lockout after failures) and redirects with a one-time code.
 * - `POST /token`: `authorization_code` (the verifier checked) and
 *   `refresh_token` (rotated: a spent one used again revokes the grant).
 * - `/mcp` with a Bearer access token: POST, GET and DELETE go to
 *   `config.upstream` with the upstream's own Host, no Authorization, and
 *   only the MCP headers, streamed both ways. Without one: 401 and
 *   `WWW-Authenticate: Bearer resource_metadata=...`.
 *
 * Listens on 127.0.0.1 only, and only when `config.issuer` is set and a
 * passphrase is (`npm run gateway:passphrase`): otherwise it says why and
 * serves nothing. Actions `gateway.grants` (no secrets) and `gateway.revoke`.
 */
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createServer, request, type IncomingMessage, type OutgoingHttpHeaders, type ServerResponse } from "node:http";
import { dirname } from "node:path";
import type { ActionRegister } from "../../spec/action.ts";
import { Refused, type Json } from "../../spec/common.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { checkPassphrase, GatewayStore } from "./store.ts";

/** Where the hosted Claude apps (web, desktop, phone) send the owner back. */
export const CLAUDE_REDIRECTS = ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"];
export const SCOPES = ["mcp", "offline_access"];

export interface GatewayConfig {
  /** The public base URL the tunnel serves, as `https://name` (no path). Unset: the gateway is off. */
  issuer?: string;
  /** The port on 127.0.0.1. 0 picks a free one. Default 5183. */
  port?: number;
  /** The adapter's MCP endpoint, on loopback. Default `http://127.0.0.1:5181/mcp`. */
  upstream?: string;
  /** The database: clients, grants, token hashes, the passphrase's hash. Default in memory. */
  db?: string;
  /** Redirect URIs a client may register, matched exactly. Default Claude's callbacks. */
  redirects?: string[];
  /** Seconds an access token lives. Default 3600. */
  accessTtl?: number;
  /** Seconds a refresh token lives. Default 30 days. */
  refreshTtl?: number;
  /** Failed sign-ins before the lockout. Default 5. */
  maxFailures?: number;
  /** Seconds a lockout lasts. Default 900. */
  lockout?: number;
  /** Told the port once listening. */
  onListen?: (port: number) => void;
  /** Told why the gateway is not serving. Default console.warn. */
  log?: (line: string) => void;
}

const CODE_TTL = 60_000;
const PENDING_TTL = 10 * 60_000;
const PENDING_MAX = 50;
const CLIENTS_MAX = 50;
const CLIENT_STALE = 24 * 3600_000;
const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

const loopback = (host: string) => host === "127.0.0.1" || host === "localhost" || host === "[::1]";

/** The issuer as an origin, or why it can't be one: https, or http on loopback (tests), with no path. */
export function issuerOf(raw: string): string {
  const u = new URL(raw);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && loopback(u.hostname))) throw new Error(`gateway: issuer ${raw} must be https`);
  if (u.pathname !== "/" || u.search || u.hash || u.username || u.password) throw new Error(`gateway: issuer ${raw} must be an origin, with no path`);
  return u.origin;
}

const b64url = (b: Buffer) => b.toString("base64url");
const s256 = (verifier: string) => b64url(createHash("sha256").update(verifier).digest());
const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function body(req: IncomingMessage, max: number): Promise<string> {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > max) {
        fail(new Error("body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
    req.on("error", fail);
  });
}

const json = (res: ServerResponse, status: number, value: unknown, headers: OutgoingHttpHeaders = {}) =>
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers }).end(JSON.stringify(value));
const oauthError = (res: ServerResponse, status: number, error: string, description: string) => json(res, status, { error, error_description: description });

/** A request at /authorize, held between the page and the owner's answer. Its id is the form's only key. */
interface Pending {
  client: string;
  name: string;
  redirect: string;
  state?: string;
  challenge: string;
  scope: string;
  expires: number;
  tries: number;
}

/** The request headers that go on to the adapter. Everything else (Authorization, Cookie, Origin, the tunnel's) stays here. */
const FORWARD = ["content-type", "content-length", "accept", "mcp-session-id", "mcp-protocol-version", "last-event-id"];
/** The adapter's answer headers that come back. */
const BACK = ["content-type", "content-length", "cache-control", "mcp-session-id", "mcp-protocol-version"];

const gateway: Pack<GatewayConfig> = {
  id: "gateway",
  about: "Lets the owner's Claude apps reach the map's MCP server from anywhere, signed in with OAuth.",
  inject: ["action.register"],
  async apply(ctx: Context, config: GatewayConfig = {}) {
    const log = config.log ?? ((l: string) => console.warn(l));
    if (config.db) await mkdir(dirname(config.db), { recursive: true });
    const store = new GatewayStore(config.db);
    ctx.effect(() => () => store.close());
    const now = () => Date.now();

    const actions = ctx.get<ActionRegister>("action.register");
    const day = (ms?: number) => (ms ? new Date(ms).toISOString() : undefined);
    actions.register({
      name: "gateway.grants",
      title: "List who is signed in through the gateway",
      doc: "Each grant the owner gave a client: its client and redirect, when made, last used, until when it can refresh, and whether revoked. No token or secret.",
      input: { type: "object", properties: { limit: { type: "number" }, after: { type: "string" } } },
      async run(input: { limit?: number; after?: string }) {
        const limit = Math.max(1, Math.min(LIMIT_MAX, Math.floor(input.limit ?? 50)));
        const page = store.grants(limit, input.after);
        const items = page.items.map((g) => {
          const c = store.client(g.client);
          return {
            grant: g.id,
            client: c?.name ?? g.client,
            redirect: c?.redirects[0] ? new URL(c.redirects[0]).host : null,
            scope: g.scope,
            created: day(g.created)!,
            used: day(g.used)!,
            until: day(g.until) ?? null,
            revoked: day(g.revoked) ?? null,
          };
        });
        return { items, ...(page.next ? { next: page.next } : {}) } as Json;
      },
    });
    actions.register({
      name: "gateway.revoke",
      title: "Revoke a gateway grant, or all of them",
      doc: "Its tokens stop working at once; the client must sign in again with the passphrase. Not undone: sign in again instead.",
      input: { type: "object", properties: { grant: { type: "string" }, all: { type: "boolean" } } },
      async run(input: { grant?: string; all?: boolean }) {
        if (!input.grant && input.all !== true) {
          throw new Refused({ code: "gateway.revoke_what", message: "Name a grant (gateway.grants lists them), or all: true.", by: { pack: "gateway" } });
        }
        return { revoked: store.revoke(input.all === true ? undefined : input.grant, now()) };
      },
    });

    if (!config.issuer) return log("gateway: off, no issuer (the tunnel's public https URL) is set");
    const issuer = issuerOf(config.issuer);
    if (!store.passphrase()) return log("gateway: off, no passphrase is set: run npm run gateway:passphrase, then restart");
    const upstream = new URL(config.upstream ?? "http://127.0.0.1:5181/mcp");
    if (upstream.protocol !== "http:" || !loopback(upstream.hostname)) throw new Error(`gateway: upstream ${upstream.href} must be http on loopback`);
    const resource = `${issuer}/mcp`;
    const prmUrl = `${issuer}/.well-known/oauth-protected-resource`;
    const allowed = new Set(config.redirects ?? CLAUDE_REDIRECTS);
    const accessTtl = (config.accessTtl ?? 3600) * 1000;
    const refreshTtl = (config.refreshTtl ?? 30 * 24 * 3600) * 1000;
    const maxFailures = config.maxFailures ?? 5;
    const lockout = (config.lockout ?? 900) * 1000;
    const pending = new Map<string, Pending>();

    const prm = { resource, authorization_servers: [issuer], scopes_supported: ["mcp"], bearer_methods_supported: ["header"], resource_name: "Archipelago" };
    const asm = {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      registration_endpoint: `${issuer}/register`,
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: SCOPES,
      authorization_response_iss_parameter_supported: true,
    };
    /** A resource parameter, when given, names this server's /mcp. */
    const resourceOk = (r: string | null | undefined) => !r || r.replace(/\/+$/, "") === resource;
    const scopeOf = (asked: string | null | undefined) => {
      const s = (asked ?? "").split(" ").filter((x) => SCOPES.includes(x));
      return [...new Set(["mcp", ...s])].join(" ");
    };

    const hostOk = (req: IncomingMessage) => {
      const host = (req.headers.host ?? "").toLowerCase();
      const port = req.socket.localPort;
      return host === new URL(issuer).host || host === `127.0.0.1:${port}` || host === `localhost:${port}`;
    };

    const tokens = (grant: string, scope: string) => {
      const t = now();
      store.prune(t);
      return {
        access_token: store.addToken(grant, "access", t + accessTtl),
        token_type: "Bearer",
        expires_in: Math.floor(accessTtl / 1000),
        refresh_token: store.addToken(grant, "refresh", t + refreshTtl),
        scope,
      };
    };

    const page = (res: ServerResponse, status: number, title: string, inner: string, formTo?: string) => {
      res
        .writeHead(status, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-frame-options": "DENY",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
          "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'${formTo ? ` ${formTo}` : ""}; frame-ancestors 'none'; base-uri 'none'`,
        })
        .end(
          `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>` +
            `<style>body{font:16px/1.5 system-ui,sans-serif;max-width:26rem;margin:3rem auto;padding:0 1rem}input,button{font:inherit;width:100%;box-sizing:border-box;padding:.6rem;margin:.4rem 0}.e{color:#b00}</style></head>` +
            `<body><h1>${esc(title)}</h1>${inner}</body></html>`,
        );
    };
    const consent = (res: ServerResponse, id: string, p: Pending, error?: string) =>
      page(
        res,
        error ? 401 : 200,
        "Sign in to Archipelago",
        `<p><b>${esc(p.name)}</b> asks to use your map's MCP server. You will be sent back to <b>${esc(new URL(p.redirect).host)}</b>.</p>` +
          (error ? `<p class="e">${esc(error)}</p>` : "") +
          `<form method="post" action="/authorize"><input type="hidden" name="request" value="${esc(id)}">` +
          `<label>Passphrase<input type="password" name="passphrase" autocomplete="current-password" required autofocus></label>` +
          `<button type="submit">Allow</button></form>`,
        new URL(p.redirect).origin,
      );
    const back = (res: ServerResponse, redirect: string, params: Record<string, string | undefined>) => {
      const u = new URL(redirect);
      for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
      u.searchParams.set("iss", issuer);
      res.writeHead(302, { location: u.href, "cache-control": "no-store" }).end();
    };

    const authorizeGet = (res: ServerResponse, q: URLSearchParams) => {
      const client = store.client(q.get("client_id") ?? "");
      if (!client) return page(res, 400, "Unknown client", "<p>This client has not registered with the gateway.</p>");
      const redirect = q.get("redirect_uri") ?? (client.redirects.length === 1 ? client.redirects[0]! : "");
      if (!client.redirects.includes(redirect) || !allowed.has(redirect)) return page(res, 400, "Redirect not allowed", "<p>The client asked to be sent somewhere it did not register.</p>");
      const state = q.get("state") ?? undefined;
      if (q.get("response_type") !== "code") return back(res, redirect, { error: "unsupported_response_type", state });
      const challenge = q.get("code_challenge") ?? "";
      if (q.get("code_challenge_method") !== "S256" || !CHALLENGE.test(challenge)) {
        return back(res, redirect, { error: "invalid_request", error_description: "PKCE with S256 is required", state });
      }
      if (!resourceOk(q.get("resource"))) return back(res, redirect, { error: "invalid_target", state });
      const t = now();
      for (const [k, p] of pending) if (p.expires < t) pending.delete(k);
      if (pending.size >= PENDING_MAX) pending.delete(pending.keys().next().value!);
      const id = b64url(randomBytes(24));
      const p: Pending = { client: client.id, name: client.name, redirect, ...(state !== undefined ? { state } : {}), challenge, scope: scopeOf(q.get("scope")), expires: t + PENDING_TTL, tries: 0 };
      pending.set(id, p);
      consent(res, id, p);
    };

    /** Sign-ins are checked one at a time, so a burst can't outrun the lockout. */
    let signing: Promise<unknown> = Promise.resolve();
    const authorizePost = async (req: IncomingMessage, res: ServerResponse) => {
      const origin = req.headers.origin;
      if (origin !== undefined && origin !== issuer) return page(res, 403, "Refused", "<p>This form posts only from its own page.</p>");
      const form = new URLSearchParams(await body(req, 8 * 1024));
      const id = form.get("request") ?? "";
      const p = pending.get(id);
      if (!p || p.expires < now()) {
        pending.delete(id);
        return page(res, 400, "Expired", "<p>This sign-in has expired. Start again from Claude.</p>");
      }
      const run = signing.then(async () => {
        const f = store.failures();
        if (f.until && f.until > now()) return { locked: f.until };
        const ok = await checkPassphrase(form.get("passphrase") ?? "", store.passphrase()!);
        if (ok) {
          store.setFailures({ count: 0 });
          return { ok };
        }
        const count = f.count + 1;
        store.setFailures(count >= maxFailures ? { count: 0, until: now() + lockout } : { count });
        return { ok };
      });
      signing = run.catch(() => {});
      const r = await run;
      if ("locked" in r) return page(res, 429, "Locked", `<p>Too many wrong passphrases. Try again after ${esc(new Date(r.locked!).toISOString())}.</p>`);
      if (!r.ok) {
        if (++p.tries >= 3) {
          pending.delete(id);
          return page(res, 401, "Wrong passphrase", "<p>Start again from Claude.</p>");
        }
        return consent(res, id, p, "Wrong passphrase.");
      }
      pending.delete(id);
      const code = store.addCode({ client: p.client, redirect: p.redirect, challenge: p.challenge, scope: p.scope, expires: now() + CODE_TTL }, now());
      back(res, p.redirect, { code, state: p.state });
    };

    const register = async (req: IncomingMessage, res: ServerResponse) => {
      let meta: { redirect_uris?: unknown; client_name?: unknown };
      try {
        meta = JSON.parse(await body(req, 64 * 1024));
      } catch {
        return oauthError(res, 400, "invalid_client_metadata", "the body must be JSON");
      }
      const uris = meta?.redirect_uris;
      if (!Array.isArray(uris) || uris.length === 0 || uris.length > 5 || !uris.every((u) => typeof u === "string" && allowed.has(u))) {
        return oauthError(res, 400, "invalid_redirect_uri", "redirect_uris must be among the gateway's allowed redirects");
      }
      const name = typeof meta.client_name === "string" && meta.client_name.trim() ? meta.client_name.trim().slice(0, 80) : "An MCP client";
      const c = store.addClient(name, [...new Set(uris as string[])], now(), CLIENTS_MAX, CLIENT_STALE);
      if (!c) return oauthError(res, 400, "invalid_client_metadata", "too many clients are registered; revoke some");
      json(res, 201, {
        client_id: c.id,
        client_id_issued_at: Math.floor(c.created / 1000),
        client_name: c.name,
        redirect_uris: c.redirects,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      });
    };

    const token = async (req: IncomingMessage, res: ServerResponse) => {
      if (!(req.headers["content-type"] ?? "").startsWith("application/x-www-form-urlencoded")) {
        return oauthError(res, 400, "invalid_request", "the body must be application/x-www-form-urlencoded");
      }
      const f = new URLSearchParams(await body(req, 16 * 1024));
      const clientId = f.get("client_id") ?? "";
      if (!store.client(clientId)) return oauthError(res, 401, "invalid_client", "unknown client");
      if (!resourceOk(f.get("resource"))) return oauthError(res, 400, "invalid_target", `the resource is ${resource}`);
      const grantType = f.get("grant_type");
      if (grantType === "authorization_code") {
        const raw = f.get("code") ?? "";
        const code = store.code(raw);
        if (!code) return oauthError(res, 400, "invalid_grant", "unknown code");
        if (code.used) {
          // A code used twice: whatever it became is revoked.
          if (code.grant) store.revoke(code.grant, now());
          return oauthError(res, 400, "invalid_grant", "the code was already used");
        }
        store.useCode(raw);
        if (code.expires < now() || code.client !== clientId || code.redirect !== f.get("redirect_uri")) {
          return oauthError(res, 400, "invalid_grant", "the code is expired, or not this client's or redirect's");
        }
        const verifier = f.get("code_verifier") ?? "";
        if (!VERIFIER.test(verifier) || !same(s256(verifier), code.challenge)) return oauthError(res, 400, "invalid_grant", "the code_verifier does not match");
        const g = store.addGrant(clientId, code.scope, now());
        store.useCode(raw, g.id);
        return json(res, 200, tokens(g.id, g.scope), { pragma: "no-cache" });
      }
      if (grantType === "refresh_token") {
        const raw = f.get("refresh_token") ?? "";
        const t = store.token(raw);
        if (!t || t.kind !== "refresh") return oauthError(res, 400, "invalid_grant", "unknown refresh token");
        const g = store.grant(t.grant);
        if (!g || g.revoked || g.client !== clientId) return oauthError(res, 400, "invalid_grant", "the grant is revoked, or not this client's");
        if (t.used) {
          // A spent refresh token again: it was copied. The grant goes.
          store.revoke(g.id, now());
          return oauthError(res, 400, "invalid_grant", "the refresh token was already used; the grant is revoked");
        }
        if (t.expires < now()) return oauthError(res, 400, "invalid_grant", "the refresh token expired");
        store.useToken(raw);
        store.touch(g.id, now());
        return json(res, 200, tokens(g.id, g.scope), { pragma: "no-cache" });
      }
      return oauthError(res, 400, "unsupported_grant_type", "authorization_code or refresh_token");
    };

    const challenge = (res: ServerResponse, error?: string) =>
      json(res, 401, { error: error ?? "unauthorized" }, {
        "www-authenticate": `Bearer resource_metadata="${prmUrl}"${error ? `, error="${error}"` : ""}`,
      });

    const proxy = (req: IncomingMessage, res: ServerResponse) => {
      const headers: OutgoingHttpHeaders = { host: upstream.host };
      for (const h of FORWARD) if (req.headers[h] !== undefined) headers[h] = req.headers[h];
      const up = request({ hostname: upstream.hostname.replace(/^\[|\]$/g, ""), port: upstream.port || 80, path: upstream.pathname, method: req.method, headers }, (answer) => {
        const out: OutgoingHttpHeaders = {};
        for (const h of BACK) if (answer.headers[h] !== undefined) out[h] = answer.headers[h];
        res.writeHead(answer.statusCode ?? 502, out);
        answer.pipe(res);
      });
      up.on("error", () => {
        if (!res.headersSent) json(res, 502, { error: "the map's MCP server is not answering" });
        else res.destroy();
      });
      // A client that goes away (an SSE stream closed) closes the upstream request too.
      res.on("close", () => up.destroy());
      req.pipe(up);
    };

    const mcp = (req: IncomingMessage, res: ServerResponse) => {
      const auth = req.headers.authorization ?? "";
      const m = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(auth);
      if (!m) return challenge(res);
      const t = store.token(m[1]!);
      const g = t && t.kind === "access" && t.expires > now() ? store.grant(t.grant) : undefined;
      if (!g || g.revoked) return challenge(res, "invalid_token");
      if (now() - g.used > 60_000) store.touch(g.id, now());
      if (!["POST", "GET", "DELETE"].includes(req.method ?? "")) return json(res, 405, { error: "method not allowed" });
      proxy(req, res);
    };

    const server = createServer(async (req, res) => {
      if (!hostOk(req)) return json(res, 403, { error: "host is not this server" });
      const url = new URL(req.url ?? "/", issuer);
      const path = url.pathname;
      try {
        if (path === "/mcp") return mcp(req, res);
        if (req.method === "GET" && (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp")) return json(res, 200, prm, { "cache-control": "max-age=300" });
        if (req.method === "GET" && path === "/.well-known/oauth-authorization-server") return json(res, 200, asm, { "cache-control": "max-age=300" });
        if (req.method === "POST" && path === "/register") return await register(req, res);
        if (req.method === "GET" && path === "/authorize") return authorizeGet(res, url.searchParams);
        if (req.method === "POST" && path === "/authorize") return await authorizePost(req, res);
        if (req.method === "POST" && path === "/token") return await token(req, res);
        json(res, 404, { error: "not found" });
      } catch (err) {
        ctx.runtime.report(ctx.fiber, err);
        if (!res.headersSent) json(res, 500, { error: "server_error" });
      }
    });
    ctx.effect(
      () => () =>
        new Promise<void>((done) => {
          if (!server.listening) return done();
          server.close(() => done());
          server.closeAllConnections();
        }),
    );
    await new Promise<void>((ok, fail) => {
      server.once("error", fail);
      server.listen(config.port ?? 5183, "127.0.0.1", () => {
        server.off("error", fail);
        const a = server.address();
        if (a && typeof a === "object") config.onListen?.(a.port);
        ok();
      });
    });
  },
};

export default gateway;
