// The drawing host: a second name the server answers to, for the frame a drawing runs in (ui/draw.html) alone. There
// the frame has a real origin, never the page's, so it may keep a service worker (/drawing/<hash>/sw.js, src/drawing-files.ts) across reloads and
// draw in a warm worker, while the page's token and storage stay where it cannot reach them.
//
// Configured (PELAGO_DRAW_HOST), the name serves the frame and what it loads, and nothing else. In dev with none, the
// other loopback name is the drawing host: a page on 127.0.0.1 frames localhost, and the reverse. Those are different
// sites, so no second port is needed; since either name is also a page, which one a request for the frame is for is
// read off the browser's word that it comes from another site (Sec-Fetch-Site), and the policy names the one page
// that may frame it. Without either, the page frames draw.html at its own origin, sandboxed with none (as before).

export interface DrawHostOptions {
  /** The drawing host's name (PELAGO_DRAW_HOST), with its port where it has one. */
  host?: string;
  /** With no name: pair the two loopback names (a dev server). */
  loopback?: boolean;
}

const LOOPBACK = ['127.0.0.1', 'localhost'];
/** What the drawing host serves: the frame (its scripts written in), three.js, which a drawing imports from the frame's origin, and drawings by hash with their service workers (src/drawing-files.ts). */
import { DRAW_HOST_NAME } from '../../../src/config.ts';

const SERVED = new Set(['/draw.html', '/three.js']);
export const drawHostServes = (path: string) => SERVED.has(path) || path.startsWith('/drawing/');


/** What the server answers a drawing host by, given its port and the origins its pages are reached at. */
export function drawHosts(port: number, pageOrigins: string[], { host, loopback = false }: DrawHostOptions = {}) {
  const own = host?.trim().toLowerCase() || undefined;
  if (own && !DRAW_HOST_NAME.test(own)) throw new Error(`A drawing host is a name and a port at most, not ${own}.`);
  const origin = own && `${/^(localhost|127\.0\.0\.1)(:|$)/.test(own) ? 'http' : 'https'}://${own}`;
  /** The other loopback name's origin, for a host that is one of them on this port. */
  const other = (at: string) => {
    const [name, p] = at.split(':');
    return loopback && p === String(port) && LOOPBACK.includes(name) ? `http://${LOOPBACK.find((n) => n !== name)}:${port}` : undefined;
  };
  return {
    /** The origin a page reached at this host frames its drawings at; none, and it frames them at its own. */
    originFor: (pageHost: string): string | undefined => (origin ? (pageHost === own ? undefined : origin) : other(pageHost)),
    /** True for the configured drawing host, where only what it serves is found. */
    only: (at: string) => Boolean(own) && at === own,
    /**
     * The pages that may frame draw.html asked for at this host with an origin of its own, or none: then it is served
     * as at the page's own host, sandboxed with no origin. Never the origin it is served from.
     */
    framedBy(at: string, fetchSite?: string): string[] | undefined {
      if (own) return at === own ? [...new Set(pageOrigins)].filter((o) => o !== origin) : undefined;
      const page = fetchSite === 'cross-site' ? other(at) : undefined;
      return page ? [page] : undefined;
    },
  };
}
