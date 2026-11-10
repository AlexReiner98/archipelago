// The addresses a server pack takes from the kernel's closed list (task e_p2e8d9er, decision e_wptrr6tf): public
// (GET /p/<workspace>/<id>[/<what>[/<extra>]]), site (any GET on a domain PELAGO_SITES names) and setup
// (/connect/setup.mjs). Each is taken by at most one pack (src/server-packs.ts refuses a second); the kernel parses
// the address and hands the parts to the pack's entry or file. With no pack mounted, the kernel answers as before.
//
// A seam for now: nothing is mounted, so every address is answered as it was.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ServerPacks } from './server-host.ts';
import type { Mount } from './server-reach.ts';

export interface MountCall {
  packs: ServerPacks;
  /** The domain's workspace, for a site. */
  site?: string;
  /** True, and the request answered, when its address has asked too often. */
  tooOften: () => boolean;
}

/** Which mount an address is, if any: the site of a domain the server names first, then /p/, then the setup. */
export function mountOf(pathname: string, site: string | undefined): Mount | undefined {
  if (site) return 'site';
  if (/^\/p\//.test(pathname)) return 'public';
  if (pathname === '/connect/setup.mjs') return 'setup';
  return undefined;
}

/** Answer an address at a mount a pack took; false when no pack took it, and the kernel answers as before. */
export async function serveMounted(_req: IncomingMessage, _res: ServerResponse, _mount: Mount, _pathname: string, _at: MountCall): Promise<boolean> {
  return false;
}
