// A document's page as its reader meets it, as marks (task e_atxefw2s): its heading (an invoice's when its style names
// that head), its text and the sections it brings in, in order, each with its picture. The page data is what is
// published (packs/publish/kernel/published.ts runs this part then, and keeps its marks), a preview or a signed-in read
// of the same document; nothing is drawn that it did not say, and every word goes as words. What a page has around it
// as it is served (its site's head and foot, a way to start a map of one's own) is the page's, drawn by the host
// (packs/surface/page/frozen-page.js), since it changes with the site after the page is published.

/** The address word of a site's front page (packs/publish/kernel/site.ts). */
export const FRONT = 'home';

const tip = (said) => String(said ?? '').slice(0, 200);

/** A day as a reader reads it: 13 November 2026. */
export const longDay = (ts) => {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(ts)) ? `${ts}T12:00:00Z` : ts);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-CA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
};
const money = (n, currency = 'CAD') => new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(Number(n) || 0);

/** An invoice's heading: its number, its dates and what is due, and a mark once it is paid or void. */
export function invoiceHead(d) {
  const f = d.fields ?? {};
  const owing = Number(f.total ?? 0) - Number(f.paid ?? 0);
  const fact = (k, v, at = {}) => ['box', { flow: 'row', gap: 4, align: 'between' }, ['text', { look: 'muted' }, k], ['text', at, v]];
  const due = owing > 0 || !f.paid;
  return [
    'box',
    { key: 'head', flow: 'row', gap: 8, align: 'between', wrap: true },
    ['box', { flow: 'column', gap: 1 }, ['text', { look: 'title', size: 7 }, 'Invoice'], ['text', { look: 'muted' }, String(f.number ?? d.title ?? '')]],
    [
      'box',
      { flow: 'column', gap: 1 },
      ...(f.issued ? [fact('Issued', longDay(f.issued))] : []),
      ...(f.due ? [fact('Due', longDay(f.due))] : []),
      ...(f.paid > 0 && owing > 0 ? [fact('Paid', money(f.paid))] : []),
      fact(due ? 'Total due' : 'Total', money(due ? owing || f.total : f.total), { bold: true }),
    ],
    ...(d.status === 'paid' ? [['text', { look: 'mark', tone: 'ok', size: 6 }, 'Paid']] : d.status === 'void' ? [['text', { look: 'mark', tone: 'bad', size: 6 }, 'Void']] : []),
  ];
}

/** The heads a style may give a page (page.head), by name: each draws the heading and says the page's title. */
export const HEADS = {
  invoice: { draw: invoiceHead, title: (d) => (d.fields?.number ? `${d.fields.number} ${String(d.title).replace(/^Invoice [^:]*:\s*/, '')}` : d.title) },
};
export const headOf = (d) => (Object.hasOwn(HEADS, d?.head ?? '') ? HEADS[d.head] : null);

/** The plain heading: the title, and when it was published or last changed. */
const plainHead = (d) => ['box', { key: 'head', flow: 'column', gap: 1 }, ['text', { look: 'title', size: 8 }, String(d.title ?? '')], ['text', { look: 'muted' }, d.published_at ? `Published ${longDay(d.published_at)}` : d.updated_at ? `Updated ${longDay(d.updated_at)}` : '']];

/**
 * The text of a page's note with each id it knows written as a way to it, in the dialect the note mark reads: a section
 * of the page by its name, another published page by its title. Ids it does not know are left as they are.
 */
export function named(text, names) {
  return String(text ?? '').replace(/(\[[^\]]*\]\()?\b(e_[a-z0-9]{8})\b/g, (all, linked, id) => (linked || !names.has(id) ? all : `[${String(names.get(id)).replace(/[[\]]/g, '')}](${id})`));
}

/** The page as marks. `d` is the page data. */
export function page(d) {
  if (!d || !Array.isArray(d.parts)) return ['text', { look: 'muted' }, 'This page does not open anything.'];
  const names = new Map([...d.parts.filter((p) => p.section).map((p) => [p.section.id, p.section.title]), ...Object.entries(d.links ?? {})]);
  const head = headOf(d);
  // The section the style names for the page's picture (page.share) is shown where its address is posted, not here.
  const list = d.parts.filter((p) => !p.section || p.section.id !== d.share);
  const first = d.parts.find((p) => p.section)?.section;
  // A front page whose first section is a figure opens on it, with no title over it (its title is its words).
  const lead = d.path === FRONT && first?.picture && !d.lenses?.[first.id] ? first.id : null;
  // A page that is one item alone has its title once, over the page.
  const alone = d.parts.length === 1 && first?.title === d.title ? first.id : null;
  const part = (p, i) => {
    if (!p.section) return ['note', { key: `text:${i}` }, named(p.text, names)];
    const s = p.section;
    return [
      'box',
      { key: `s:${s.id}`, item: s.id, flow: 'column', gap: 3 },
      ...(s.id !== lead && s.id !== alone ? [['text', { look: 'title', size: 6 }, String(s.title ?? '')]] : []),
      // A lens is its picture, as it was frozen when the page was published; otherwise a section shows its figure.
      ...(d.lenses?.[s.id] || s.picture ? [['picture', { key: `p:${s.id}`, item: s.id, tip: tip(s.title) }]] : []),
      ...(s.body ? [['note', { key: `n:${s.id}` }, named(s.body, names)]] : []),
    ];
  };
  // A picture that plays stands beside the words before it, in a band of the page; everything else keeps to the column.
  const plays = (p) => Boolean(p?.section && d.lenses?.[p.section.id]?.steps);
  const parts = [];
  for (let k = 0; k < list.length; k++) {
    if (list[k].section || !plays(list[k + 1])) {
      parts.push(part(list[k], k));
      continue;
    }
    const words = part(list[k], k);
    const pictures = [];
    while (plays(list[k + 1])) pictures.push(part(list[++k], k));
    parts.push(['box', { key: `band:${k}`, flow: 'row', gap: 8, wrap: true }, ['box', { flow: 'column', grow: true }, words], ['box', { flow: 'column', gap: 6, grow: true }, ...pictures]]);
  }
  return ['box', { key: 'page', flow: 'column', gap: 8 }, head ? head.draw(d) : plainHead(d), ...parts];
}

/** The page's title, as the browser names its tab. */
export const titleOf = (d) => (headOf(d) ? headOf(d).title(d) : String(d?.title ?? 'Document'));
