// What a version of a pack adds (src/pack-items.ts, src/island-pin.ts): types and link types the pack does not
// declare, live only in the registry of an island that runs the version. The map's registry keeps them too, dormant
// and retired, so that an item made of one on that island is projected as its type says, on the write path and in a
// rebuild from the log alike (src/replay.ts reads the map's registry), and no new item or link of it is made anywhere
// else. Rolling the island back leaves its items as a pack turned off leaves its own.

import type { Registry } from './packs.ts';

/** Take into the map's registry, dormant and retired, each type and link type a version that loads adds. */
export function keepVersionTypes(reg: Registry): void {
  for (const version of reg.versions.values()) {
    let run: Registry;
    try { run = reg.trial(reg.items, [], version); } catch { continue; }
    if (run.states.get(version.of)?.state !== 'active') continue;
    for (const t of run.types.values()) if (!reg.types.has(t.id) && t.pack === version.of) reg.types.set(t.id, { ...t, dormant: true, retired: true });
    for (const r of run.relations.values()) if (!reg.relations.has(r.id) && r.pack === version.of) reg.relations.set(r.id, { ...r, dormant: true, retired: true });
  }
}
