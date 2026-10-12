// How often the routes that need no token may be asked. Anyone can reach
// them, so each address is given so many requests a minute, and all addresses
// together so many: the address is what the proxy in front of the server
// reports, and a caller who claims a new one each time is stopped by the
// second count instead. Kept in memory: a restart forgets it, which is fine.

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

const WINDOW_MS = 60_000;
/** The most addresses remembered at once: beyond it, a new one is counted only against the ceiling. */
const REMEMBERED = 20_000;

/**
 * A count of requests by address, a minute at a time. `take` answers 0 when
 * the request may go ahead, or the seconds until it may be asked again.
 */
export function limiter(limit: Limit, now: () => number = Date.now) {
  let began = now();
  let total = 0;
  const counts = new Map<string, number>();
  return {
    take(address: string): number {
      if (now() - began >= WINDOW_MS) {
        began = now();
        total = 0;
        counts.clear();
      }
      const wait = Math.max(1, Math.ceil((began + WINDOW_MS - now()) / 1000));
      const asked = counts.get(address) ?? 0;
      if (asked >= limit.each || (limit.all !== undefined && total >= limit.all)) return wait;
      if (asked || counts.size < REMEMBERED) counts.set(address, asked + 1);
      total++;
      return 0;
    },
  };
}
