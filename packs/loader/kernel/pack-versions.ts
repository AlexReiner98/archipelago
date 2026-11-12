// The packs something ran under, each by its version and the hash of its manifest (step 0 of the refinement loop,
// e_uhvdeuye): a run records them when it starts, and the clock with each item it says came due, so what was done
// can be measured and replayed by the versions it was done under.

import { islandRegistry } from './island-pin.ts';
import type { Registry } from './packs.ts';
import type { Archipelago } from '../../../src/pelago.ts';

export interface PackVersion {
  id: string;
  version: string;
  /** The SHA-256 of its pack.json as read, or null when the registry holds none. */
  manifest: string | null;
}

/** The active packs of a registry, as they are now. */
export const packVersions = (registry: Registry): PackVersion[] => registry.packs.map((p) => ({ id: p.id, version: p.version, manifest: registry.hashes.get(p.id) ?? null }));

/** The packs work on an item runs under: those of the registry its island runs (src/island-pin.ts), so a run or a firing
 *  on an island that tries a version of its pack records that version's manifest. No item, or one on no pinned island, is the map's. */
export const packVersionsFor = async (map: Archipelago, item?: { props: Record<string, unknown> } | null): Promise<PackVersion[]> =>
  packVersions(await islandRegistry(map, item?.props.island));
