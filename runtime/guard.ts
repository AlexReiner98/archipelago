/**
 * The guard every local server puts first. The servers listen on 127.0.0.1
 * with no sign-in, so a web page in the owner's browser could reach them:
 *
 * - by DNS rebinding, a name that resolves to 127.0.0.1, so the `Host` is
 *   not this server's. Only `127.0.0.1:<port>`, `localhost:<port>` and the
 *   configured `hosts` are answered.
 * - by a cross-site request, which carries the page's `Origin`. A request
 *   with no `Origin` (Claude Code's hooks, its MCP client, curl) is
 *   answered; one with an `Origin` only if it is this server's own, or one
 *   of the configured `origins` (the page's, for the adapter and the bridge;
 *   a host's in front of them).
 *
 * `<port>` is the port the request arrived on.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export interface LocalAccess {
  /** More `Host` values answered, as `name:port` (a proxy that keeps its own). */
  hosts?: string[];
  /** More origins answered, as `scheme://name[:port]`. */
  origins?: string[];
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\/+$/, "");

/** The origins a server on this port answers on its own. */
export const localOrigins = (port: number) => [`http://127.0.0.1:${port}`, `http://localhost:${port}`];

/** Why a request is refused, or undefined when it may go on. */
export function refusal(req: IncomingMessage, access: LocalAccess = {}): string | undefined {
  const port = req.socket.localPort;
  const host = req.headers.host === undefined ? undefined : norm(req.headers.host);
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, ...(access.hosts ?? []).map(norm)]);
  if (!host || !hosts.has(host)) return `host ${host ?? "(none)"} is not this server`;
  const origin = req.headers.origin;
  if (origin === undefined) return undefined;
  const origins = new Set([...localOrigins(port ?? 0), ...(access.origins ?? []).map(norm)]);
  if (!origins.has(norm(origin))) return `origin ${origin} is not allowed`;
  return undefined;
}

/** Answers 403 and returns true when the request is refused. */
export function refuse(req: IncomingMessage, res: ServerResponse, access?: LocalAccess): boolean {
  const why = refusal(req, access);
  if (!why) return false;
  res.writeHead(403, { "content-type": "application/json" }).end(JSON.stringify({ error: why }));
  return true;
}
