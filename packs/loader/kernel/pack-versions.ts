// The packs something ran under, each by its version and the hash of its manifest (step 0 of the refinement loop,
// e_uhvdeuye): a run records them when it starts, and the clock with each item it says came due, so what was done
// can be measured and replayed by the versions it was done under.

import { createHash } from 'node:crypto';
import { islandRegistry } from './island-pin.ts';
import { isOptional } from './manifest.ts';
import type { Registry } from './packs.ts';
import type { Archipelago } from '../../write/kernel/pelago.ts';

export interface PackVersion {
  id: string;
  version: string;
  /** The SHA-256 of its pack.json as read, or null when the registry holds none. */
  manifest: string | null;
}

/** The id the server's required internal packs are recorded under, together: they ship with the server and change only with it. */
export const INTERNAL_PACKS = 'internal';

/**
 * The active packs of a registry, as they are now. The required internal packs (docs/kernel-packs.md) are one entry,
 * `internal`, whose manifest is the SHA-256 of each one's `id@version:manifest` in id order: a run's record stays within
 * its field however many there are, and still changes when any of them does, and it is the same on every map one
 * server runs. An optional internal pack is a map's to switch, so it is recorded as a plain pack is: its own entry
 * while it is on here, none while it is off.
 */
export const packVersions = (registry: Registry): PackVersion[] => {
  const one = (p: { id: string; version: string }): PackVersion => ({ id: p.id, version: p.version, manifest: registry.hashes.get(p.id) ?? null });
  const together = (p: (typeof registry.packs)[number]) => registry.internal.has(p.id) && !isOptional(p);
  const internal = registry.packs.filter(together).map(one).sort((a, b) => a.id.localeCompare(b.id));
  const rest = registry.packs.filter((p) => !together(p)).map(one);
  if (!internal.length) return rest;
  const manifest = createHash('sha256').update(internal.map((v) => `${v.id}@${v.version}:${v.manifest ?? ''}`).join('\n')).digest('hex');
  return [...rest, { id: INTERNAL_PACKS, version: String(internal.length), manifest }];
};

/** The packs work on an item runs under: those of the registry its island runs (packs/loader/kernel/island-pin.ts), so a run or a firing
 *  on an island that tries a version of its pack records that version's manifest. No item, or one on no pinned island, is the map's. */
export const packVersionsFor = async (map: Archipelago, item?: { props: Record<string, unknown> } | null): Promise<PackVersion[]> =>
  packVersions(await islandRegistry(map, item?.props.island));

/** A part of the page as drawn: the part, its pack and the hash of its code (packs/loader/kernel/ui-parts.ts). */
export interface PartVersion {
  id: string;
  pack: string;
  hash: string;
}

/**
 * What a page drew with (task e_qqp3cuk4): the same packs a run records, and what a run has no need of, the host the
 * page loaded with and the hash of each part it was handed. `server` is the commit answering, where it is not the page's
 * (a page loaded before the server restarted on new code); `at` the log's head, where the registry stood (registryAt).
 */
export interface Drew {
  host: string | null;
  server?: string;
  at: number;
  island?: string;
  packs: PackVersion[];
  parts: PartVersion[];
  /** Asked at a past position whose packs this server cannot read: why today's drew in their place. */
  stand_in?: string;
}

const COMMIT = /^[0-9a-f]{40}$/;
/** A commit as the page names it: forty hex digits, else none. */
export const commitOf = (given: unknown): string | null => (typeof given === 'string' && COMMIT.test(given) ? given : null);

/** What a page on `island` (or the map) drew with: the run's record of its packs, the host it loaded with, its parts by hash. */
export async function drewWith(map: Archipelago, input: { island?: string; host?: unknown; server?: string | null; at: number; parts: PartVersion[] }): Promise<Drew> {
  const host = commitOf(input.host);
  return {
    host,
    ...(input.server && input.server !== host && { server: input.server }),
    at: input.at,
    ...(input.island && { island: input.island }),
    packs: await packVersionsFor(map, input.island ? { props: { island: input.island } } : undefined),
    parts: input.parts.map((p) => ({ id: p.id, pack: p.pack, hash: p.hash })),
  };
}
