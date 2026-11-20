// Where the registry's packs come from (one tier, e_k8nqby7n; this lane e_678v4axv): the system items on the map, laid
// over the seed. The seed is the pack files as a registry first read them: they ship packs and begin a map, and are read
// again only when asked (Registry.reload, a new release), never on a rebuild. What the map keeps of a pack as items
// stands in for its file.
//
// The one seam to the pack model (lane 1, packs/pack_model): which item types make up packs (`kinds`), and how those
// items come to manifests (`manifests`). Until that model lands, the stub is today's: the types, link types and packs
// kept as items (packs/loader/kernel/type-items.ts, type-overlay.ts, pack-items.ts), laid over the files where they are
// read today, so it adds no manifest of its own.

import { keepRead, readPackFolders, type PackFolders } from './pack-folders.ts';
import { PACK_ITEM } from './pack-items.ts';
import { LINK_ITEM, TYPE_ITEM, type TypeItem } from './type-overlay.ts';
import type { Manifest } from './manifest.ts';

/** The pack files as a registry read them: found, hashes and folders by pack id. */
export type Seed = PackFolders<Manifest>;

/** An item the registry is built from: a pack's item or one of its parts, with the name of the pack it is part_of (`pack`). */
export type SystemItem = TypeItem & { pack?: string };

/** What the pack model says of the system items: their types, and the manifests they make (by pack id, with each one's hash). */
export interface PackModel {
  kinds: readonly string[];
  /**
   * The kinds every item of which the registry is built from (types, link types, packs kept on the map); of the other
   * kinds, only a pack's parts: an item carrying what it shipped as, or part_of a pack's item. A map's own lens or
   * instruction makes no manifest, so a change to it rebuilds nothing. Left out, every kind is whole.
   */
  whole?: readonly string[];
  /** Each with the text it was hashed from (the hash is its hex SHA-256), which the log keeps as a pack file's. */
  manifests(items: SystemItem[]): Map<string, { manifest: Manifest; hash: string; text?: string }>;
}

/** Today's: types, link types and packs kept as items, which the registry already lays over its packs itself. */
const STUB: PackModel = { kinds: [TYPE_ITEM, LINK_ITEM, PACK_ITEM], manifests: () => new Map() };

let model: PackModel = STUB;
/** The pack model in force; set once by the packs pack as the server starts, or by a test (undefined puts the stub back). */
export const setPackModel = (m: PackModel | undefined) => (model = m ?? STUB);
/** The item types the registry is built from: a change to one of these rebuilds it (packs/loader/kernel/registry-log.ts). */
export const systemKinds = (): readonly string[] => model.kinds;
/** The kinds every item of which is a system item (PackModel.whole). */
export const wholeKinds = (): readonly string[] => model.whole ?? model.kinds;
/** Whether an item about to be written, of this type and with these props, is a system item (part_of a pack is read from the map: systemWhere). */
export const isSystem = (type: string, props?: Record<string, unknown>): boolean => wholeKinds().includes(type) || (model.kinds.includes(type) && props?.shipped != null);
/**
 * The same as SQL, for the entity row aliased `e`: $whole the whole kinds, $kinds every kind, $partOf the part_of link
 * family and $pack the pack item's type, each a text[] parameter (or text, for $pack) of the caller's.
 */
export const systemWhere = (e: string, whole: string, kinds: string, partOf: string, pack: string): string =>
  `(${e}.type = any(${whole}::text[]) or (${e}.type = any(${kinds}::text[]) and (${e}.props ? 'shipped' or exists (select 1 from relation sr join entity sp on sp.id = sr.to_id where sr.from_id = ${e}.id and sr.type = any(${partOf}::text[]) and sp.type = ${pack} and sp.archived_at is null))))`;

/** The seed of a registry: the pack files in its folders, read now. The workspace's own types are never a folder's. */
export const readSeed = (dirs: string[], local: string): Seed => readPackFolders<Manifest>(dirs, local);

/**
 * Which rules are on the floor (lane 4, packs/rules/kernel/floor.ts: onFloor): each is loaded from code always, and a
 * map's version of it, which the judge let through only as a tightening, stands in its place. Until the floor is set,
 * every rule a floor pack's file declares is on it, so no rule of the kernel's leaves with an item.
 */
export type Floor = { packs: readonly string[]; on: (pack: string, rule: string) => boolean };
const FLOOR_STUB: Floor = { packs: ['core'], on: () => true };
let floor: Floor = FLOOR_STUB;
/** The floor in force; set once as the server starts, or by a test (undefined puts the stub back). */
export const setFloor = (f: Floor | undefined) => (floor = f ?? FLOOR_STUB);

/** A pack's manifest from the map, with each floor rule its file declares and the map's lacks put back from code. */
function withFloor(id: string, fromMap: Manifest, file: Manifest | undefined): Manifest {
  if (!file || !floor.packs.includes(id)) return fromMap;
  const has = new Set((fromMap.rules ?? []).map((r) => r.id));
  const back = (file.rules ?? []).filter((r) => r.id && !has.has(r.id) && floor.on(id, r.id));
  return back.length ? { ...fromMap, rules: [...back, ...(fromMap.rules ?? [])] } : fromMap;
}

/**
 * The packs a registry loads, as copies it may change: the seed, with each pack the map keeps as items in its file's
 * place. A pack the map holds is the map's, whatever its file now says, its floor rules kept; one it does not hold yet
 * is still the file.
 */
export function packsOf(seed: Seed, items: SystemItem[]): Seed {
  const found = new Map(seed.found), hashes = new Map(seed.hashes), where = new Map(seed.where);
  for (const [id, { manifest, hash, text }] of model.manifests(items)) {
    found.set(id, withFloor(id, manifest, seed.found.get(id))), hashes.set(id, hash);
    if (text !== undefined) keepRead(hash, text); // the text the log keeps for a pack fact naming this hash (packs/loader/kernel/packstate.ts)
  }
  return { found, hashes, where };
}
