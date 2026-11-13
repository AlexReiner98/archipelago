// A page's marks, made as it is published (decision e_rhz4dvpk): the part that fills its slot (publish.doc for a
// document, publish.public for a product) runs once on the server on what the page will hand it (the loader's
// root.part_marks), and what it answers is kept with the page, so a reader with no login draws it frozen and is sent
// no part's code. A part that fails never stops a publish: the page keeps no marks and says why (`marks_error`), and
// its reader is drawn its words plainly (packs/surface/page/frozen-page.js).

import type { KernelContext } from '#pelago/kernel';
import { createHash } from 'node:crypto';

/** Where the page is read, as the part is told: published (anyone, at /p/ or a site), a preview, or one's own read. */
export type ReadAt = { published?: boolean; preview?: boolean; own?: boolean };

/** The marks made lately, by what they were made from: a page read again as it was is not run again. */
const made = new Map<string, Promise<Record<string, unknown>>>();
const MADE_MOST = 100;

/** What a page keeps of its part: its marks, title and sheets, or why it has none. */
export function pageMarks(ctx: Pick<KernelContext, 'call'> & { workspace?: string }, slot: 'page.doc' | 'page.public', page: Record<string, unknown>, at: ReadAt) {
  const input = { page, at: { ...at, frozen: true } };
  const key = createHash('sha256').update(JSON.stringify([ctx.workspace ?? '', slot, input])).digest('hex');
  const kept = made.get(key);
  if (kept) return kept;
  const making = ctx
    .call<unknown, Record<string, unknown> | null>('root.part_marks', { slot, input })
    .then((marks) => (marks ? { marks } : { marks_error: `No part fills ${slot} here.` }), (err) => (made.delete(key), { marks_error: String((err as Error)?.message ?? err).slice(0, 300) }));
  made.set(key, making);
  if (made.size > MADE_MOST) made.delete(made.keys().next().value!);
  return making;
}
