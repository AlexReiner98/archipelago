// What the loader root fills of a workspace's open (src/lifecycle.ts, read in the order packs/roots.json starts the
// roots). In the packs phase, the types a workspace defines for itself (those kept in a folder before taken in once) and
// the registry, before the write root makes the map on it. In the types phase, which packs are present, as which
// manifests, and which the owner turned off (what they made is dormant), the types kept on the map, the type table, and
// the internal packs' code opened (src/kernel-context.ts), so a pack's manifest fills the phases after it. An open
// workspace follows what other servers changed in it (FOLLOW), and its packs' processes stop as it closes (CLOSE).

import { join } from 'node:path';
import { addLocalType, importLocalPack, localTypes } from '../../identity/kernel/control.ts';
import type { RootClose, RootFollow, RootOpen } from '../../identity/kernel/lifecycle.ts';
import { openKernel } from './kernel-context.ts';
import { packsFor } from './pack-allow.ts';
import { LOCAL_PACK, Registry, type TypeDef } from './packs.ts';
import { followMade, followPacks, islandsOn, packsOff, syncPacks } from './packstate.ts';
import { hostFor } from './packtools.ts';
import { onPacksChanged, onTypesChanged, takeTypeItems } from './type-items.ts';
import { syncTypes } from './typetable.ts';

// The type table follows the types kept on the map as it follows the packs.
onTypesChanged(syncTypes);
onPacksChanged(followMade);

export const OPEN: RootOpen = {
  packs: [
    async (o) => {
      const { dataDir, packsDir, packDirs, packs, workspacePacks, rootDir } = o.config;
      if (dataDir !== null) await importLocalPack(o.db, o.isDefault ? join(packsDir, LOCAL_PACK, 'pack.json') : join(rootDir, o.id, 'local-pack', 'pack.json'));
      o.registry = new Registry(packDirs ?? packsDir, packsFor(packs, workspacePacks, o.id), await localTypes<TypeDef>(o.db));
      const db = o.db;
      o.registry.keepLocal = (def) => addLocalType(db, def);
    },
  ],
  types: [
    async (o) => {
      const pelago = o.pelago!;
      await syncPacks(pelago); // which packs are present, and as which manifests, is a fact on the log
      pelago.registry.turnOff(await packsOff(pelago), await islandsOn(pelago));
      await takeTypeItems(pelago);
      // The packs kept as items are read with the type items: the log and the packs on take them in now.
      if (pelago.registry.made.size) await followMade(pelago);
    },
    async (o) => {
      await syncTypes(o.pelago!);
      openKernel(o.pelago!);
    },
  ],
};

export const FOLLOW: RootFollow = [
  async (ws) => {
    if (ws.pelago.registry.followLocal(await localTypes<TypeDef>(ws.pelago.db))) await syncTypes(ws.pelago);
    if (await takeTypeItems(ws.pelago)) await syncTypes(ws.pelago);
    await followPacks(ws.pelago);
  },
];

export const CLOSE: RootClose = [(ws) => hostFor(ws.pelago.registry).stop()];
