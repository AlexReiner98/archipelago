// Whether each connection (an external tool the map names, core's `connection`) is reachable: the connect pack's, since
// it calls out (docs/kernel-packs.md, "The root packs": checkConnections to the connect pack). It pings each one's URL
// through the walls (src/outbound.ts) and hands what it saw to the map (Archipelago.observed), which keeps it.
// It fills the surface's slot surface.act as check_connections (src/surface-fillings.ts).

import { guardedFetch } from '../../../src/outbound.ts';
import type { Actor, Archipelago, Entity } from '../../../src/pelago.ts';

/** Ping every open connection's URL and record whether it is reachable. */
export async function checkConnections(l: Archipelago, actor: Actor) {
  const { rows } = await l.db.query<Entity>(`select * from entity where type = any($1::text[]) and archived_at is null and is_open`, [l.registry.family('connection')]);
  const out = [];
  for (const conn of rows) {
    const url = conn.props.url as string | undefined;
    if (!url) continue;
    // Any HTTP answer, even an error status, means something is listening; asked through the guard (src/outbound.ts).
    const reachable = await guardedFetch(url, { signal: AbortSignal.timeout(2000) }).then(() => true, () => false);
    const status = reachable ? 'available' : 'unavailable';
    await l.observed(actor, conn, status);
    out.push({ id: conn.id, title: conn.title, url, status });
  }
  return out;
}

/** The surface's check_connections action (surface.act). */
export const check_connections = (l: Archipelago, actor: Actor) => checkConnections(l, actor);
