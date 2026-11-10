// Where a frozen link is read over HTTP (src/share-link.ts): POST /s/<workspace>/<secret>/token trades the link's
// secret for a reader token, and POST /api/<name> with that token answers from the link's snapshot alone. The
// reader token never reaches the rest of the server: it is no workspace token (src/auth.ts), so every other address
// refuses it as one nobody made.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { bearer } from './auth.ts';
import { json as send, UNLISTED } from './reply.ts';
import { LinkRefused, readerWorkspace, readLink, trade } from './share-link.ts';
import type { Workspaces } from './workspaces.ts';

interface Ctx {
  workspaces: Workspaces;
  /** True, and the request answered, when its address has asked too often. */
  tooOften: () => boolean;
  /** Whether the request is the server's own page's: its origin and host, and JSON. */
  local: () => boolean;
  body: () => Promise<unknown>;
}

const TRADE = /^\/s\/([^/]+)\/([^/]+)\/token$/;

/** Answer a link's trade or a reader token's call, and say true; false when the request is neither. */
export async function serveLink(req: IncomingMessage, res: ServerResponse, path: string, ctx: Ctx): Promise<boolean> {
  if (req.method !== 'POST') return false;
  const traded = TRADE.exec(path);
  const reader = !traded && path.startsWith('/api/') ? bearer(req.headers.authorization) : undefined;
  const ws = traded ? traded[1] : readerWorkspace(reader);
  if (!traded && !ws) return false;
  if (ctx.tooOften()) return true;
  if (!ctx.local()) return send(res, 403, { error: 'A link is read by the pelago page it opens.' }, UNLISTED), true;
  const at = ws && (await ctx.workspaces.has(ws)) ? (await ctx.workspaces.get(ws)).pelago : undefined;
  if (traded) {
    const got = at ? await trade(at, traded[2]) : null;
    return send(res, got ? 200 : 404, got ?? { error: 'This link does not open anything: it may have been revoked.' }, UNLISTED), true;
  }
  if (!at) return send(res, 401, { error: 'This link has been revoked, or its reader token has run out: open the link again.' }, UNLISTED), true;
  try {
    const result = await readLink(at, reader!, path.slice('/api/'.length), ((await ctx.body()) ?? {}) as Record<string, unknown>);
    return send(res, 200, { result }, UNLISTED), true;
  } catch (err) {
    return send(res, err instanceof LinkRefused ? err.status : 400, { error: (err as Error).message }, UNLISTED), true;
  }
}
