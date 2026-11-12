// The way back to shipped parts (task e_f7tbyj8u, decision e_fxayrhma). A refiner may change any part of the page, on
// one island (a pinned version, packs/loader/kernel/island-pin.ts) or the whole map (the owner's `part` items), and a
// broken one must never strand the person looking. So the host keeps the parts as each pack ships them in git, and one
// press, which the host draws where no part reaches (ui/way-back.js), draws the island with them and unpins it.
//
// This module is in the loader, a root pack pinned by hash (packs/roots.json): no version of a pack reaches it. What
// it reads is the map's own registry, never an island's, with no kept items, and from the folder a pack was found in
// on the server. A folder laid out from a version's code or from the log (packs/loader/kernel/pack-code.ts) is refused.

import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { islandVersion, PACK_VERSION } from './island-pin.ts';
import { partsFor, partsOf, type Part } from './ui-parts.ts';
import type { Manifest } from './manifest.ts';
import type { Archipelago } from '../../write/kernel/pelago.ts';
import type { Op } from '../../write/kernel/pelago-types.ts';

/** What a registry gives this module: its packs and the folder each one's code is read from. */
type Packs = { folderOf(pack: string): string; packs: Manifest[] };
/** The owner's versions of parts, as items of core's part type. */
type Kept = { is_open: boolean; props: Record<string, unknown> };

/** Where code read back from the log or a version is laid out (pack-code.ts's ROOT): never the shipped code. */
const laidOut = () => join(tmpdir(), 'pelago-code');
const inside = (folder: string, root: string) => {
  const r = relative(root, folder);
  return r === '' || (!r.startsWith('..') && !r.startsWith(sep) && !/^[A-Za-z]:/.test(r));
};

/** Whether a pack's folder is one it was shipped in, not one laid out from a version's code or from the log. */
export const shippedFolder = (folder: string) => !inside(folder, laidOut());

/**
 * The parts as every pack ships them, each by its hash: from the map's registry (an island's would give its pinned
 * version), with none of the owner's versions over them. A pack whose code is not in a shipped folder has no shipped
 * parts, so it draws none here: the way back never runs code a refiner wrote.
 */
export function shippedParts(map: { registry: Packs }, have: string[] = []): Part[] {
  const reg = map.registry;
  const packs = reg.packs.filter((p) => !partsOf([p]).length || shippedFolder(reg.folderOf(p.id)));
  return partsFor({ folderOf: (id) => reg.folderOf(id), packs }, [], have);
}

/** What an island draws that is not what ships. */
export interface Refined {
  /** The pack version the island pins, when its parts are not the shipped ones. */
  pinned?: string;
  /** The parts drawn there otherwise than they ship (changed, added or retired), by id. */
  parts: string[];
}

/** The ids of parts two sets draw differently. */
const differ = (a: Part[], b: Map<string, string>) => {
  const mine = new Map(a.map((p) => [p.id, p.hash]));
  return [...new Set([...mine.keys(), ...b.keys()])].filter((id) => mine.get(id) !== b.get(id)).sort();
};

/**
 * Whether an island draws anything but the shipped parts, and what: undefined when it draws them as they ship, so the
 * host shows the way back only where it would change something. `kept` is the owner's versions of parts, as the
 * caller read them (core's part items).
 */
export async function refinedOn(map: Archipelago, island: unknown, kept: Kept[] = []): Promise<Refined | undefined> {
  const shipped = new Map(shippedParts(map).map((p) => [p.id, p.hash]));
  const run = await islandVersion(map, island);
  const pinned = run && differ(partsFor(run.registry), shipped).length ? run.version.item : undefined;
  const parts = differ(partsFor(run?.registry ?? map.registry, kept), shipped);
  return pinned || parts.length ? { ...(pinned && { pinned }), parts } : undefined;
}

/** The ops that unpin an island, so it keeps drawing the shipped parts: none when it pins nothing. */
export function wayBackOps(island: { id: string; props: Record<string, unknown> }): Op[] {
  return island.props[PACK_VERSION] ? [{ op: 'update', id: island.id, props: { [PACK_VERSION]: null } } as Op] : [];
}
