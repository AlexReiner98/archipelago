// The kernel's own fillings of a workspace's open (src/lifecycle.ts): what Workspaces.load did in a fixed order, each
// step now under the pack its code moves to (docs/kernel-packs.md, "Where each module goes"), in the order it ran.
// The order within a phase is the order of registration, so the steps that depend on each other are registered here
// one after another, and the modules that register their own (the clock, src/due.ts) are imported after them.

import { join } from 'node:path';
import { restore } from './backup.ts';
import { indexWorkspace } from './control-index.ts';
import { addLocalType, importLocalPack, localTypes } from './control.ts';
import type { Q } from './db.ts';
import { startSchedules, stopSchedules } from './hooks.ts';
import { firstIsland } from './island-start.ts';
import { openKernel } from './kernel-context.ts';
import { onOpen, whileLeading } from './lifecycle.ts';
import { packsFor } from './pack-allow.ts';
import { LOCAL_PACK, Registry, type TypeDef } from './packs.ts';
import { followMade, islandsOn, packsOff, setIslands, syncPacks } from './packstate.ts';
import { Archipelago } from './pelago.ts';
import { beginApplying } from './rules.ts';
import { typeItems } from './type-items.ts';
import { syncTypes } from './typetable.ts';
import './due.ts'; // the clock: a timer of the clocks pack

/** The type items each open workspace's registry last took, to follow another server's change to them. */
const taken = new WeakMap<Archipelago, string>();

/** Take in the types and link types kept on the map, when they changed: ones that no longer load (a pack gone) are said, and left out. */
export async function takeTypeItems(pelago: Archipelago): Promise<boolean> {
  const items = await typeItems(pelago);
  const now = JSON.stringify(items);
  if (taken.get(pelago) === now) return false;
  taken.set(pelago, now);
  try {
    pelago.registry.takeItems(items);
  } catch (err) {
    console.error(`the types kept on the map in ${pelago.workspace} do not load: ${(err as Error).message}`);
    return false;
  }
  return true;
}

/**
 * A new workspace makes things shared unless they say otherwise (the owner, 9 Nov 2026): with one person in it that
 * hides nothing from anyone, a team sees one map, and a link shows what it is made for. The owner changes it in
 * Settings; a workspace made before keeps what it has, private when it never chose.
 */
async function beginShared(q: Q): Promise<['+', string, string, unknown][]> {
  const { rows } = await q.query(`insert into setting (key, value) values ('default_visibility', '"shared"'::jsonb) on conflict (key) do nothing returning key`);
  return rows.length ? [['+', 'setting', 'default_visibility', 'shared']] : [];
}

// restore: what a backup brings, and the indexes beside the workspaces told of its members and tokens, so they can sign in here.
onOpen('restore', 'log', async (o) => { if (o.backup) await restore(o.db, o.backup, o.id); });
onOpen('restore', 'identity', async (o) => { if (o.backup) await indexWorkspace(await o.control(), o.id, o.db); });

// packs: the types a workspace defines for itself (those kept in a folder before taken in once), the registry, the map,
// and which packs are present, as which manifests, and which the owner turned off (what they made is dormant).
onOpen('packs', 'loader', async (o) => {
  const { dataDir, packsDir, packDirs, packs, workspacePacks, rootDir } = o.config;
  if (dataDir !== null) await importLocalPack(o.db, o.isDefault ? join(packsDir, LOCAL_PACK, 'pack.json') : join(rootDir, o.id, 'local-pack', 'pack.json'));
  o.registry = new Registry(packDirs ?? packsDir, packsFor(packs, workspacePacks, o.id), await localTypes<TypeDef>(o.db));
  const db = o.db;
  o.registry.keepLocal = (def) => addLocalType(db, def);
});
onOpen('packs', 'write', (o) => { o.pelago = new Archipelago(o.db, o.registry!, o.config.policy, o.id); });
onOpen('packs', 'loader', async (o) => {
  const pelago = o.pelago!;
  await syncPacks(pelago); // which packs are present, and as which manifests, is a fact on the log
  pelago.registry.turnOff(await packsOff(pelago), await islandsOn(pelago));
  await takeTypeItems(pelago);
  // The packs kept as items are read with the type items: the log and the packs on take them in now.
  if (pelago.registry.made.size) await followMade(pelago);
});

// types: the type table, and the internal packs' service names filled (src/kernel-context.ts).
onOpen('types', 'loader', async (o) => {
  await syncTypes(o.pelago!);
  openKernel(o.pelago!);
});

// begin: what a new workspace begins with, one entry on its settings stream.
onOpen('begin', 'identity', async (o) => {
  if (o.begins) await o.pelago!.record('settings', 'system', [...(await beginApplying(o.db)), ...(await beginShared(o.db))]);
});

// islands: a fresh default map on islands, as create puts every other new map (e_44rbfwxp).
onOpen('islands', 'placement', async (o) => {
  if (!(o.begins && o.isDefault && o.config.defaultOnIslands)) return;
  await setIslands(o.pelago!, 'system', true);
  await firstIsland(o.pelago!, o.name);
});

// While this server leads: the packs' schedules, and the look for sessions gone quiet.
whileLeading('surface', (ws) => {
  startSchedules(ws.pelago);
  return () => stopSchedules(ws.pelago.registry);
});
whileLeading('sessions', (ws) => {
  ws.quiet.start();
  return () => ws.quiet.stop();
});
