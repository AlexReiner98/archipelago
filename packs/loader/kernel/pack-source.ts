// Where the registry's packs come from (one tier, e_k8nqby7n; this lane e_678v4axv): the system items on the map, laid
// over the seed. The seed is the pack files as a registry first read them: they ship packs and begin a map, and are read
// again only when asked (Registry.reload, a new release), never on a rebuild. What the map keeps of a pack as items
// stands in for its file.
//
// The one seam to the pack model (lane 1, packs/pack_model): which item types make up packs (`kinds`), and how those
// items come to manifests (`manifests`). Until that model lands, the stub is today's: the types, link types and packs
// kept as items (packs/loader/kernel/type-items.ts, type-overlay.ts, pack-items.ts), laid over the files where they are
// read today, so it adds no manifest of its own.

import { readPackFolders, type PackFolders } from './pack-folders.ts';
import { PACK_ITEM } from './pack-items.ts';
import { LINK_ITEM, TYPE_ITEM, type TypeItem } from './type-overlay.ts';
import type { Manifest } from './manifest.ts';

/** The pack files as a registry read them: found, hashes and folders by pack id. */
export type Seed = PackFolders<Manifest>;

/** An item the registry is built from: a pack's item or one of its parts. */
export type SystemItem = TypeItem;

/** What the pack model says of the system items: their types, and the manifests they make (by pack id, with each one's hash). */
export interface PackModel {
  kinds: readonly string[];
  manifests(items: SystemItem[]): Map<string, { manifest: Manifest; hash: string }>;
}

/** Today's: types, link types and packs kept as items, which the registry already lays over its packs itself. */
const STUB: PackModel = { kinds: [TYPE_ITEM, LINK_ITEM, PACK_ITEM], manifests: () => new Map() };

let model: PackModel = STUB;
/** The pack model in force; set once by the packs pack as the server starts, or by a test (undefined puts the stub back). */
export const setPackModel = (m: PackModel | undefined) => (model = m ?? STUB);
/** The item types the registry is built from: a change to one of these rebuilds it (packs/loader/kernel/registry-log.ts). */
export const systemKinds = (): readonly string[] => model.kinds;

/** The seed of a registry: the pack files in its folders, read now. The workspace's own types are never a folder's. */
export const readSeed = (dirs: string[], local: string): Seed => readPackFolders<Manifest>(dirs, local);

/**
 * The packs a registry loads, as copies it may change: the seed, with each pack the map keeps as items in its file's
 * place. A pack the map holds is the map's, whatever its file now says; one it does not hold yet is still the file.
 */
export function packsOf(seed: Seed, items: SystemItem[]): Seed {
  const found = new Map(seed.found), hashes = new Map(seed.hashes), where = new Map(seed.where);
  for (const [id, { manifest, hash }] of model.manifests(items)) found.set(id, manifest), hashes.set(id, hash);
  return { found, hashes, where };
}
