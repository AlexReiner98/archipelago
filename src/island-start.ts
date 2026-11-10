// Islands on a map that has work on it, and on a new map from its start (the owner, 10 Nov 2026, decision e_44rbfwxp:
// islands always on). A new workspace is made with one island, named after it and speaking core, so an agent's first
// change has somewhere to go. A map with items turns islands on only if no pack in use would be switched off by the
// island rules (src/islands.ts), which would leave its work dormant; then every item that lives on an island and is on
// none is moved onto a new one, in one change, so it is in the log and undone as one.

import { islandsOff, sharedOf } from './islands.ts';
import { ISLAND, livesOnIsland } from './island-items.ts';
import { KERNEL_PACKS } from './packorder.ts';
import { LOCAL_PACK } from './packs.ts';
import type { Actor, Archipelago } from './pelago.ts';
import type { Op } from './pelago-types.ts';
import { workspaceName } from './standing.ts';

/** How many items one read takes when moving a map's work onto islands. */
const PAGE = 500;

/** Why this map cannot be held to the island rules as it is, or nothing: a pack in use the rules would switch off. */
export async function islandBlockers(l: Archipelago): Promise<string | undefined> {
  const off = islandsOff(l.registry.packs, LOCAL_PACK);
  for (const [pack, why] of off) {
    const types = [...l.registry.types.values()].filter((t) => t.pack === pack).map((t) => t.id);
    if (!types.length) continue;
    const { rows } = await l.db.query(`select 1 from entity where archived_at is null and type = any($1::text[]) limit 1`, [types]);
    if (rows.length) return `Islands would switch off the pack ${pack}, and this map has items of its types: ${why}. Take that pack out, or archive its items, first.`;
  }
  return undefined;
}

/** The live items that live on an island and are on none, with their types, a page at a time: once, when islands are turned on. */
async function unplaced(l: Archipelago): Promise<{ id: string; type: string }[]> {
  const types = [...l.registry.types.values()].filter(livesOnIsland).map((t) => t.id);
  const out: { id: string; type: string }[] = [];
  for (let after = ''; ; ) {
    const { rows } = await l.db.query<{ id: string; type: string }>(
      `select id, type from entity where archived_at is null and props->>'island' is null and type = any($1::text[]) and id > $2 order by id limit ${PAGE}`,
      [types, after],
    );
    out.push(...rows);
    if (rows.length < PAGE) return out;
    after = rows[rows.length - 1].id;
  }
}

/**
 * Move every item on no island onto islands: one for each pack their types are of (the shared set's go on the first),
 * or one speaking core. Each is named after the workspace, with its pack's name when there are several.
 */
export async function moveOntoIslands(l: Archipelago, actor: Actor): Promise<{ islands: number; moved: number }> {
  const items = await unplaced(l);
  if (!items.length) return { islands: 0, moved: 0 };
  const shared = sharedOf(l.registry.packs.filter((p) => KERNEL_PACKS.includes(p.id))).types;
  const packOf = (type: string) => (shared.has(type) ? undefined : l.registry.type(type)?.pack);
  const packs = [...new Set(items.map((i) => packOf(i.type)).filter((p): p is string => Boolean(p)))];
  if (!packs.length) packs.push('core');
  const name = await workspaceName(l.workspace);
  const titleOf = (pack: string) => (packs.length === 1 ? name : `${name}: ${l.registry.packs.find((p) => p.id === pack)?.title ?? pack}`);
  const ops: Op[] = packs.map((pack, i) => ({ op: 'create', ref: `island${i}`, type: ISLAND, title: titleOf(pack), status: 'current', visibility: 'shared', props: { pack } }));
  for (const item of items) ops.push({ op: 'update', id: item.id, props: { island: `{island${Math.max(0, packs.indexOf(packOf(item.type) ?? packs[0]))}}` } });
  await l.change(actor, { reason: 'Islands turned on: what was on the map moves onto islands', ops });
  return { islands: packs.length, moved: items.length };
}

/** A new workspace's first island, named after it and speaking core: made by the server as the workspace is. */
export async function firstIsland(l: Archipelago, name: string): Promise<void> {
  await l.apply('system', { ops: [{ op: 'create', type: ISLAND, title: name, status: 'current', visibility: 'shared', props: { pack: 'core' } }], reason: 'A new workspace starts on islands' });
}
