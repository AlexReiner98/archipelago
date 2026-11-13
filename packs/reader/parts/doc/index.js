// The reader's page, as the reader pack's part (task e_atxefw2s): a document given as a link or made public, read with
// no login, its text and the sections it brings in, in order (./page.js); and an item one of its pictures shows,
// opened read only in a sheet beside it (./sheet.js). It fills the host's page.doc. It is handed the page's data
// (`page`) and where it is read (`at`: own, published, preview, origin), and answers with marks alone: the host draws
// each picture out of the data it handed, and keeps what only a page can do (its theme and page_css, printing, the
// words a followed link carries).

import { named, page, titleOf } from './page.js';
import { frozenItem, sheet } from './sheet.js';

/** The page's data and where it is read, from what the host handed. */
const read = (input) => ({ d: input?.page ?? input?.views?.page ?? null, at: input?.at ?? {} });

/** The marks for the page, with the item open beside it, if one is. */
export function marks(d, at, open) {
  const drawn = page(d, at);
  if (!open || !d) return drawn;
  const names = new Map((d.parts ?? []).filter((p) => p.section).map((p) => [p.section.id, p.section.title]));
  return ['box', { flow: 'column', gap: 6 }, sheet(frozenItem(d, open), (t) => named(t, names)), drawn];
}

export default function doc(input) {
  let { d, at } = read(input);
  let open = null;
  const draw = () => marks(d, at, open);
  return {
    marks: draw(),
    title: titleOf(d),
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
