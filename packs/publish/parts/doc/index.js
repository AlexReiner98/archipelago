// A document's page, as the publish pack's part (tasks e_atxefw2s, e_y5bsveva): a document given as a link or made public, its text
// and the sections it brings in, in order (./page.js); and an item one of its pictures shows, opened read only in a
// sheet beside it (./sheet.js). It fills the host's page.doc. It is handed the page's data (`page`) and where it is
// read (`at`), and answers with marks alone: the host draws each picture out of the data it handed, and keeps what only
// a page can do (its theme and page_css, its site's head and foot, printing, the words a followed link carries).
//
// Run on the server as the page is published (`at.frozen`, packs/loader/kernel/part-marks.ts), it answers its marks
// once, with its title and the sheet of every item its pictures froze (`sheets`): a reader with no login is drawn
// those, and is sent none of this code (decision e_rhz4dvpk).

import { named, page, titleOf } from './page.js';
import { frozenItem, sheet } from './sheet.js';

/** The most items a page keeps a sheet for. */
const SHEETS_MOST = 500;

/** The page's data and where it is read, from what the host handed. */
const read = (input) => ({ d: input?.page ?? input?.views?.page ?? null, at: input?.at ?? {} });

/** The page's section titles, by id: what a note names. */
const namesOf = (d) => new Map((d?.parts ?? []).filter((p) => p.section).map((p) => [p.section.id, p.section.title]));

/** The marks for the page, with the item open beside it, if one is. */
export function marks(d, open) {
  const drawn = page(d);
  if (!open || !d) return drawn;
  const names = namesOf(d);
  return ['box', { flow: 'column', gap: 6 }, sheet(frozenItem(d, open), (t) => named(t, names)), drawn];
}

/** The sheet of every item the page's pictures froze, by id. */
export function sheetsOf(d) {
  const names = namesOf(d);
  const ids = [...new Set(Object.values(d?.lenses ?? {}).flatMap((lens) => (lens?.items ?? []).map((i) => i?.id)))].filter((id) => /^e_[a-z0-9]{8}$/.test(id ?? ''));
  return Object.fromEntries(ids.slice(0, SHEETS_MOST).map((id) => [id, sheet(frozenItem(d, id), (t) => named(t, names))]));
}

export default function doc(input) {
  let { d, at } = read(input);
  let open = null;
  const draw = () => marks(d, open);
  return {
    marks: draw(),
    title: titleOf(d),
    ...(at.frozen && d && { sheets: sheetsOf(d) }),
    update(next) {
      ({ d, at } = read(next));
      if (open && !frozenItem(d, open)) open = null;
      return draw();
    },
    on(event) {
      // An item a picture shows, pressed, opens beside the page, when the page froze it; the sheet closes as asked.
      if (event?.name === 'open' && /^e_[a-z0-9]{8}$/.test(event.item ?? '') && frozenItem(d, event.item) && (at.published || d.site)) return ((open = event.item), draw());
      if ((event?.name === 'press' && event.key === 'close') || (event?.name === 'key' && event.key === 'Escape' && open)) return ((open = null), draw());
      return undefined;
    },
  };
}
