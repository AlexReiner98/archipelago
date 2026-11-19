// The one way a pack file comes onto the map: its manifest is read against the map's items of that pack, and what
// that comes to (merge.js) is answered as ops, applied through the one write path as a change of whoever sent it,
// held or applied as core's rules say. What both the owner and the pack changed comes back as changes of their own,
// which this pack's rule both_changed holds for the owner.

import { plan } from './merge.js';
import { PACK_TYPE } from './shape.js';

/** Reads an answer's rows, paged or not. */
const rows = (found) => (Array.isArray(found) ? found : Array.isArray(found?.rows) ? found.rows : []);

/** The map's items of a pack: its item and everything part of it. */
async function itemsOf(id, ctx) {
  const packs = rows(await ctx.read({ items: { type: PACK_TYPE, where: { name: id } } }));
  if (!packs.length) return [];
  if (packs.length > 1) throw new Error(`the map keeps ${packs.length} items for the pack ${id}: merge them first`);
  return rows(await ctx.read({ parts_of: [packs[0].id] }));
}

export default {
  'pack_install.install': async (input, ctx) => {
    const manifest = input?.manifest;
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('manifest is the pack file, as an object');
    const runs = input.runs && typeof input.runs === 'object' && !Array.isArray(input.runs) ? input.runs : {};
    const done = plan(manifest, await itemsOf(String(manifest.id ?? ''), ctx), runs);
    return { ops: done.ops, reason: done.reason, changes: done.changes, answer: done.summary };
  },
};
