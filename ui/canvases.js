// Saved canvases (task e_uq77ps44): a flat lens and a style kept on the map as an item of core's `lens` type, so a
// person opens it anywhere and it draws the same. Its id travels in the address beside the lens (`canvas=`, ui/query.js),
// so what is moved on it goes to its own places (the places stream, under its id, apart from the map's) and the bar
// names it. The bar switches between them and keeps what is up as one. What its view button opens, and a screen's
// list of views, are the lenses pack's parts (packs/lenses/parts/), drawn at the map's version: they name a view, and
// this opens it and draws its thumbnail (hooks.openView, hooks.viewThumb). One a document brings in is a part of that
// page, in neither list unless it is up.

import { api, ask, firstDrawn, h, hooks, idsOf, may, state, tell, wordsOf, withIds } from './base.js';
import { drawPart } from './part-host.js';
import { placeBy } from './menu-place.js';
import { addressOf, flatView, stepsOf } from './query.js';
import { filterSaid, fitBar } from './query-bar.js';
import { canvasMenu } from './canvas-menu.js';
import { sharePublicly } from './item-doc.js';
import { lookSwitch, styleDelete } from './look-switch.js';
import { newIslandButton } from './island-new.js';
import { thumbOf } from './thumbs.js';
import { pageIsA, pageSchema, versionCanvases } from './page-schema.js';

const TYPE = 'lens';
/**
 * The saved canvases, the kept first, then by name: so a switch keeps its order as they change. The packs' canvases
 * (presets, decision e_x8bghuce) are among them, each until the owner keeps a version of it (props.preset), which
 * stands in its place; a preset kept is not on the map, so it has no id of its own to open by (`preset` says so).
 */
let known = null;
export function savedCanvases(fresh = false) {
  if (fresh || !known)
    known = firstDrawn.then(() => Promise.all([api('search', { type: TYPE, open: true, limit: 200 }).catch(() => []), api('view', { name: 'saved_views', params: { limit: 200 } }).catch(() => null)])).then(([rows, views]) => {
      const said = new Map((views?.pictures ?? []).map((p) => [p.lens, p]));
      // A working view about what has closed is retired with it (packs/lenses/kernel/saved-views.ts).
      const ended = new Set(views?.ended ?? []);
      const marked = rows.filter((r) => !ended.has(r.id)).map((r) => ({ ...r, note: said.get(r.id)?.note ?? null, cannot: said.get(r.id)?.cannot ?? null, inDocument: Boolean(said.get(r.id)?.document) }));
      const kept = new Set(rows.map((r) => r.props?.preset).filter(Boolean));
      // A pack's view of one item (`on` its types) is offered on that item's page alone (viewsOn).
      const offered = (state.schema?.canvases ?? []).filter((p) => !kept.has(p.id) && !p.on?.length).map((p) => ({ id: p.id, title: p.title, preset: true, props: { ...p.props, preset: p.id } }));
      return [...marked, ...offered].sort((a, b) => Number(a.status === 'working') - Number(b.status === 'working') || a.title.localeCompare(b.title, undefined, { numeric: true }));
    });
  return known;
}

/** What a saved canvas draws: its filter, its walk and its limit; and its style, with its own id. */
export function viewParts(item) {
  const p = item.props ?? {};
  const filter = p.filter ?? {};
  const lens = { ...(p.view && { view: p.view }), filter, walk: p.walk ?? { over: [], steps: 0 }, ...(p.limit && { limit: p.limit }), ...(p.time && { time: p.time }), ...(p.sessions === false && { sessions: false }) };
  return { lens, style: { ...(p.style ?? {}), ...(!item.preset && { canvas: item.id }) } };
}

/** Where a saved canvas opens: the address names it, and its lens is read from the map when it is opened; a pack's, by its lens. */
export const canvasAt = (c) => (c.preset ? `#/v?${addressOf(viewParts(c).lens, viewParts(c).style)}` : `#/v?canvas=${c.id}`);
/** The saved canvas up: the one the address names, else a pack's whose lens is the one up (its style changed, it is marked so). */
const upOf = (all, lens, style) => (style.canvas ? all.find((c) => c.id === style.canvas) : all.find((c) => c.preset && addressOf(viewParts(c).lens) === addressOf(lens)));

/** A view a pack ships, opened by its address: its own settings (a list's columns), which the address does not carry. */
export const presetSettings = (lens) => {
  const at = addressOf(lens);
  // A view of one item is its address with that item where it says {here}.
  const fits = (p) => new RegExp(`^${addressOf(viewParts({ ...p, preset: true, props: p.props }).lens).replace(/[.*+?^$()|[\]\\]/g, '\\$&').replaceAll(encodeURIComponent('{here}'), 'e_[a-z0-9]+')}$`).test(at);
  const preset = [...(state.schema?.canvases ?? []), ...versionCanvases()].find(fits);
  // `shipped` names the view its pack ships, which its drawing sends its actions as (packs/walls/page/layout-asks.js drawingActs).
  return preset ? { ...settingsOf({ props: preset.props }), shipped: preset.id } : {};
};

/**
 * The views packs ship of an item of this type (a preset `on` it): each its title and the address it opens at, the
 * item where its query says {here}. Its page offers them, so a project's roadmap is a view, not a screen.
 */
export const viewsOn = (typeId, id) =>
  (pageSchema()?.canvases ?? [])
    .filter((p) => p.on?.some((t) => pageIsA(typeId, t)))
    .map((p) => {
      const props = JSON.parse(JSON.stringify(p.props).replaceAll('{here}', id));
      const { lens, style } = viewParts({ preset: true, props });
      return { id: p.id, title: p.title, at: `#/v?${addressOf(lens, style)}` };
    });

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
      const { steps, told } = stepsOf(got.entity);
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
// What a drawing's `view` mark draws (ui/view-frame.js), handed over so the marks need not import the canvases.
hooks.keptView = keptView;

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

/** A view an agent made, which the owner has not kept: it retires with what it is about. */
const working = (c) => c?.status === 'working' && !c.preset;

/** Keep what is up: into the view up, at once; else, or with `fresh` (Save as new view), under a name asked in the page.
 *  A person's Save is their word: what it keeps is kept (task e_gkv58kqb). */
async function save(lens, style, current, open, fresh = false) {
  const all = await savedCanvases();
  const title = current && !fresh ? current.title : await ask({ title: 'Save this view', message: 'Its name.', input: { placeholder: 'A name, a few words' }, action: 'Save' });
  if (title === null) return;
  if (!title) return tell('Not saved', 'A view needs a name.');
  if (title.length > 60) return tell('Not saved', 'A name is a few words: 60 characters at most.');
  const { filter, walk, limit, time, sessions } = lens;
  // A pack's view saved under its own name is the owner's version of it, standing in its place.
  const props = { filter, walk, limit: limit ?? null, time: time ?? null, sessions: sessions === false ? false : null, style: { ...settingsOf(current), ...keptStyle(style) }, ...(current?.preset && title === current.title && { preset: current.id }) };
  const same = all.find((c) => !c.preset && c.title.toLowerCase() === title.toLowerCase());
  const made = same
    ? await api('change', { ops: [{ op: 'update', id: same.id, status: 'kept', props }], reason: 'Saved from the query bar' })
    : await api('change', { ops: [{ op: 'create', ref: 'canvas', type: TYPE, title, status: 'kept', props }], reason: 'Saved from the query bar' });
  const id = same?.id ?? made.created?.canvas;
  savedCanvases(true);
  if (id) open(`#/v?${addressOf(lens, { ...style, canvas: id })}`);
  return id ? { id, title } : null;
}

/**
 * Share the view that is up (decision e_nwdn7ce6): as a public view anyone opens, frozen as it is now, with what goes
 * out said first (ui/item-doc.js). Saved first when it is not, since a share shows a view kept on the map.
 */
async function shareView(lens, style, current, open) {
  const kept = current && !current.preset ? { id: current.id, title: current.title } : await save(lens, style, current, open, true);
  if (!kept) return;
  try {
    await sharePublicly(kept.id, kept.title);
  } catch (err) {
    tell('Not shared', err.message);
  }
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

/** The saved canvas the canvas draws now, if one is: Home marks it. */
let up = null;
/** The views the bar has read the list again for, not finding them in it. */
const reread = new Set();

/** The canvas up, in the bar: a switch to every saved one (the current named, marked when changed since), and Save. `open` goes to an address (a pane's own, ui/panes.js). */
export function canvasSwitch(lens, style, isHome, open = (href) => (location.hash = href)) {
  up = style.canvas ?? null;
  const part = h('span', { class: 'q-part q-canvas', title: 'The view up: switch to another, or save this one' });
  // A view the address names that the list lacks was kept since it was read (an agent's, another tab's): read it again.
  // Once for each: one retired is never in it.
  const listed = savedCanvases().then((all) => (style.canvas && !all.some((c) => c.id === style.canvas) && !reread.has(style.canvas) ? (reread.add(style.canvas), savedCanvases(true)) : all));
  listed.then((all) => {
    const current = upOf(all, lens, style);
    const changed = current && edited(current, lens, style);
    // Not saved, it is named as its tab and its pane are: by what its filter finds.
    const label = current ? current.title : isHome ? 'Home' : filterSaid(lens.filter, () => {}) || 'View';
    const pick = viewPicker({ current, label, changed, isHome, open, title: current ? (changed ? `${current.title}: changed since it was saved` : current.title) : 'Not saved: Save keeps it' });
    // In a browser's order: back and forward, then the canvas up, as its address, and its style, with Save beside them, Split, and the canvas's menu at the end.
    const own = hooks.paneButtons?.() ?? [];
    const travel = own.filter((b) => b.classList.contains('q-travel'));
    // Each picker marked before it, its tooltip saying what it is.
    const named = (mark, title) => h('span', { class: 'q-label q-pick-label', title, 'aria-hidden': 'true' }, mark);
    // Saving, deleting and sharing a view write to the map: drawn only where this session may.
    const writes = may('write');
    // The menu's rows, read as it opens.
    const rows = [{ element: h('label', { class: 'q-look-row', title: 'Layout: how this view is arranged' }, h('span', { class: 'muted' }, 'Layout'), lookSwitch(lens, style, open)) }, writes && current && { text: 'Save as new view', title: 'Keep what is up as a view of its own', act: () => save(lens, style, current, open, true) }, writes && { text: 'Share it', title: 'Public for anyone, frozen as it is now (saved first if it is not)', act: () => shareView(lens, style, current, open) }, styleDelete(lens, style, open)];
    part.replaceChildren(...travel, named(canvasMark(), 'View: the saved view up'), pick, ...[writes && h('button', { type: 'button', class: 'q-save q-word', title: current ? (changed ? `Save the changes to “${current.title}”` : working(current) ? `Keep “${current.title}”: an agent’s view, retired with what it is about until you keep it` : `“${current.title}” is kept`) : 'Save this view', 'aria-label': 'Save this view', ...(current && !changed && !current.preset && !working(current) && { disabled: true }), onclick: () => save(lens, style, current, open) }, saveMark(), h('span', { class: 'q-word-text' }, changed ? 'Save •' : working(current) ? 'Keep' : 'Save'))].filter(Boolean), ...(writes && current && !current.preset ? [h('button', { type: 'button', class: 'q-save q-delete', title: `Delete “${current.title}”`, 'aria-label': 'Delete this saved view', onclick: () => drop(lens, style, current, open) }, binMark())] : []), ...own.filter((b) => !travel.includes(b)), canvasMenu(rows));
    // Making an island is a button of the band, once the map says it has islands: beside Save, before the menu.
    newIslandButton().then((button) => button && !part.querySelector('.q-island') && (part.insertBefore(button, part.lastElementChild), fitBar()));
    fitBar();
  });
  return part;
}

// ---- What a part names: a view to open, a thumbnail, the view up ----------------------------------------------

/** Where a view a part names opens: home, one kept or one a pack ships, by its id. */
async function viewAt(id) {
  if (id === 'home') return '#/';
  const c = (await savedCanvases()).find((v) => v.id === id);
  return c ? canvasAt(c) : /^e_/.test(id) ? `#/v?canvas=${id}` : null;
}
hooks.openView = (id) => viewAt(id).then((href) => href && (location.hash = href));
/** A view's thumbnail where a part names it: drawn once the list says what the view draws. */
hooks.viewThumb = (id) => {
  const box = h('span', { class: 'thumb-at' });
  if (id !== 'home') savedCanvases().then((all) => ((c) => c && box.replaceChildren(thumbOf({ id: c.id, ...viewParts(c) })))(all.find((v) => v.id === id)));
  return box;
};
hooks.viewUp = () => up;

// ---- The view switcher: the bar's button, and the panel the lenses pack's part fills ----------------------------

const panel = h('div', { class: 'tab-menu view-panel', popover: 'auto', role: 'dialog', 'aria-label': 'Views' });
document.body.append(panel);

/** The button naming the view up, opening the panel over the page with the part that fills it (`bar.views`). */
function viewPicker({ current, label, title, changed, isHome, open }) {
  const button = h('button', { type: 'button', class: 'q-pick q-view-pick', title, 'aria-haspopup': 'dialog', 'data-title': current?.title ?? (isHome ? 'Home' : '') },
    // The name is cut short where the bar is short of room; the whole of it is the tooltip.
    h('span', { class: 'q-pick-text' }, `${label}${changed ? ' •' : ''}`), h('span', { 'aria-hidden': 'true' }, '▾'));
  button.addEventListener('click', () => {
    if (panel.matches(':popover-open')) return panel.hidePopover();
    const body = h('div', { class: 'view-list' });
    panel.replaceChildren(body);
    panel.showPopover();
    placeBy(panel, button);
    // Placed again as the part draws into it; the field to find a view by takes the keys once it is drawn.
    let focused = false;
    const drawing = new MutationObserver(() => {
      if (!panel.matches(':popover-open')) return drawing.disconnect();
      placeBy(panel, button);
      const field = body.querySelector('.pm-input');
      if (field && !focused) (focused = true), field.focus();
    });
    drawing.observe(body, { childList: true, subtree: true });
    const openView = (id) => viewAt(id).then((href) => href && (panel.hidePopover(), open(href)));
    drawPart(body, { slot: 'bar.views', piece: { current: current?.id, home: Boolean(isHome) }, openView })
      .then((drawn) => drawn || body.replaceChildren(h('div', { class: 'empty muted small' }, 'No pack draws the views.')))
      .catch((err) => body.replaceChildren(h('div', { class: 'error' }, err.message)));
  });
  return button;
}
