// What an item's sheet offers for what goes out of the map, as the publish pack's part on item.menu (task e_atxefw2s):
// the item's public view opened apart and its address to copy, and a document printed or saved as a PDF. It reads the
// view `shared` (packs/publish/kernel/share-read.ts) and the page's origin it is handed, and answers with marks alone.
// Sharing, sharing again and taking down are a person's own acts, which no part sends (decision e_3mdf9gn8): those
// stay in the sheet's own menu (packs/surface/page/item-share.js).

const ITEM = /^e_[a-z0-9]{8}$/;
const PATH = /^\/[A-Za-z0-9/_-]*$/;
/** The page's origin as it was handed: an address on the web, or nothing. */
const originOf = (o) => (typeof o === 'string' && /^https?:\/\/[^/\s"'<>\\]+$/i.test(o) ? o : null);

/** The marks for the item `id`, given what `shared` read of it and the page's `origin`. */
export function marks(id, shared, origin) {
  const at = originOf(origin);
  if (!at || !ITEM.test(id ?? '')) return ['box', {}];
  const address = typeof shared?.address === 'string' && PATH.test(shared.address) ? `${at}${shared.address}` : null;
  return [
    'box',
    { flow: 'row', gap: 4, align: 'end' },
    ...(address
      ? [
          ['text', { key: 'public', look: 'muted', href: address, tip: 'Its public view, frozen as it was shared: open it apart' }, '◉ Public view'],
          ['button', { key: 'copy', look: 'quiet', copy: address, tip: 'Copy the address anyone may open' }, 'Copy its address'],
        ]
      : []),
    ...(shared?.document ? [['text', { key: 'print', look: 'muted', href: `${at}/read/${id}`, tip: 'Read it whole, to print or save as a PDF' }, 'Print']] : []),
  ];
}

export default function share(input) {
  let now = input;
  const draw = () => marks(now?.item?.id, now?.views?.shared, now?.origin);
  return {
    marks: draw(),
    update(next) {
      now = next;
      return draw();
    },
  };
}
