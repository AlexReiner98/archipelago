// Saved canvases (task e_uq77ps44): a flat lens and a style kept on the map as an item of core's `lens` type, so a
// person opens it anywhere and it draws the same. Its id travels in the address beside the lens (`canvas=`, ui/query.js),
// so what is moved on it goes to its own places (the places stream, under its id, apart from the map's) and the bar
// names it. The bar switches between them and keeps what is up as one; Home lists them, one line each.
// The views kept before the flat lens were translated into such canvases when the workspace opened
// (src/query-saved.ts); a view kept about an item is listed on Home under the views of items, folded.

import { api, ask, h, hooks, idsOf, state, tell, wordsOf, withIds } from './base.js';
import { addressOf, flatView } from './query.js';
import { filterSaid, fitBar } from './query-bar.js';
import { canvasMenu } from './canvas-menu.js';
import { lookSwitch, styleDelete } from './look-switch.js';
import { ARROW, isA, typeTitle, wayOf } from './words.js';

const TYPE = 'lens';
/**
 * The saved canvases, pinned first, then by name: so a switch keeps its order as they change. The packs' canvases
 * (presets, decision e_x8bghuce) are among them, each until the owner keeps a version of it (props.preset), which
 * stands in its place; a preset kept is not on the map, so it has no id of its own to open by (`preset` says so).
 */
let known = null;
export function savedCanvases(fresh = false) {
  if (fresh || !known)
    known = api('search', { type: TYPE, open: true, limit: 200 })
      .catch(() => [])
      .then((rows) => {
        const kept = new Set(rows.map((r) => r.props?.preset).filter(Boolean));
        const offered = (state.schema?.canvases ?? []).filter((p) => !kept.has(p.id)).map((p) => ({ id: p.id, title: p.title, preset: true, props: { ...p.props, preset: p.id } }));
        return [...rows, ...offered].sort((a, b) => Number(b.props?.pinned === true) - Number(a.props?.pinned === true) || a.title.localeCompare(b.title));
      });
  return known;
}

/** What a saved canvas draws: its filter with its pins, its walk and its limit; and its style, with its own id. */
export function viewParts(item) {
  const p = item.props ?? {};
  const filter = withIds(p.filter ?? {}, Array.isArray(p.pins) ? p.pins : []);
  const lens = { ...(p.view && { view: p.view }), filter, walk: p.walk ?? { over: [], steps: 0 }, ...(p.limit && { limit: p.limit }), ...(p.time && { time: p.time }) };
  return { lens, style: { ...(p.style ?? {}), ...(!item.preset && { canvas: item.id }) } };
}

/** Where a saved canvas opens: the address names it, and its lens is read from the map when it is opened; a pack's, by its lens. */
export const canvasAt = (c) => (c.preset ? `#/v?${addressOf(viewParts(c).lens, viewParts(c).style)}` : `#/v?canvas=${c.id}`);
/** The saved canvas up: the one the address names, else a pack's whose lens is the one up (its style changed, it is marked so). */
const upOf = (all, lens, style) => (style.canvas ? all.find((c) => c.id === style.canvas) : all.find((c) => c.preset && addressOf(viewParts(c).lens) === addressOf(lens)));

/** Open a saved canvas named with no lens beside it: its lens and style put in the address, in place of the one asked. */
export async function openCanvas(id) {
  const got = await api('get', { id }).catch(() => null);
  if (!got || !isA(got.entity.type, TYPE)) return void location.replace('#/');
  const { lens, style } = viewParts(got.entity);
  location.replace(`#/v?${addressOf(lens, style)}`);
}

/**
 * A saved canvas drawn where something brings it in (a document's section, a screen's piece): its lens and style read
 * from the map, drawn with the style of what it is about.
 */
export function keptView(id, { key = `kept:${id}`, style = {} } = {}) {
  const host = h('div', { class: 'lens-wrap' }, h('div', { class: 'empty' }, 'Loading…'));
  host.ready = api('get', { id })
    .then((got) => {
      const kept = viewParts(got.entity);
      const of = got.outgoing.find((o) => o.type === 'about')?.id;
      // Its steps are played by a drawing that knows them, with what they name drawn too.
      const steps = Array.isArray(got.entity.props?.steps) ? got.entity.props.steps : undefined;
      const told = (steps ?? []).flatMap((s) => [...(s.add ?? []), ...(s.remove ?? []), ...Object.keys(s.titles ?? {}), ...Object.keys(s.fields ?? {}), ...Object.keys(s.flag ?? {})]);
      if (told.length) kept.lens.filter = withIds(kept.lens.filter, told);
      // It starts from what it is about, where it draws that or what is in it (in it, within it, or the end of a link term); else from the one item it names.
      const ids = idsOf(kept.lens.filter);
      const ends = [...(kept.lens.filter.find ?? []), ...(kept.lens.filter.only ?? [])].filter((t) => !/^(id|text|type|kind) /.test(t)).map((t) => t.split(/\s+/).slice(1).join(' '));
      const from = ids.includes(of) || ends.includes(of) ? of : ids.length === 1 ? ids[0] : true;
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
  const kept = viewParts(item);
  return addressOf(kept.lens, keptStyle(kept.style)) !== addressOf(lens, keptStyle(style));
};

/** A view's own settings: what it holds beyond the layout and style the bar switches, kept through a Save. */
const settingsOf = (item) => {
  const { shape: _s, lit: _l, style: _k, ...settings } = item?.props?.style ?? {};
  return settings;
};

/** Keep what is up: into the view up, at once; else, or with `fresh` (Save as new view), under a name asked in the page. */
async function save(lens, style, current, open, fresh = false) {
  const all = await savedCanvases();
  const title = current && !fresh ? current.title : await ask({ title: 'Save this view', message: 'Its name.', input: { placeholder: 'A name, a few words' }, action: 'Save' });
  if (title === null) return;
  if (!title) return tell('Not saved', 'A view needs a name.');
  if (title.length > 60) return tell('Not saved', 'A name is a few words: 60 characters at most.');
  const { filter, walk, limit, time } = lens;
  // A pack's view saved under its own name is the owner's version of it, standing in its place.
  const props = { filter, walk, limit: limit ?? null, time: time ?? null, style: { ...settingsOf(current), ...keptStyle(style) }, ...(current?.preset && title === current.title && { preset: current.id }) };
  const same = all.find((c) => !c.preset && c.title.toLowerCase() === title.toLowerCase());
  const made = same
    ? await api('change', { ops: [{ op: 'update', id: same.id, props: { ...props, pins: null } }], reason: 'Saved from the query bar' })
    : await api('change', { ops: [{ op: 'create', ref: 'canvas', type: TYPE, title, props }], reason: 'Saved from the query bar' });
  const id = same?.id ?? made.created?.canvas;
  savedCanvases(true);
  if (id) open(`#/v?${addressOf(lens, { ...style, canvas: id })}`);
}

/** Delete a saved canvas, after asking: it is retired (a lens's closed status), so it leaves the bar and Home and can
 *  be used again from its page. What is up stays, no longer saved. */
async function drop(lens, style, current, open) {
  if (!(await ask({ title: `Delete “${current.title}”?`, message: 'It leaves the bar and Home. What is up stays, unsaved.', action: 'Delete', danger: true }))) return;
  try {
    await api('change', { ops: [{ op: 'update', id: current.id, status: 'retired' }], reason: 'Deleted from the query bar' });
  } catch (err) {
    return tell('Not deleted', err.message);
  }
  savedCanvases(true);
  const { canvas: _c, ...rest } = style;
  open(`#/v?${addressOf(lens, rest)}`);
}

/** A mark drawn in the colour of what holds it, at the size of its text, from its strokes. */
function drawnMark(...strokes) {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => Object.entries(attrs).reduce((e, [k, v]) => (e.setAttribute(k, v), e), document.createElementNS(NS, tag));
  const svg = el('svg', { viewBox: '0 0 16 16', class: 'q-mark', 'aria-hidden': 'true' });
  svg.append(...strokes.map((d) => el('path', { d })));
  return svg;
}
const dot = (x, y, r = 2) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
/** Save's mark: a disk. */
const saveMark = () => drawnMark('M2.5 2.5h9l2 2v9h-11z', 'M5 2.5v3.5h5v-3.5', 'M5 13.5v-4h6v4');
/** Delete's mark: a bin. */
const binMark = () => drawnMark('M2.5 4h11', 'M6 4v-1.5h4v1.5', 'M4 4l.8 9.5h6.4l.8-9.5', 'M6.7 6.5v4.5', 'M9.3 6.5v4.5');
/** The canvas picker's mark: three items and the links between them. */
const canvasMark = () => drawnMark(dot(4, 12), dot(12, 4), dot(12, 12), 'M5.5 10.5l5-5', 'M6 12h4');
/** The style picker's mark: a palette with its paints, and a brush beside it. */
const styleMark = () =>
  drawnMark(
    'M6.5 1.5a5.5 5.5 0 1 0 0 11c.7 0 1.1-.4 1.1-1s-.5-.8-.5-1.4.5-1 1.1-1h.8a3 3 0 0 0 3-3c0-2.6-2.4-4.6-5.5-4.6z',
    dot(3.9, 7.2, 0.6), dot(5, 4.4, 0.6), dot(8, 4, 0.6),
    'M15.4 6l-3.2 5.8',
    'M12.2 11.8c-.8 0-1.4.6-1.4 1.3 0 .5-.3.8-.8 1 1.5.4 2.9-.4 2.9-1.6',
  );

/** The saved canvas the canvas draws now, if one is: Home marks it. */
let up = null;

/** The canvas up, in the bar: a switch to every saved one (the current named, marked when changed since), and Save. `open` goes to an address (a pane's own, ui/panes.js). */
export function canvasSwitch(lens, style, isHome, open = (href) => (location.hash = href)) {
  up = style.canvas ?? null;
  const part = h('span', { class: 'q-part q-canvas', title: 'The view up: switch to another, or save this one' });
  savedCanvases().then((all) => {
    const current = upOf(all, lens, style);
    const changed = current && edited(current, lens, style);
    const pick = h(
      'select',
      { class: 'q-pick', 'aria-label': 'Saved views', title: current ? (changed ? `${current.title}: changed since it was saved` : current.title) : 'Not saved: Save keeps it', onchange: (ev) => ev.target.value && open(ev.target.value) },
      // Not saved, it is named as its tab and its pane are: by what its filter finds.
      !current && !isHome && h('option', { value: '', selected: true }, filterSaid(lens.filter, () => {}) || 'View'),
      h('option', { value: '#/', selected: isHome && !current }, 'Home'),
      all.map((c) => h('option', { value: canvasAt(c), selected: c === current }, `${c.title}${c === current && changed ? ' •' : ''}`)),
    );
    // In a browser's order: back and forward, then the canvas up, as its address, and its style, with Save beside them, Split, and the canvas's menu at the end.
    const own = hooks.paneButtons?.() ?? [];
    const travel = own.filter((b) => b.classList.contains('q-travel'));
    // Each picker marked before it, its tooltip saying what it is.
    const named = (mark, title) => h('span', { class: 'q-label q-pick-label', title, 'aria-hidden': 'true' }, mark);
    part.replaceChildren(...travel, named(canvasMark(), 'View: the saved view up'), pick, named(styleMark(), 'Layout: how this view is arranged'), lookSwitch(lens, style, open), h('button', { type: 'button', class: 'q-save q-word', title: current ? (changed ? `Save the changes to “${current.title}”` : `“${current.title}” is saved`) : 'Save this view', 'aria-label': 'Save this view', ...(current && !changed && !current.preset && { disabled: true }), onclick: () => save(lens, style, current, open) }, saveMark(), h('span', { class: 'q-word-text' }, changed ? 'Save •' : 'Save')), ...(current && !current.preset ? [h('button', { type: 'button', class: 'q-save q-delete', title: `Delete “${current.title}”`, 'aria-label': 'Delete this saved view', onclick: () => drop(lens, style, current, open) }, binMark())] : []), ...own.filter((b) => !travel.includes(b)), canvasMenu([current && { text: 'Save as new view', title: 'Keep what is up as a view of its own', act: () => save(lens, style, current, open, true) }, styleDelete(lens, style, open)]));
    fitBar();
  });
  return part;
}

// ---- Home: the saved canvases, one line each, opening in one click -------------------------------------------

/** What a lens finds, in a few words: its terms, then its walk. */
function lensWords(lens) {
  const f = lens.filter ?? {};
  const said = [...(f.find ?? []), ...(f.only ?? []).map((t) => `only ${t}`)].map((t) => t.replace(/^text (.*)$/, '“$1”').replace(/^type (.*)$/, (_, x) => typeTitle(x)).replace(/^id .*$/, 'an item'));
  const over = lens.walk?.over;
  if (over === 'all' || over?.length) said.push(`${over === 'all' ? 'every link' : over.map((t) => ((w) => `${ARROW[w.way]} ${w.link}`)(wayOf(t))).join(', ').replaceAll('_', ' ')} × ${lens.walk.steps}`);
  return said.join(' · ');
}

const row = (c, now) =>
  h(
    'li',
    { class: 'row-top nowrap-row' },
    h('a', { class: 'gist', href: canvasAt(c), title: c.title }, c.title),
    h('span', { class: 'muted small gist', title: lensWords(viewParts(c).lens) }, lensWords(viewParts(c).lens)),
    c.props?.pinned === true && h('span', { class: 'pill', title: 'Pinned' }, 'pinned'),
    c.id === now && h('span', { class: 'pill ok', title: 'The view up now' }, 'up'),
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
      own.length ? h('ul', { class: 'rows' }, own.map((c) => row(c, now))) : h('div', { class: 'empty', title: 'Save in the bar keeps what is up as a view' }, 'None saved yet.'),
      items.length > 0 && h('details', { class: 'old-views' }, h('summary', { class: 'muted small', title: 'Views kept about one item' }, `Views of items (${items.length})`), h('ul', { class: 'rows' }, items.map((c) => row(c, now)))),
    ),
  );
}
