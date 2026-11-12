// What a version of a pack adds (packs/loader/kernel/pack-items.ts, packs/loader/kernel/island-pin.ts): types and link types the pack does not
// declare, live only in the registry of an island that runs the version. The map's registry keeps them too, dormant
// and retired, so that an item made of one on that island is projected as its type says, on the write path and in a
// rebuild from the log alike (packs/log/kernel/replay.ts reads the map's registry), and no new item or link of it is made anywhere
// else. The type table keeps them dormant as well (packs/loader/kernel/typetable.ts), so an archived version leaves its items typed and
// readable, as a pack turned off leaves its own.

import type { Registry } from './packs.ts';

/** The ids of what versions added to each registry, as keepVersionTypes last took them in. */
const added = new WeakMap<Registry, { types: Set<string>; relations: Set<string> }>();

/** What the versions on this registry add, by id: the type table keeps these dormant. */
export const versionAdded = (reg: Registry) => added.get(reg) ?? { types: new Set<string>(), relations: new Set<string>() };

/** Whether the pack itself declares it: a version adds only what its pack does not. */
const own = (reg: Registry, pack: string, id: string) => reg.found.find((p) => p.id === pack)?.types?.some((t) => 'id' in t && t.id === id) || reg.found.find((p) => p.id === pack)?.links?.some((l) => 'id' in l && l.id === id);

/** Take into the map's registry, dormant and retired, each type and link type a version that loads adds. */
export function keepVersionTypes(reg: Registry): void {
  const took = { types: new Set<string>(), relations: new Set<string>() };
  added.set(reg, took);
  for (const version of reg.versions.values()) {
    let run: Registry;
    try { run = reg.trial(reg.items, [], version); } catch { continue; }
    if (run.states.get(version.of)?.state !== 'active') continue;
    // One the type table kept dormant (packs/loader/kernel/typetable.ts) gives way to the version's own definition.
    for (const t of run.types.values()) if (t.pack === version.of && (reg.types.get(t.id)?.dormant ?? true) && !own(reg, version.of, t.id)) reg.types.set(t.id, { ...t, dormant: true, retired: true }), took.types.add(t.id);
    for (const r of run.relations.values()) if (r.pack === version.of && (reg.relations.get(r.id)?.dormant ?? true) && !own(reg, version.of, r.id)) reg.relations.set(r.id, { ...r, dormant: true, retired: true }), took.relations.add(r.id);
  }
}
