// The addresses a server pack takes from the kernel's closed list (task e_p2e8d9er, decision e_wptrr6tf): public
// (GET /p/<workspace>/<id>[/<what>[/<extra>]]), site (any GET on a domain PELAGO_SITES names) and setup
// (/connect/setup.mjs). Each is taken by at most one pack (src/server-packs.ts refuses a second); the kernel parses
// the address and hands the parts to the pack's entry or file. With no pack mounted, the kernel answers as before.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { GUARD, READER_POLICY } from './public-document.ts';
import { json } from './reply.ts';
import { serveFile } from './server-files.ts';
import type { ServerPacks } from './server-host.ts';
import type { Mount } from './server-reach.ts';

export interface MountCall {
  packs: ServerPacks;
  /** The domain's workspace, for a site. */
  site?: string;
  /** True, and the request answered, when its address has asked too often. */
  tooOften: () => boolean;
  /** Whether this server asks for a token, as a setup file is filled with ({tokens}). */
  tokens?: boolean;
}

/** A public address in its parts: /p/<workspace>/<id>[/<what>[/<extra>]]. */
const PUBLIC = /^\/p\/([^/]+)\/([^/]+)(?:\/([^/]+)(?:\/([^/]+))?)?\/?$/;

/** Which mount an address is, if any: the site of a domain the server names first, then /p/, then the setup. */
export function mountOf(pathname: string, site: string | undefined): Mount | undefined {
  if (site) return 'site';
  if (/^\/p\//.test(pathname)) return 'public';
  if (pathname === '/connect/setup.mjs') return 'setup';
  return undefined;
}

/** The pack that took a mount, and what it names there. */
function mountedAt(packs: ServerPacks, mount: Mount): { id: string; to: string } | undefined {
  for (const { file } of packs.packs) {
    const to = file.reach.server.mounts?.[mount];
    if (to) return { id: file.id, to };
  }
  return undefined;
}

/** What a mounted entry hands the kernel for its address, or undefined when the address is not one it answers. */
function partsOf(mount: Mount, pathname: string, site: string | undefined): Record<string, string> | undefined {
  if (mount === 'site') return site ? { workspace: site, path: pathname } : undefined;
  const m = PUBLIC.exec(pathname);
  if (!m) return undefined;
  return { workspace: m[1], id: m[2], ...(m[3] && { what: m[3] }), ...(m[4] && { extra: m[4] }) };
}

/** Send what a mounted entry answered, { status, html }, as a page under the reader's policy; anything else is the pack's fault. */
export function sendPage(res: ServerResponse, answer: unknown): void {
  const a = (answer ?? {}) as { status?: unknown; html?: unknown };
  if (typeof a.html !== 'string') return void json(res, 502, { error: 'The pack answered no page.' }, GUARD);
  const status = Number.isInteger(a.status) && (a.status as number) >= 200 && (a.status as number) <= 599 ? (a.status as number) : 200;
  res.writeHead(status, { ...GUARD, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': READER_POLICY }).end(a.html);
}

/** Answer an address at a mount a pack took; false when no pack took it, and the kernel answers as before. */
export async function serveMounted(_req: IncomingMessage, res: ServerResponse, mount: Mount, pathname: string, at: MountCall): Promise<boolean> {
  const taken = mountedAt(at.packs, mount);
  if (!taken) return false;
  if (mount === 'setup') {
    if (at.tooOften()) return true;
    await serveFile(res, at.packs.find(taken.id)!.file, taken.to, { origin: at.packs.origin, tokens: at.tokens ?? false });
    return true;
  }
  const parts = partsOf(mount, pathname, at.site);
  if (!parts) return false;
  if (at.tooOften()) return true;
  let answer: unknown;
  try {
    answer = await at.packs.call(taken.id, 'entry', taken.to, parts);
  } catch (err) {
    console.error(`server pack ${taken.id} at ${mount}: ${(err as Error).message}`);
    json(res, 502, { error: 'The pack that answers here did not.' }, GUARD);
    return true;
  }
  sendPage(res, answer);
  return true;
}
