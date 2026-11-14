// An item a public page's picture shows, opened read only beside the page, as the app opens an item over its canvas:
// what was frozen of it when the page was published (its title, its type, where it stands, the fields the view carried
// of it and its first line), and a way to close it. Nothing in it changes anything, and nothing is asked of the map: the
// frozen answer is all there is.

const ID = /^e_[a-z0-9]{8}$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})/;
const WEB = /^https?:\/\/\S+$/i;
/** How many characters of words a field's line shows before it is cut; the whole of them is its tip. */
const FOLD = 80;

/** The items the page's pictures froze, each once. */
const itemsOf = (d) => Object.values(d?.lenses ?? {}).flatMap((lens) => lens?.items ?? []);

/** What was frozen of item `id` in the page `d`'s pictures, or null when no picture holds it. */
export function frozenItem(d, id) {
  const all = itemsOf(d);
  const item = all.find((i) => i?.id === id);
  if (!item) return null;
  // The items its fields name, by their names, where the page froze them too.
  const titles = Object.fromEntries(all.filter((i) => ID.test(i?.id ?? '')).map((i) => [i.id, String(i.title ?? '')]));
  return { id, title: item.title, type: d.types?.[item.type] ?? item.type, status: item.status, body: item.gist ?? '', fields: item.fields, titles };
}

/** A field's name as a person reads it, as the item's page in the app says it: no underscores, its first letter up. */
export const label = (name) => {
  const s = String(name ?? '').replaceAll('_', ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
};

const empty = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
const scalar = (v) => v === null || typeof v !== 'object';

/** Words on one line, cut where they run long, the whole of them the tip. */
const line = (s, at = {}) => (s.length > FOLD ? ['text', { tip: s.slice(0, 200), ...at }, `${s.slice(0, FOLD)}…`] : ['text', { tip: s.slice(0, 200), ...at }, s]);

/**
 * One field's value as it reads on the item's page in the app (packs/sheet/parts/page/fields.js), by its shape, as the
 * frozen view carries no field's kind: an item by its name, a day, an address to follow, a number, yes or no, words.
 */
export function valueMarks(v, titles = {}) {
  if (typeof v === 'boolean') return ['text', {}, v ? 'yes' : 'no'];
  if (typeof v === 'number') return ['text', {}, v.toLocaleString()];
  if (Array.isArray(v) && v.every(scalar)) return line(v.map((x) => (ID.test(String(x)) ? (titles[x] ?? 'an item') : String(x ?? '—'))).join(', '));
  if (!scalar(v)) return ['text', { look: 'muted', tip: JSON.stringify(v).slice(0, 200) }, Array.isArray(v) ? `${v.length} ${v.length === 1 ? 'row' : 'rows'}` : Object.keys(v).map(label).join(', ')];
  const s = String(v);
  if (ID.test(s)) return titles[s] ? ['text', { item: s, look: 'mark', tip: titles[s] }, titles[s]] : ['text', { look: 'muted' }, 'an item'];
  if (DAY.test(s) && s.length <= 30) return ['text', { tip: s }, s.slice(0, 10)];
  if (WEB.test(s)) return line(s.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, ''), { href: s, tip: s.slice(0, 200) });
  return line(s);
}

/** The fields the view carried of an item, a row each, as its page in the app draws them; none when it carried none. */
export function fieldsMarks(fields, titles = {}) {
  const held = Object.entries(fields ?? {}).filter(([, v]) => !empty(v));
  if (!held.length) return [];
  return [['box', { key: 'fields', flow: 'column', gap: 2 }, ...held.map(([k, v]) => ['box', { flow: 'row', gap: 3, key: `field-row:${k}` }, ['text', { look: 'muted', tip: label(k) }, label(k)], valueMarks(v, titles)])]];
}

/** The sheet for a frozen item as marks; `note(text)` reads its line as the page reads its notes. */
export function sheet(item, note = (t) => t) {
  if (!item) return ['box', { key: 'sheet', look: 'sunk', pad: 6, flow: 'column', gap: 4 }, closer(), ['text', { look: 'muted' }, 'This item cannot be opened here.']];
  return [
    'box',
    { key: 'sheet', item: item.id, look: 'sunk', pad: 6, flow: 'column', gap: 4 },
    ['box', { flow: 'row', align: 'between' }, ['text', { look: 'title', size: 6 }, String(item.title ?? '')], closer()],
    ['text', { look: 'muted' }, [item.type, item.status].filter(Boolean).join(' · ')],
    item.body ? ['note', {}, note(item.body)] : ['text', { look: 'muted' }, 'No note.'],
    ...fieldsMarks(item.fields, item.titles),
  ];
}

const closer = () => ['button', { key: 'close', look: 'quiet', tip: 'Close' }, '×'];
