// The loader root's service root.part_marks (decision e_rhz4dvpk): the marks the part filling a page slot answers on
// what that page would hand it, made on the server and checked as the host checks them, so a page read with no login
// draws them frozen and no part's code goes to its reader. The publish pack asks it as a document is published or
// shared (and for a preview, a read with a sign-in, a product's page), and keeps what it answers with the page.
//
// As root.scene runs only a drawing a pack ships, this runs only a part as its pack ships it on this server, found in
// the map's registry by the slot it fills, in a sandboxed process of its own (../../walls/kernel/part-box.ts): a part's
// version kept on the map is code anyone who may change the map wrote, and runs only walled in a reader's browser.

import { join } from 'node:path';
import type { RootCall } from './root-calls.ts';
import { checkedMarks as checked, runPartOnce } from '../../walls/kernel/part-box.ts';
import { partsOf } from './ui-parts.ts';

/** The slots whose marks are kept with a page: the pages read with no login. */
export const FROZEN_SLOTS = ['page.doc', 'page.public'];
/** The most items a page keeps a sheet for: more than any page's pictures hold. */
const SHEETS_MOST = 500;
const ITEM = /^e_[a-z0-9]{8}$/;

export type PartMarks = { part: string; marks: unknown; title?: string; sheets?: Record<string, unknown> };

/**
 * root.part_marks: what the part filling `slot` answers on `input`, its marks checked against the marks it names, and
 * the sheet it would open for each item it names (`sheets`), each checked too; null when no part ships for that slot.
 * Throws what the part threw, or why its marks cannot be drawn.
 */
export async function partMarks(call: RootCall, input: { slot: string; input: unknown }): Promise<PartMarks | null> {
  if (!call.map) throw new Error('A part is run for a map: a server duty has none');
  if (!FROZEN_SLOTS.includes(String(input?.slot))) throw new Error(`Only a page read with no login keeps its marks: ${FROZEN_SLOTS.join(', ')}.`);
  const reg = call.map.registry;
  const part = partsOf(reg.packs).find((p) => p.slot === input.slot);
  const entry = part?.modules?.['index.js'];
  if (!part || !entry) return null;
  const drawn = await runPartOnce(join(reg.folderOf(part.pack), entry), input.input ?? null);
  const kinds = part.marks ?? [];
  const sheets = drawn.sheets && typeof drawn.sheets === 'object' && !Array.isArray(drawn.sheets) ? Object.entries(drawn.sheets as Record<string, unknown>).filter(([id]) => ITEM.test(id)).slice(0, SHEETS_MOST) : [];
  return {
    part: part.id,
    marks: checked(drawn.marks, kinds),
    ...(drawn.title && { title: String(drawn.title).slice(0, 300) }),
    ...(sheets.length && { sheets: Object.fromEntries(sheets.map(([id, m]) => [id, checked(m, kinds)])) }),
  };
}
