// An item a public page's picture shows, opened read only beside the page, as the app opens an item over its canvas:
// what was frozen of it when the page was published (its title, its type, where it stands and its first line), and a
// way to close it. Nothing in it changes anything, and nothing is asked of the map: the frozen answer is all there is.

/** What was frozen of item `id` in the page `d`'s pictures, or null when no picture holds it. */
export function frozenItem(d, id) {
  const item = Object.values(d?.lenses ?? {}).flatMap((lens) => lens?.items ?? []).find((i) => i?.id === id);
  return item ? { id, title: item.title, type: d.types?.[item.type] ?? item.type, status: item.status, body: item.gist ?? '', fields: item.fields } : null;
}

/** The sheet for a frozen item as marks; `note(text)` reads its line as the page reads its notes. */
export function sheet(item, note = (t) => t) {
  if (!item) return ['box', { key: 'sheet', look: 'sunk', pad: 6, flow: 'column', gap: 4 }, closer(), ['text', { look: 'muted' }, 'This item cannot be opened here.']];
  const fields = Object.entries(item.fields ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== '');
  return [
    'box',
    { key: 'sheet', item: item.id, look: 'sunk', pad: 6, flow: 'column', gap: 4 },
    ['box', { flow: 'row', align: 'between' }, ['text', { look: 'title', size: 6 }, String(item.title ?? '')], closer()],
    ['text', { look: 'muted' }, [item.type, item.status].filter(Boolean).join(' · ')],
    ...(fields.length ? [['list', { look: 'rows' }, ...fields.map(([k, v]) => ['box', { flow: 'row', gap: 4, align: 'between' }, ['text', { look: 'muted' }, k.replaceAll('_', ' ')], ['text', { tip: String(v).slice(0, 200) }, Array.isArray(v) ? v.join(', ') : String(v)]])]] : []),
    item.body ? ['note', {}, note(item.body)] : ['text', { look: 'muted' }, 'No note.'],
  ];
}

const closer = () => ['button', { key: 'close', look: 'quiet', tip: 'Close' }, '×'];
