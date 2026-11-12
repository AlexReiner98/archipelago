// The write root's root services (docs/kernel-packs.md, "Root services"): what only the write path may do, asked by
// the internal packs packs/roots.json names for each (src/root-calls.ts).

import type { RootCall } from '../../../src/root-calls.ts';

/** What a check of a connection saw, as the connect pack hands it: the connection, what it saw, and who asked for the check. */
export interface Observation { id: string; status: 'available' | 'unavailable'; by: string }

/**
 * root.observe, for the connect pack (the owner, 12 Nov 2026, e_gc8stacv): kept as an observation by whoever asked for
 * the check, and the connection's status set, with a line in the activity, when it changed (Archipelago.observed). Only
 * a connection's reachability, on the map the check was asked of.
 */
export async function observe(at: RootCall, input: Observation): Promise<{ id: string; status: string }> {
  const map = at.map;
  if (!map) throw new Error('root.observe is asked of a map');
  if (input?.status !== 'available' && input?.status !== 'unavailable') throw new Error('root.observe: status is available or unavailable');
  if (typeof input.by !== 'string' || !/^[a-z]+:./.test(input.by)) throw new Error('root.observe: by is who asked for the check, as kind:name');
  const conn = typeof input.id === 'string' ? await map.entity(input.id) : undefined;
  if (!conn || !map.registry.isA(conn.type, 'connection')) throw new Error(`root.observe: no connection "${input.id}"`);
  await map.observed(input.by, conn, input.status);
  return { id: conn.id, status: input.status };
}
