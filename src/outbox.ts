// Other workspaces on this server, reached through the server: each workspace is its own database. Nothing passes
// between two workspaces any more: notifications and shares by workspace were dropped (the owner, 10 Nov 2026).

import type { Archipelago } from './pelago.ts';

/** Hands back another workspace's map, or undefined if there is no such workspace. */
type Lookup = (workspace: string) => Promise<Archipelago | undefined>;

let lookup: Lookup | undefined;

export function configureOutbox(next: Lookup): void {
  lookup = next;
}

/** Another workspace's whole map on this server, or undefined if there is no such workspace. */
export const otherMap = async (workspace: string): Promise<Archipelago | undefined> => (workspace ? lookup?.(workspace) : undefined);

/**
 * The whole of a map with row-level security bypassed: not one person's view of it, for the few things the system does to
 * all of it. Every caller is listed in test/bypassing-rls.test.ts, and a new one is a reviewed change.
 */
export async function bypassingRls(l: Archipelago): Promise<Archipelago> {
  if (l.viewer === undefined) return l;
  const whole = await lookup?.(l.workspace);
  if (!whole) throw new Error('This server cannot reach the whole workspace.');
  return whole;
}
