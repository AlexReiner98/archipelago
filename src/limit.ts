// How often the routes that need no token may be asked. Anyone can reach
// them, so each address is given so many requests a minute, and all addresses
// together so many: the address is what the proxy in front of the server
// reports, and a caller who claims a new one each time is stopped by the
// second count instead. An IPv6 address is counted by its /64, the least a
// host is given, so one machine cannot be a new caller at every address it
// has. Kept in memory: a restart forgets it, which is fine.

import { isIP } from 'node:net';

export interface Limit {
  /** Requests one address may make in a minute. */
  each: number;
  /** Requests all addresses together may make in a minute; left out, there is no such ceiling. */
  all?: number;
}

/** What may be asked without a token, a minute. A public page with thirty pictures is some thirty-five requests. */
export const PUBLIC_LIMIT: Limit = { each: 120, all: 1200 };
/**
 * Deliveries from GitHub, each signed. No ceiling for all together: one caller
 * could then keep GitHub's own deliveries out, which is worse than checking a
 * signature that fails.
 */
export const DELIVERY_LIMIT: Limit = { each: 300 };

/**
 * Signing in and buying, counted apart from the pages: a flood of either keeps
 * neither the other nor the published pages from anyone.
 */
export const SIGN_IN_LIMIT: Limit = { each: 20, all: 600 };

/** Tokens that were refused, from one address: enough for a machine whose token has run out, too few to keep workspaces open with. */
export const REFUSED_LIMIT: Limit = { each: 30 };

const WINDOW_MS = 60_000;

/** What an address is counted as: an IPv6 address by its /64, any other as it is. */
export function counted(address: string): string {
  const plain = address.replace(/%.*$/, '');
  if (isIP(plain) !== 6 || /^::ffff:\d+\./i.test(plain)) return address;
  const [head, tail] = plain.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':')}::/64`;
}
/** The most addresses remembered at once: beyond it, a new one is counted only against the ceiling. */
const REMEMBERED = 20_000;

/**
 * A count of requests by address, a minute at a time. `take` answers 0 when
 * the request may go ahead, or the seconds until it may be asked again;
 * `full` answers the same without counting anything.
 */
export function limiter(limit: Limit, now: () => number = Date.now) {
  let began = now();
  let total = 0;
  const counts = new Map<string, number>();
  const fresh = () => {
    if (now() - began < WINDOW_MS) return;
    began = now();
    total = 0;
    counts.clear();
  };
  const wait = () => Math.max(1, Math.ceil((began + WINDOW_MS - now()) / 1000));
  const over = (address: string) => (counts.get(address) ?? 0) >= limit.each || (limit.all !== undefined && total >= limit.all);
  return {
    full(given: string): number {
      fresh();
      return over(counted(given)) ? wait() : 0;
    },
    take(given: string): number {
      fresh();
      const address = counted(given);
      const asked = counts.get(address) ?? 0;
      if (over(address)) return wait();
      if (asked || counts.size < REMEMBERED) counts.set(address, asked + 1);
      total++;
      return 0;
    },
  };
}
