// Saved canvases (task e_uq77ps44): a flat lens and a style kept on the map as an item of core's `canvas` type, so a
// person opens it anywhere and it draws the same. Its id travels in the address beside the lens (`canvas=`, ui/lens.js),
// so what is moved on it goes to its own places (the places stream, under its id, apart from the map's) and the bar
// names it. The bar switches between them and keeps what is up as one; Home lists them, one line each.
//
// The views kept before the flat lens (items of type `lens`) stay as they were, read by the old lens; Home offers
// each whose fields say a filter (an item it is drawn from, or types) to be kept as a canvas, translated once.

import { api, ask, h, tell } from './base.js';
import { flatQuery } from './lens.js';
import { typeTitle } from './words.js';

const TYPE = 'canvas';
/** The saved canvases, pinned first, then by name: so a switch keeps its order as they change. */
let known = null;
export function savedCanvases(fresh = false) {
  if (fresh || !known)
    known = api('search', { type: TYPE, open: true, limit: 200 })
      .then((rows) => rows.sort((a, b) => Number(b.props?.pinned === true) - Number(a.props?.pinned === true) || a.title.localeCompare(b.title)))
      .catch(() => []);
  return known;
}

/** What a saved canvas draws: its filter with its pins, its walk and its limit; and its style, with its own id. */
export function canvasLens(item) {
  const p = item.props ?? {};
  const filter = { ...(p.filter ?? {}) };
  const ids = [...new Set([...(filter.ids ?? []), ...(Array.isArray(p.pins) ? p.pins : [])])];
  if (ids.length) filter.ids = ids;
  const lens = { filter, walk: p.walk ?? { over: [], steps: 0 }, ...(p.limit && { limit: p.limit }) };
  return { lens, style: { ...(p.style ?? {}), canvas: item.id } };
}

/** Where a saved canvas opens: the address names it, and its lens is read from the map when it is opened. */
export const canvasAt = (id) => `#/v?canvas=${id}`;

/** Open a saved canvas named with no lens beside it: its lens and style put in the address, in place of the one asked. */
export async function openCanvas(id) {
  const got = await api('get', { id }).catch(() => null);
  if (!got || got.entity.type !== TYPE) return void location.replace('#/');
  const { lens, style } = canvasLens(got.entity);
  location.replace(`#/v?${flatQuery(lens, style)}`);
}

/** The style a canvas keeps: how it is drawn, not which canvas it is. */
const keptStyle = (style) => Object.fromEntries(['shape', 'lit', 'style'].filter((k) => style?.[k]).map((k) => [k, style[k]]));
/** Whether what is up differs from what the canvas keeps. */
const edited = (item, lens, style) => {
  const kept = canvasLens(item);
  return flatQuery(kept.lens, keptStyle(kept.style)) !== flatQuery(lens, keptStyle(style));
};

/** Keep what is up as a saved canvas: a name asked in the page; the name of one kept already updates it. */
async function save(lens, style, current) {
  const all = await savedCanvases();
  const name = await ask({ title: 'Save this canvas', message: current ? `Its name: left empty, “${current.title}” is updated.` : 'Its name.', input: { placeholder: current?.title ?? 'A name, a few words' }, action: 'Save' });
  if (name === null) return;
  const title = name || current?.title;
  if (!title) return tell('Not saved', 'A canvas needs a name.');
  if (title.length > 60) return tell('Not saved', 'A name is a few words: 60 characters at most.');
  const { filter, walk, limit } = lens;
  const props = { filter, walk, limit: limit ?? null, style: keptStyle(style) };
  const same = all.find((c) => c.title.toLowerCase() === title.toLowerCase());
  const made = same
    ? await api('change', { ops: [{ op: 'update', id: same.id, props: { ...props, pins: null } }], reason: 'Saved from the query bar' })
    : await api('change', { ops: [{ op: 'create', ref: 'canvas', type: TYPE, title, props }], reason: 'Saved from the query bar' });
  const id = same?.id ?? made.created?.canvas;
  savedCanvases(true);
  if (id) location.hash = `#/v?${flatQuery(lens, { ...style, canvas: id })}`;
}

/** The saved canvas the canvas draws now, if one is: Home marks it. */
let up = null;

/** The canvas up, in the bar: a switch to every saved one (the current named, marked when changed since), and Save. */
export function canvasSwitch(lens, style, isHome) {
  up = style.canvas ?? null;
  const part = h('span', { class: 'q-part q-canvas', title: 'The saved canvas up: switch to another, or save this one' });
  savedCanvases().then((all) => {
    const current = style.canvas && all.find((c) => c.id === style.canvas);
    const changed = current && edited(current, lens, style);
    const pick = h(
      'select',
      { class: 'q-pick', 'aria-label': 'Saved canvases', title: current ? (changed ? `${current.title}: changed since it was saved` : current.title) : 'Not a saved canvas', onchange: (ev) => ev.target.value && (location.hash = ev.target.value) },
      !current && !isHome && h('option', { value: '', selected: true }, 'Not saved'),
      h('option', { value: '#/', selected: isHome && !current }, 'Home'),
      all.map((c) => h('option', { value: canvasAt(c.id), selected: c === current }, `${c.title}${c === current && changed ? ' •' : ''}`)),
    );
    part.replaceChildren(pick, h('button', { type: 'button', class: 'q-save', title: current ? `Save: update “${current.title}”, or keep it as a new one` : 'Save this canvas', 'aria-label': 'Save this canvas', onclick: () => save(lens, style, current) }, '☆'));
  });
  return part;
}

// ---- Home: the saved canvases, one line each, opening in one click -------------------------------------------

/** What a lens finds, in a few words: its terms, then its walk. */
function lensWords(lens) {
  const f = lens.filter ?? {};
  const said = [f.text && `“${f.text}”`, ...(f.types ?? []).map(typeTitle), f.ids?.length && `${f.ids.length} item${f.ids.length === 1 ? '' : 's'}`, ...(f.links ?? [])].filter(Boolean);
  const over = lens.walk?.over;
  if (over === 'all' || over?.length) said.push(`${over === 'all' ? 'every link' : over.join(', ').replaceAll('_', ' ')} × ${lens.walk.steps}`);
  return said.join(' · ');
}

const row = (c, now) =>
  h(
    'li',
    { class: 'row-top nowrap-row' },
    h('a', { class: 'gist', href: canvasAt(c.id), title: c.title }, c.title),
    h('span', { class: 'muted small gist', title: lensWords(canvasLens(c).lens) }, lensWords(canvasLens(c).lens)),
    c.props?.pinned === true && h('span', { class: 'pill', title: 'Pinned' }, 'pinned'),
    c.id === now && h('span', { class: 'pill ok', title: 'The canvas up now' }, 'up'),
  );

/** A view kept before the flat lens, as a canvas: what it is drawn from (or the types it keeps), its links walked. Null when its fields say no filter. */
export function fromOldView(item, of) {
  const x = item.props ?? {};
  const ids = [x.from ?? of?.id].filter(Boolean);
  const kinds = Array.isArray(x.kinds) ? x.kinds : [];
  // Types said of a view from an item kept what was in it; in a flat filter they would add every such item, so they go.
  const types = ids.length ? [] : kinds.filter((k) => !k.startsWith('-'));
  if (!ids.length && !types.length) return null;
  const exclude = [...new Set(['system', ...(Array.isArray(x.fold) ? x.fold.filter((f) => f === 'closed') : []), ...kinds.filter((k) => k.startsWith('-')).map((k) => k.slice(1))])];
  const over = x.over === 'all' ? 'all' : [...new Set([...(ids.length ? [x.by ?? 'part_of'] : []), ...(Array.isArray(x.over) ? x.over : [])])];
  const steps = over === 'all' || over.length ? Math.min(Math.max(Number(x.far) || 1, 1), 6) : 0;
  return { filter: { ...(ids.length && { ids }), ...(types.length && { types }), exclude }, walk: { over, steps } };
}

/** Keep an old view as a canvas, under its name, and open it. */
async function keepOld(p) {
  const got = await api('get', { id: p.lens }).catch(() => null);
  const lens = got && fromOldView(got.entity, p.of);
  if (!lens) return tell('Not kept', 'Its fields say nothing a flat lens can find.');
  const made = await api('change', { ops: [{ op: 'create', ref: 'canvas', type: TYPE, title: p.title.slice(0, 60), props: { ...lens, style: p.shape ? { shape: p.shape } : {} } }], reason: `Kept the view “${p.title}” as a canvas` });
  savedCanvases(true);
  if (made.created?.canvas) location.hash = canvasAt(made.created.canvas);
}

/** Home's list: every saved canvas, then, folded, the views from before that can be kept as one. */
export async function canvasesPiece(host, title) {
  const [all, old] = await Promise.all([savedCanvases(true), api('view', { name: 'saved_views' }).catch(() => null)]);
  if (!host.isConnected) return;
  const now = up;
  const names = new Set(all.map((c) => c.title.toLowerCase()));
  const offered = (old?.pictures ?? []).filter((p) => !names.has(p.title.toLowerCase()));
  const oldRow = (p) => h('li', { class: 'row-top nowrap-row' }, h('span', { class: 'gist', title: p.title }, p.title), h('button', { class: 'quiet-button', title: 'Keep it as a saved canvas: what it is drawn from, its links walked', onclick: () => keepOld(p) }, 'Keep'));
  host.replaceChildren(
    h(
      'section',
      { class: 'card wide canvases', style: 'margin-bottom: var(--space-8); min-width: 0' },
      h('header', {}, h('h2', {}, title)),
      all.length ? h('ul', { class: 'rows' }, all.map((c) => row(c, now))) : h('div', { class: 'empty', title: '☆ in the bar keeps what is up as one' }, 'None saved yet.'),
      offered.length > 0 && h('details', { class: 'old-views' }, h('summary', { class: 'muted small', title: 'Views kept before the canvas: each can be kept as a saved canvas' }, `Views from before (${offered.length})`), h('ul', { class: 'rows' }, offered.map(oldRow))),
    ),
  );
}
