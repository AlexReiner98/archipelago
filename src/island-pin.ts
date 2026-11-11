// A version of a pack tried on one island while the rest of the map keeps the pack as it is (task e_j4bzhegb, the
// plan "The harness refines itself through packs", e_e9526ead). A version is a pack item that names the pack in its
// field version_of (src/pack-items.ts): it declares the same types and link types by the same ids, and may change
// their fields, the rules and the instructions. An island runs one by naming it in its field pack_version; unset, it
// runs the map's. Setting it is a change like any other, and unsetting it is the rollback: nothing is unwound.
//
// Each version runs in a registry of its own, built from the map's with the version in its pack's place and kept until
// the map's loads again: so every read of a type stays one consistent map, and nothing that reads a registry has to
// know about islands. What an island's item is checked against, and what is said to a session on the island, is read
// from the registry the island runs (islandRegistry).

import { ISLAND } from './island-items.ts';
import type { PackVersion } from './pack-items.ts';
import type { Registry } from './packs.ts';
import type { Archipelago } from './pelago.ts';
import type { Op } from './pelago-types.ts';

/** The field of an island that names the version of its pack it runs. */
export const PACK_VERSION = 'pack_version';

/** The registries built for versions, by the map registry's versions (a new map each time it loads), then by item. */
const built = new WeakMap<Map<string, PackVersion>, Map<string, Registry | Error>>();

/** The registry that runs a version (by its item), or why it cannot be built; undefined when the item is no version here. */
export function versionRegistry(reg: Registry, item: string): Registry | Error | undefined {
  const version = reg.versions.get(item);
  if (!version) return undefined;
  const mine = built.get(reg.versions) ?? built.set(reg.versions, new Map()).get(reg.versions)!;
  if (!mine.has(item)) {
    try {
      const run = reg.trial(reg.items, [], version);
      const state = run.states.get(version.of);
      mine.set(item, state?.state === 'active' ? run : new Error(`with it, ${version.of} is ${state?.state ?? 'not loaded'}${state?.why ? `: ${state.why}` : ''}`));
    } catch (err) {
      mine.set(item, err as Error);
    }
  }
  return mine.get(item);
}

/** The version an island names, if the island is one and the version is of the pack it speaks. */
const pinOf = (reg: Registry, island: { type: string; props: Record<string, unknown>; archived_at?: unknown }) => {
  const pinned = island.props[PACK_VERSION];
  return !island.archived_at && reg.isA(island.type, ISLAND) && typeof pinned === 'string' && reg.versions.get(pinned)?.of === island.props.pack ? pinned : undefined;
};

/** The version an island runs and its registry; undefined where it runs the map's (no island, none named, or one that does not load). */
export async function islandVersion(map: Archipelago, island: unknown, reg: Registry = map.registry): Promise<{ registry: Registry; version: PackVersion } | undefined> {
  if (typeof island !== 'string' || !island) return undefined;
  const found = await map.entity(island);
  const pinned = found && pinOf(reg, found);
  const run = pinned ? versionRegistry(reg, pinned) : undefined;
  return run instanceof Error || !run ? undefined : { registry: run, version: reg.versions.get(pinned as string)! };
}

/** The registry an island runs: the one of the version it names, else the map's (`reg`). No island, or one that names none, is the map's. */
export async function islandRegistry(map: Archipelago, island: unknown, reg: Registry = map.registry): Promise<Registry> {
  return (await islandVersion(map, island, reg))?.registry ?? reg;
}

/** Why ops that set an island's version cannot be kept, as sentences: it names no version, one of another pack, or one that does not load. */
export async function pinRefusals(map: Archipelago, reg: Registry, ops: Op[]): Promise<string[]> {
  const errors: string[] = [];
  for (const [i, op] of ops.entries()) {
    const set = op.op === 'create' || op.op === 'update' ? op.props?.[PACK_VERSION] : undefined;
    if (set === undefined || set === null) continue;
    const island = op.op === 'create' ? { type: op.type, props: op.props ?? {} } : await map.entity((op as { id: string }).id);
    if (!island || !reg.isA(island.type, ISLAND)) continue;
    const where = `op ${i + 1} (${op.op})`;
    const item = String(set), version = reg.versions.get(item);
    if (!version) { errors.push(`${where}: ${reg.madeWrong.has(item) ? `the pack item ${item} is no version: ${reg.madeWrong.get(item)}` : `"${item}" is no version of a pack here: a pack item whose version_of names the pack`}`); continue; }
    if (version.of !== island.props.pack) { errors.push(`${where}: ${item} is a version of ${version.of}, and this island speaks ${String(island.props.pack ?? 'none')}`); continue; }
    const run = versionRegistry(reg, item);
    if (run instanceof Error) errors.push(`${where}: the version ${item} of ${version.of} does not load: ${run.message}`);
  }
  return errors;
}
