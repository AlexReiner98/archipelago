// Saved canvases (task e_uq77ps44): a flat lens and a style kept on the map as an item of core's `lens` type, so a
// person opens it anywhere and it draws the same. Its id travels in the address beside the lens (`canvas=`, ui/lens.js),
// so what is moved on it goes to its own places (the places stream, under its id, apart from the map's) and the bar
// names it. The bar switches between them and keeps what is up as one; Home lists them, one line each.
// The views kept before the flat lens were translated into such canvases when the workspace opened
// (src/lens-saved.ts); a view kept about an item is listed on Home under the views of items, folded.

import { api, ask, h, tell } from './base.js';
import { flatQuery, flatView } from './lens.js';
import { isA, typeTitle } from './words.js';

const TYPE = 'lens';
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
  if (!got || !isA(got.entity.type, TYPE)) return void location.replace('#/');
  const { lens, style } = canvasLens(got.entity);
  location.replace(`#/v?${flatQuery(lens, style)}`);
}

/**
 * A saved canvas drawn where something brings it in (a document's section, a screen's piece): its lens and style read
 * from the map, drawn with the style of what it is about.
 */
export function keptView(id, { key = `kept:${id}`, style = {} } = {}) {
  const host = h('div', { class: 'lens-wrap' }, h('div', { class: 'empty' }, 'Loading…'));
  host.ready = api('get', { id })
    .then((got) => {
      const kept = canvasLens(got.entity);
      const of = got.outgoing.find((o) => o.type === 'about')?.id;
      // Its steps are played by a drawing that knows them, with what they name drawn too.
      const steps = Array.isArray(got.entity.props?.steps) ? got.entity.props.steps : undefined;
      const told = (steps ?? []).flatMap((s) => [...(s.add ?? []), ...(s.remove ?? []), ...Object.keys(s.titles ?? {}), ...Object.keys(s.fields ?? {}), ...Object.keys(s.flag ?? {})]);
      if (told.length) kept.lens.filter.ids = [...new Set([...(kept.lens.filter.ids ?? []), ...told])];
      // It starts from what it is about, where it draws that; else from the one item it names.
      const ids = kept.lens.filter.ids ?? [];
      const from = ids.includes(of) ? of : ids.length === 1 ? ids[0] : true;
      const view = flatView({ lens: kept.lens, style: { ...kept.style, ...style }, of, key, nest: from, ...(steps && { extra: { steps } }) });
      Object.defineProperty(host, 'answer', { get: () => view.answer, configurable: true });
      host.mark = (here) => view.mark(here);
      host.replaceChildren(view);
      return view.ready;
    })
    .catch((err) => host.replaceChildren(h('div', { class: 'error' }, err.message)));
  return host;
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

/** Home's list: every saved canvas of the workspace, then, folded, those kept as views of an item. */
export async function canvasesPiece(host, title) {
  const [all, kept] = await Promise.all([savedCanvases(true), api('view', { name: 'saved_views' }).catch(() => null)]);
  if (!host.isConnected) return;
  const now = up;
  const ofItem = new Set((kept?.pictures ?? []).filter((p) => p.of && !p.pinned).map((p) => p.lens));
  const [own, items] = [all.filter((c) => !ofItem.has(c.id)), all.filter((c) => ofItem.has(c.id))];
  host.replaceChildren(
    h(
      'section',
      { class: 'card wide canvases', style: 'margin-bottom: var(--space-8); min-width: 0' },
      h('header', {}, h('h2', {}, title)),
      own.length ? h('ul', { class: 'rows' }, own.map((c) => row(c, now))) : h('div', { class: 'empty', title: '☆ in the bar keeps what is up as one' }, 'None saved yet.'),
      items.length > 0 && h('details', { class: 'old-views' }, h('summary', { class: 'muted small', title: 'Canvases kept as views of one item' }, `Views of items (${items.length})`), h('ul', { class: 'rows' }, items.map((c) => row(c, now)))),
    ),
  );
}
