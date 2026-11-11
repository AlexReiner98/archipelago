// The packs something ran under, each by its version and the hash of its manifest (step 0 of the refinement loop,
// e_uhvdeuye): a run records them when it starts, and the clock with each item it says came due, so what was done
// can be measured and replayed by the versions it was done under.

import type { Registry } from './packs.ts';

export interface PackVersion {
  id: string;
  version: string;
  /** The SHA-256 of its pack.json as read, or null when the registry holds none. */
  manifest: string | null;
}

/** The active packs of a registry, as they are now. */
export const packVersions = (registry: Registry): PackVersion[] => registry.packs.map((p) => ({ id: p.id, version: p.version, manifest: registry.hashes.get(p.id) ?? null }));
