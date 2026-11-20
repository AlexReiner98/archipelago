/**
 * The bridge, server side: serves capabilities of this runtime over HTTP,
 * so a runtime in a browser can provide the same keys (client.ts). Not
 * kernel: a pack like any other, and its server closes when it unloads.
 *
 * - `GET /caps`: the keys served, and which method of each the client keeps
 *   a copy of, for the reads that are synchronous (`agent.tree.nodes`).
 * - `POST /call` `{ key, method, args }`: calls it, answers `{ value }` or
 *   `{ error, refusal? }`.
 * - `GET /events`: an event stream; its first message names the stream.
 * - `POST /watch` `{ stream, id, key, method, args }`: calls a watch with a
 *   callback last, whose calls go down the stream as `{ watch: id, args }`.
 *   `POST /unwatch` `{ stream, id }` stops it; so does the stream closing.
 *
 * Every call is made from this pack's context, intercepted with
 * `config.actor`: whoever is at the page acts as that person. There is no
 * sign-in yet; the server listens on 127.0.0.1 and the runtime's guard
 * refuses another Host, and an Origin not in `config.origins`.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Actor, Dispose } from "../../spec/common.ts";
import { META } from "../../spec/common.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { refuse } from "../../runtime/guard.ts";

/** The keys served. Each is injected, so the bridge waits for all of them. */
export const KEYS = [
  "agent.tree",
  "exchange.read",
  "exchange.watch",
  "verdict.read",
  "action.list",
  "action.invoke",
  "graph.read",
  "graph.watch",
  "types.read",
] as const;

/** Reads a client keeps a copy of, refreshed when the key's `watch` fires. */
export const SYNC: Record<string, string> = { "agent.tree": "nodes", "action.list": "list", "types.read": "all" };

export interface BridgeConfig {
  port?: number;
  /** Who calls through the bridge. */
  actor?: Actor;
  /** Origins allowed to call (CORS), besides the bridge's own. */
  origins?: string[];
  /** More Host values answered (runtime/guard.ts). */
  hosts?: string[];
  onListen?: (port: number) => void;
}

function body(req: IncomingMessage): Promise<any> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        ok(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (e) {
        fail(e);
      }
    });
    req.on("error", fail);
  });
}

const bridge: Pack<BridgeConfig> = {
  id: "bridge",
  inject: KEYS,
  async apply(ctx: Context, config: BridgeConfig = {}) {
    const as = config.actor ? ctx.intercept({ [META.actor]: config.actor }) : ctx;
    const streams = new Map<string, { res: ServerResponse; watches: Map<number, Dispose> }>();

    const method = (key: string, name: string): ((...a: unknown[]) => unknown) => {
      if (!(KEYS as readonly string[]).includes(key)) throw new Error(`${key} is not served`);
      const cap = as.get<Record<string, unknown>>(key);
      const fn = Object.hasOwn(cap, name) ? cap[name] : undefined;
      if (typeof fn !== "function") throw new Error(`${key} has no method ${name}`);
      return fn as (...a: unknown[]) => unknown;
    };
    const send = (res: ServerResponse, status: number, value: unknown) =>
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
    const push = (res: ServerResponse, value: unknown) => res.write(`data: ${JSON.stringify(value)}\n\n`);
    const close = (id: string) => {
      const s = streams.get(id);
      if (!s) return;
      streams.delete(id);
      for (const d of s.watches.values()) void d();
    };

    const server = createServer(async (req, res) => {
      if (refuse(req, res, config)) return;
      const origin = req.headers.origin;
      if (origin) {
        res.setHeader("access-control-allow-origin", origin);
        res.setHeader("access-control-allow-headers", "content-type");
      }
      if (req.method === "OPTIONS") return res.writeHead(204).end();
      const path = (req.url ?? "/").split("?")[0];
      try {
        if (req.method === "GET" && path === "/caps") return send(res, 200, { keys: KEYS, sync: SYNC });
        if (req.method === "GET" && path === "/events") {
          const id = Math.random().toString(36).slice(2);
          res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
          streams.set(id, { res, watches: new Map() });
          push(res, { stream: id });
          req.on("close", () => close(id));
          return;
        }
        if (req.method !== "POST") return send(res, 404, { error: "not found" });
        const msg = await body(req);
        if (path === "/call") {
          try {
            const value = await method(msg.key, msg.method)(...(msg.args ?? []));
            return send(res, 200, { value: value ?? null });
          } catch (err) {
            const refusal = (err as { refusal?: unknown }).refusal;
            return send(res, 200, { error: (err as Error).message ?? String(err), ...(refusal ? { refusal } : {}) });
          }
        }
        if (path === "/watch") {
          const s = streams.get(msg.stream);
          if (!s) return send(res, 404, { error: "no such stream" });
          s.watches.get(msg.id)?.();
          const dispose = method(msg.key, msg.method)(...(msg.args ?? []), (...args: unknown[]) => push(s.res, { watch: msg.id, args })) as Dispose;
          s.watches.set(msg.id, dispose);
          return send(res, 200, { ok: true });
        }
        if (path === "/unwatch") {
          const s = streams.get(msg.stream);
          const d = s?.watches.get(msg.id);
          s?.watches.delete(msg.id);
          await d?.();
          return send(res, 200, { ok: true });
        }
        send(res, 404, { error: "not found" });
      } catch (err) {
        ctx.runtime.report(ctx.fiber, err);
        if (!res.headersSent) send(res, 500, { error: String(err) });
      }
    });

    const beat = setInterval(() => {
      for (const s of streams.values()) s.res.write(": beat\n\n");
    }, 15000);
    ctx.effect(
      () => () =>
        new Promise<void>((done) => {
          clearInterval(beat);
          for (const id of [...streams.keys()]) {
            streams.get(id)!.res.end();
            close(id);
          }
          if (!server.listening) return done();
          server.close(() => done());
          server.closeAllConnections();
        }),
    );
    await new Promise<void>((ok, fail) => {
      server.once("error", fail);
      server.listen(config.port ?? 5182, "127.0.0.1", () => {
        server.off("error", fail);
        const a = server.address();
        if (a && typeof a === "object") config.onListen?.(a.port);
        ok();
      });
    });
  },
};

export default bridge;
